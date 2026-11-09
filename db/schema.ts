/**
 * Applies the backend's own schema to the QA database.
 *
 * The backend owns the schema and the only code that applies it:
 * crm_backend/scripts/lib/migrations.js, the runner behind
 * `npm run db:migrate` and the backend's Jest setup. This module loads that
 * runner and hands it a client connected to the guarded QA target, so QA
 * builds its database exactly the way every other database is built: the
 * baseline (sql/schema.sql), then each file in sql/migrations/ in order.
 *
 * There is no list of files here to keep in step with the backend.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { qaEnv } from "../config/env.ts";
import { assertSafeQaTarget, currentTarget, withQaClient } from "./admin.ts";

type Runner = {
  migrate: (client: unknown, options?: { log?: (line: string) => void }) => Promise<string[]>;
  listMigrations: () => string[];
};

function loadRunner(): Runner {
  const file = path.join(qaEnv.backendPath, "scripts", "lib", "migrations.js");
  if (!fs.existsSync(file)) {
    throw new Error(
      `The backend's migration runner was not found at ${file}. ` +
        `crm_qa needs a crm_backend checkout with scripts/lib/migrations.js.`,
    );
  }
  return createRequire(import.meta.url)(file) as Runner;
}

/**
 * Fails early, before any database work, if the backend's schema cannot be
 * applied: the runner is missing or a migration file is misnamed.
 */
export function verifySchemaSource(): void {
  const runner = loadRunner();
  const migrations = runner.listMigrations();
  console.log(
    `[qa-schema] backend runner found: baseline + ${migrations.length} migration(s)`,
  );
}

/** Brings the QA database up to date with the backend's runner. */
export async function applySchema(): Promise<void> {
  const target = currentTarget();
  assertSafeQaTarget(target);
  const runner = loadRunner();

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

    const applied = await runner.migrate(client, {
      log: (line) => console.log(`[qa-schema]   ${line}`),
    });
    console.log(
      applied.length
        ? `[qa-schema] applied ${applied.join(", ")} to ${dbName}`
        : `[qa-schema] ${dbName} was already up to date`,
    );

    const tables = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    console.log(`[qa-schema] done: ${tables.rows[0]?.count} tables in public schema`);
  });
}
