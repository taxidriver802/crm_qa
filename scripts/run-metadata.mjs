/**
 * Records what a QA run actually tested.
 *
 * This is the mechanism that attributes a future visual diff or accessibility
 * regression to a specific frontend commit, given the harness lives in a
 * separate repository from the application.
 *
 * SECRET HYGIENE: fields are written from an explicit allowlist. Passwords,
 * JWT secrets, cookies, storageState and full connection strings are never
 * serialised - only the database NAME, which is not sensitive.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { qaEnv } from "../config/env.ts";

function git(repoPath, args) {
  try {
    return execFileSync("git", ["-C", repoPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function describeRepo(repoPath) {
  return {
    path: repoPath,
    sha: git(repoPath, ["rev-parse", "HEAD"]),
    shortSha: git(repoPath, ["rev-parse", "--short", "HEAD"]),
    branch: git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]),
    dirty: git(repoPath, ["status", "--porcelain"]) !== "",
  };
}

export function writeRunMetadata(extra = {}) {
  const metadata = {
    // --- allowlisted, non-secret fields only ---
    generatedAt: new Date().toISOString(),
    harness: { path: qaEnv.qaRoot, ...describeRepo(qaEnv.qaRoot) },
    frontend: describeRepo(qaEnv.frontendPath),
    backend: describeRepo(qaEnv.backendPath),
    servers: {
      frontendUrl: qaEnv.baseUrl,
      backendUrl: qaEnv.backendUrl,
      frontendPort: qaEnv.frontendPort,
      backendPort: qaEnv.backendPort,
      frontendMode: qaEnv.frontendMode,
    },
    // Name only - never the connection string.
    database: { name: qaEnv.dbName },
    isolatedWorkspace: qaEnv.isolatedWorkspace,
    ...extra,
  };

  fs.mkdirSync(qaEnv.artifactsPath, { recursive: true });
  const file = path.join(qaEnv.artifactsPath, "run-metadata.json");
  fs.writeFileSync(file, JSON.stringify(metadata, null, 2) + "\n", "utf8");
  return { file, metadata };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { file, metadata } = writeRunMetadata();
  console.log(`[qa-metadata] wrote ${file}`);
  console.log(
    `[qa-metadata] frontend ${metadata.frontend.branch}@${metadata.frontend.shortSha}` +
      `${metadata.frontend.dirty ? " (dirty)" : ""}, ` +
      `backend ${metadata.backend.branch}@${metadata.backend.shortSha}` +
      `${metadata.backend.dirty ? " (dirty)" : ""}`,
  );
}
