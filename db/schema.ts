/**
 * Applies the backend's own schema to the QA database.
 *
 * The backend is not migration-managed: the canonical apply order lives only in
 * crm_backend/test/helpers/setup.ts and is NOT alphabetical (phase12_invoicing
 * must precede phase13_automation). Rather than reimplement the schema, this
 * module reads the backend's real .sql files in that exact order, so the
 * backend repo stays the single owner of schema definition.
 *
 * DRIFT GUARD: because the order is duplicated here, a future patch file added
 * to the backend would otherwise be silently skipped. verifyNoSchemaDrift()
 * compares the directory against SCHEMA_FILES and fails loudly instead.
 */

import fs from "node:fs";
import path from "node:path";
import { qaEnv } from "../config/env.ts";
import { assertSafeQaTarget, currentTarget, withQaClient } from "./admin.ts";

/**
 * Canonical apply order, transcribed from crm_backend/test/helpers/setup.ts.
 * Do not sort this list.
 */
export const SCHEMA_FILES = Object.freeze([
  "schema.sql",
  "patch_notifications_constraints.sql",
  "patch_phase9.sql",
  "patch_phase10_notes.sql",
  "patch_phase12_team_visibility.sql",
  "patch_phase12_saved_views.sql",
  "patch_phase12_invoicing.sql",
  "patch_phase13_automation.sql",
  "patch_phase13_portal.sql",
  "patch_phase14_events.sql",
  "patch_phase15_status_aging.sql",
  "patch_phase16_communication.sql",
  "patch_phase17_quotes_photos.sql",
  "patch_phase18_acquisition_portal.sql",
  "patch_phase19_appointments_workload.sql",
]);

function sqlDir(): string {
  const dir = path.join(qaEnv.backendPath, "sql");
  if (!fs.existsSync(dir)) {
    throw new Error(`Backend sql directory not found: ${dir}`);
  }
  return dir;
}

/**
 * Fails if the backend's sql directory contains a file this harness does not
 * know how to order, or is missing one it expects.
 */
export function verifyNoSchemaDrift(): void {
  const dir = sqlDir();
  const onDisk = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const known = new Set<string>(SCHEMA_FILES);
  const unknown = onDisk.filter((name) => !known.has(name));
  const missing = SCHEMA_FILES.filter((name) => !onDisk.includes(name));

  if (missing.length > 0) {
    throw new Error(
      `Schema files listed in SCHEMA_FILES are missing from ${dir}:\n` +
        missing.map((name) => `  - ${name}`).join("\n"),
    );
  }

  if (unknown.length > 0) {
    throw new Error(
      `SCHEMA DRIFT DETECTED.\n\n` +
        `${dir} contains SQL files the QA harness does not know about:\n` +
        unknown.map((name) => `  - ${name}`).join("\n") +
        `\n\nThe backend's canonical apply order is defined in ` +
        `crm_backend/test/helpers/setup.ts. Add the new file(s) to ` +
        `SCHEMA_FILES in crm_qa/db/schema.ts IN THE CORRECT ORDER ` +
        `(order matters - it is not alphabetical), then re-run.\n`,
    );
  }

  console.log(
    `[qa-schema] drift check passed: ${onDisk.length} sql file(s) all accounted for`,
  );
}

/**
 * Applies schema.sql plus every patch, in canonical order, inside a single
 * transaction. All statements are idempotent (CREATE ... IF NOT EXISTS), so
 * this is safe to re-run, though a reset is the normal path.
 */
export async function applySchema(): Promise<void> {
  const target = currentTarget();
  assertSafeQaTarget(target);
  verifyNoSchemaDrift();

  const dir = sqlDir();

  await withQaClient(async (client) => {
    const connected = await client.query<{ current_database: string }>(
      "SELECT current_database()",
    );
    const dbName = connected.rows[0]?.current_database;
    if (dbName !== target.dbName) {
      throw new Error(
        `Refusing to apply schema: connected to "${dbName}", expected "${target.dbName}".`,
      );
    }
    console.log(`[qa-schema] applying ${SCHEMA_FILES.length} file(s) to ${dbName}`);

    await client.query("BEGIN");
    try {
      for (const fileName of SCHEMA_FILES) {
        const sql = fs.readFileSync(path.join(dir, fileName), "utf8");
        await client.query(sql);
        console.log(`[qa-schema]   applied ${fileName}`);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    const tables = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    console.log(`[qa-schema] done: ${tables.rows[0]?.count} tables in public schema`);
  });
}
