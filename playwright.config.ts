/**
 * Playwright configuration for the CRM QA harness.
 *
 * Starts both application servers on QA-only ports (3100/4100) so a normal
 * development instance on 3000/4000 is never touched, then runs every spec
 * across the four-viewport matrix.
 */

import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { qaEnv } from "./config/env.ts";
import { VIEWPORTS } from "./config/viewports.ts";

const ARTIFACTS = qaEnv.artifactsPath;

/**
 * Environment for the QA backend.
 *
 * NODE_ENV=test is deliberate and does three useful things:
 *   1. skips the two setInterval background jobs in crm_backend/src/app.ts
 *      (runTaskNotificationJob / runInvoiceReminderJob), so nothing mutates
 *      seeded data mid-run
 *   2. makes server.ts load ".env.test" instead of ".env", so the developer's
 *      real secrets and crm_dev connection string are never read
 *   3. leaves SMTP unconfigured, so no QA action can send a real email
 *
 * Everything the backend needs is therefore passed explicitly here.
 */
const backendEnv: Record<string, string> = {
  NODE_ENV: "test",
  PORT: String(qaEnv.backendPort),
  DATABASE_URL: qaEnv.databaseUrl,
  JWT_SECRET: qaEnv.jwtSecret,
  JWT_EXPIRES_IN: "7d",
  FRONTEND_URL: qaEnv.baseUrl,
  APP_BASE_URL: qaEnv.baseUrl,
  CORS_ORIGINS: qaEnv.baseUrl,
};

const frontendEnv: Record<string, string> = {
  NODE_ENV: "production",
  PORT: String(qaEnv.frontendPort),
  // Read at runtime by next.config.mjs rewrites().
  API_INTERNAL_BASE_URL: qaEnv.backendUrl,
  NEXT_PUBLIC_API_BASE_URL: "/api",
  NEXT_TELEMETRY_DISABLED: "1",
};

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/global-setup.ts",

  // Serial by default: the suite shares one seeded database, so parallel
  // mutation would make failures non-reproducible. Phase 3+ can opt specific
  // read-only projects into parallelism.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },

  outputDir: path.join(ARTIFACTS, "test-results"),

  reporter: [
    ["list"],
    ["html", { outputFolder: path.join(ARTIFACTS, "playwright-report"), open: "never" }],
    ["json", { outputFile: path.join(ARTIFACTS, "results.json") }],
  ],

  use: {
    baseURL: qaEnv.baseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",

    // The app registers a service worker (ServiceWorkerRegistrar in
    // src/app/layout.js). Blocking it keeps navigation deterministic and
    // prevents a cached shell from masking a real change.
    serviceWorkers: "block",

    // No @keyframes exist in the app; motion is driven by the --duration-fast
    // token. Reducing motion keeps transient states out of assertions.
    reducedMotion: "reduce",

    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: VIEWPORTS.map((viewport) => ({
    name: viewport.name,
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.isMobile,
      hasTouch: viewport.hasTouch,
      // Authenticated session captured once by global-setup.
      storageState: qaEnv.authStatePath,
    },
  })),

  webServer: [
    {
      // ts-node-dev, matching how the backend is normally run. No build step,
      // and --transpile-only keeps startup fast.
      command: "npm run dev",
      cwd: qaEnv.backendPath,
      url: `${qaEnv.backendUrl}/health`,
      env: backendEnv,
      // Never reuse: a stray server could be pointed at the wrong database.
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
    },
    {
      command: `node_modules/.bin/next start -p ${qaEnv.frontendPort}`,
      cwd: qaEnv.stagedFrontendPath,
      url: `${qaEnv.baseUrl}/login`,
      env: frontendEnv,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
    },
  ],
});
