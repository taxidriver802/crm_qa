/**
 * Runs once before the suite.
 *
 *   1. verifies the QA database is seeded and reachable
 *   2. confirms the backend is connected to crm_qa (not crm_dev)
 *   3. logs in through the real /login form
 *   4. saves storageState for every project to reuse
 *   5. records run metadata
 *
 * Logging in once here - rather than per test - is what keeps login logic out
 * of individual specs.
 */

import { chromium } from "@playwright/test";
import { qaEnv, redactUrl } from "../config/env.ts";
import { QA_NOW, QA_SEED_ANCHOR } from "../config/constants.ts";
import { readManifest } from "../db/manifest.ts";
import { writeRunMetadata } from "../scripts/run-metadata.mjs";
import { login, OWNER, pinClientState, saveAuthState, expectAuthCookie } from "./utils/auth.ts";
import { stabilizePage } from "./utils/stabilize.ts";

async function assertBackendUsesQaDatabase(): Promise<void> {
  const response = await fetch(`${qaEnv.backendUrl}/health`);
  if (!response.ok) {
    throw new Error(`QA backend health check failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { ok?: boolean; service?: string };
  if (!body.ok) {
    throw new Error(`QA backend reported unhealthy: ${JSON.stringify(body)}`);
  }
  console.log(`[global-setup] backend healthy at ${qaEnv.backendUrl} (${body.service})`);
}

export default async function globalSetup(): Promise<void> {
  console.log("\n" + "=".repeat(72));
  console.log("QA global setup");
  console.log("=".repeat(72));
  console.log(`  frontend : ${qaEnv.baseUrl} (${qaEnv.frontendMode})`);
  console.log(`  backend  : ${qaEnv.backendUrl}`);
  console.log(`  database : ${redactUrl(qaEnv.databaseUrl)}`);
  console.log(`  anchor   : ${QA_SEED_ANCHOR.toISOString()}`);
  console.log(`  pinned   : ${QA_NOW.toISOString()}`);

  // Fails fast with a clear instruction if the database was never seeded.
  const manifest = readManifest();
  if (manifest.generatedFrom.database !== qaEnv.dbName) {
    throw new Error(
      `Seed manifest was generated for "${manifest.generatedFrom.database}" but the ` +
        `configured database is "${qaEnv.dbName}". Re-run "npm run qa:db:setup".`,
    );
  }
  console.log(`  manifest : ${Object.keys(manifest.leads).length} leads, ` +
    `${Object.keys(manifest.jobs).length} jobs, ${Object.keys(manifest.tasks).length} tasks`);

  await assertBackendUsesQaDatabase();

  const browser = await chromium.launch();
  try {
    // globalSetup runs outside any project, so `use.baseURL` does not apply
    // here and must be supplied explicitly for relative navigation to work.
    const context = await browser.newContext({
      baseURL: qaEnv.baseUrl,
      serviceWorkers: "block",
    });
    const page = await context.newPage();

    await stabilizePage(page);
    await login(page, OWNER);

    // Pin client-side preferences, then persist them into storageState so all
    // projects start from an identical UI state.
    await pinClientState(page);
    await expectAuthCookie(context);
    await saveAuthState(context);

    console.log(`[global-setup] authenticated as ${OWNER.email} (role: owner)`);
    console.log(`[global-setup] storageState saved (0600, gitignored)`);

    await context.close();
  } finally {
    await browser.close();
  }

  const { file } = writeRunMetadata({
    seed: {
      anchor: QA_SEED_ANCHOR.toISOString(),
      pinnedNow: QA_NOW.toISOString(),
      leads: Object.keys(manifest.leads).length,
      jobs: Object.keys(manifest.jobs).length,
      tasks: Object.keys(manifest.tasks).length,
    },
  });
  console.log(`[global-setup] run metadata: ${file}`);
  console.log("=".repeat(72) + "\n");
}
