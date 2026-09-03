/**
 * Produces a production build of the staged frontend copy.
 *
 * Runs `next build` inside .qa-build/frontend, so the output lands in
 * .qa-build/frontend/.next and crm_frontend/.next is never written.
 *
 * A production build (rather than `next dev`) matters because dev-mode bundles
 * are unminified and carry the dev overlay, which makes both Lighthouse
 * numbers and visual screenshots unrepresentative.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { qaEnv, scrubSecrets } from "../config/env.ts";

function nextBinary() {
  // Prefer the staged copy's own node_modules so the build is self-contained
  // and Turbopack's project root has no path escaping it.
  const staged = path.join(qaEnv.stagedFrontendPath, "node_modules", ".bin", "next");
  if (fs.existsSync(staged)) return staged;

  const real = path.join(qaEnv.frontendPath, "node_modules", ".bin", "next");
  if (!fs.existsSync(real)) {
    throw new Error(`next binary not found at ${staged} or ${real}. Run "npm run qa:prepare".`);
  }
  return real;
}

export function buildFrontend() {
  const staged = qaEnv.stagedFrontendPath;
  if (!fs.existsSync(staged)) {
    throw new Error(
      `Staged frontend not found at ${staged}. Run "npm run qa:prepare" first.`,
    );
  }

  console.log(`\n[qa-build] building staged frontend (${qaEnv.frontendMode} mode)`);
  console.log(`[qa-build]   cwd: ${staged}`);

  const started = Date.now();
  try {
    execFileSync(nextBinary(), ["build"], {
      cwd: staged,
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "production",
        // Read at runtime by next.config.mjs rewrites(); set here too so the
        // build and the server agree.
        API_INTERNAL_BASE_URL: qaEnv.backendUrl,
        NEXT_PUBLIC_API_BASE_URL: "/api",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    });
  } catch (error) {
    throw new Error(scrubSecrets(`next build failed: ${error.message}`));
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const buildIdPath = path.join(staged, ".next", "BUILD_ID");
  const buildId = fs.existsSync(buildIdPath)
    ? fs.readFileSync(buildIdPath, "utf8").trim()
    : "(unknown)";

  console.log(`\n[qa-build] built in ${seconds}s, staged BUILD_ID ${buildId}`);
  console.log(`[qa-build]   output: ${path.join(staged, ".next")}`);
  return { buildId, seconds };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildFrontend();
  console.log("[qa-build] done\n");
}
