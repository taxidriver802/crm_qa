/**
 * QA database lifecycle CLI.
 *
 *   node scripts/qa-db.ts reset    drop + recreate crm_qa
 *   node scripts/qa-db.ts schema   apply the backend's schema + patches
 *   node scripts/qa-db.ts seed     insert deterministic fixtures
 *   node scripts/qa-db.ts setup    reset + schema + seed  (the usual entry point)
 *   node scripts/qa-db.ts reseed   truncate + seed        (fast inner loop)
 *   node scripts/qa-db.ts verify   report row counts, no writes
 *
 * Every destructive command prints its resolved target and re-validates the
 * safety guard before touching anything. See db/admin.ts.
 */

import {
  assertSafeQaTarget,
  currentTarget,
  databaseExists,
  resetDatabase,
  truncateAll,
  withQaClient,
} from "../db/admin.ts";
import { applySchema, verifyNoSchemaDrift } from "../db/schema.ts";
import { seed } from "../db/seed.ts";
import { TRUNCATE_TABLES } from "../db/admin.ts";

const COMMANDS = ["reset", "schema", "seed", "setup", "reseed", "verify"] as const;
type Command = (typeof COMMANDS)[number];

async function reportCounts(): Promise<Record<string, number>> {
  return withQaClient(async (client) => {
    const counts: Record<string, number> = {};
    for (const table of TRUNCATE_TABLES) {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "${table}"`,
      );
      const value = Number(result.rows[0].count);
      if (value > 0) counts[table] = value;
    }
    return counts;
  });
}

function printCounts(counts: Record<string, number>): void {
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  console.log("\n[qa-db] row counts (non-empty tables only):");
  for (const [table, count] of entries) {
    console.log(`  ${table.padEnd(22)} ${count}`);
  }
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  console.log(`  ${"TOTAL".padEnd(22)} ${total}`);
}

async function main(): Promise<void> {
  const command = (process.argv[2] ?? "") as Command;
  if (!COMMANDS.includes(command)) {
    console.error(`Usage: node scripts/qa-db.ts <${COMMANDS.join("|")}>`);
    process.exit(2);
  }

  // Validate before anything else, on every path including read-only ones.
  const target = currentTarget();
  assertSafeQaTarget(target);

  switch (command) {
    case "reset": {
      await resetDatabase(target);
      break;
    }

    case "schema": {
      await applySchema();
      break;
    }

    case "seed": {
      const manifest = await seed();
      printCounts(await reportCounts());
      console.log(`\n[qa-db] route tokens: ${JSON.stringify(manifest.routeTokens)}`);
      break;
    }

    case "setup": {
      verifyNoSchemaDrift();
      await resetDatabase(target);
      await applySchema();
      const manifest = await seed();
      printCounts(await reportCounts());
      console.log(`\n[qa-db] route tokens: ${JSON.stringify(manifest.routeTokens)}`);
      console.log(`[qa-db] setup complete for "${target.dbName}"`);
      break;
    }

    case "reseed": {
      if (!(await databaseExists(target))) {
        throw new Error(
          `Database "${target.dbName}" does not exist. Run "npm run qa:db:setup" first.`,
        );
      }
      await truncateAll(target);
      await seed();
      printCounts(await reportCounts());
      break;
    }

    case "verify": {
      if (!(await databaseExists(target))) {
        console.error(`[qa-db] database "${target.dbName}" does not exist`);
        process.exit(1);
      }
      printCounts(await reportCounts());
      break;
    }
  }
}

main().catch((error: unknown) => {
  console.error(`\n[qa-db] FAILED: ${(error as Error).message}`);
  process.exitCode = 1;
});
