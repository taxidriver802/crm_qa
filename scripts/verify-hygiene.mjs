/**
 * Fails if any QA secret has leaked into a tracked file or an artifact.
 *
 * Cheap insurance against an accidental `git add`. Compares the real secret
 * values from .env.qa.local against everything git tracks, plus anything
 * already written into qa-artifacts.
 *
 * The secret values themselves are never printed - only the offending path.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { collectSecretValues, qaEnv } from "../config/env.ts";

const MIN_SECRET_LENGTH = 8;

function trackedFiles() {
  try {
    return execFileSync("git", ["-C", qaEnv.qaRoot, "ls-files"], { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    console.log("[hygiene] not a git repository yet - skipping tracked-file scan");
    return null;
  }
}

function walk(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, results);
    else results.push(full);
  }
  return results;
}

function scan(files, label, secrets) {
  const problems = [];
  for (const relative of files) {
    const full = path.isAbsolute(relative) ? relative : path.join(qaEnv.qaRoot, relative);
    let contents;
    try {
      const stats = fs.statSync(full);
      if (!stats.isFile() || stats.size > 8 * 1024 * 1024) continue;
      contents = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    for (const secret of secrets) {
      if (contents.includes(secret)) {
        problems.push({ file: path.relative(qaEnv.qaRoot, full), label });
        break;
      }
    }
  }
  return problems;
}

const secrets = collectSecretValues().filter((value) => value.length >= MIN_SECRET_LENGTH);

console.log("=".repeat(72));
console.log("QA secret hygiene check");
console.log("=".repeat(72));
console.log(`  checking ${secrets.length} secret value(s) - values are never printed`);

if (secrets.length === 0) {
  console.error("  FAIL  no secrets resolved from .env.qa.local; cannot verify hygiene");
  process.exit(1);
}

const problems = [];

const tracked = trackedFiles();
if (tracked) {
  console.log(`  scanning ${tracked.length} git-tracked file(s)`);
  problems.push(...scan(tracked, "tracked by git", secrets));

  // .env.qa.local must never be tracked, regardless of content.
  if (tracked.includes(".env.qa.local")) {
    problems.push({ file: ".env.qa.local", label: "must never be tracked" });
  }
  for (const file of tracked) {
    if (file.startsWith("tests/fixtures/.auth/")) {
      problems.push({ file, label: "session state must never be tracked" });
    }
  }
}

const artifacts = walk(qaEnv.artifactsPath);
if (artifacts.length > 0) {
  console.log(`  scanning ${artifacts.length} artifact file(s)`);
  problems.push(...scan(artifacts, "written into qa-artifacts", secrets));
}

console.log();
if (problems.length > 0) {
  console.error("SECRET LEAK DETECTED:");
  for (const problem of problems) {
    console.error(`  ${problem.file}  (${problem.label})`);
  }
  console.error("\nRemove the secret, rotate it, and re-run.");
  process.exit(1);
}

console.log("HYGIENE CHECK PASSED: no QA secret appears in tracked files or artifacts.");
console.log("=".repeat(72) + "\n");
