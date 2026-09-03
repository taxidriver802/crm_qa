/**
 * QA database administration: create, drop and truncate.
 *
 * SAFETY CONTRACT
 * ---------------
 * Every destructive statement in the harness routes through this module, and
 * every entry point calls assertSafeQaTarget() immediately before executing.
 * The guard makes it structurally impossible to drop or truncate crm_dev,
 * postgres, overnight_dev, or any other non-QA database:
 *
 *   1. the database name must match /^crm_qa(_[a-z0-9_]+)?$/
 *   2. the name must not appear in PROTECTED_DATABASES
 *   3. the database inside QA_DATABASE_URL must equal QA_DB_NAME byte-for-byte
 *   4. QA_ADMIN_DATABASE_URL must target the "postgres" maintenance database
 *   5. the guard is re-asserted at execution time, not just at parse time
 *
 * Identifiers are additionally quoted via quoteIdent() so a name that somehow
 * passed validation still cannot inject SQL.
 */

import pg from "pg";
import { PROTECTED_DATABASES, QA_DB_NAME_PATTERN } from "../config/constants.ts";
import { qaEnv, redactUrl } from "../config/env.ts";

export interface QaTarget {
  dbName: string;
  databaseUrl: string;
  adminDatabaseUrl: string;
}

export class UnsafeQaTargetError extends Error {
  constructor(message: string) {
    super(`REFUSING DESTRUCTIVE OPERATION: ${message}`);
    this.name = "UnsafeQaTargetError";
  }
}

function databaseNameFromUrl(connectionString: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new UnsafeQaTargetError(`${label} is not a parseable connection string.`);
  }
  const name = parsed.pathname.replace(/^\//, "");
  if (!name) {
    throw new UnsafeQaTargetError(`${label} does not name a database.`);
  }
  return decodeURIComponent(name);
}

/**
 * Validates that `target` describes a QA database it is safe to destroy.
 * Throws UnsafeQaTargetError otherwise. Pure and side-effect free so it can be
 * exercised directly with hostile input.
 */
export function assertSafeQaTarget(target: QaTarget): void {
  const { dbName } = target;

  if (!dbName || typeof dbName !== "string") {
    throw new UnsafeQaTargetError("QA_DB_NAME is empty.");
  }

  // (1) Shape. Also rejects whitespace, semicolons and quotes outright.
  if (!QA_DB_NAME_PATTERN.test(dbName)) {
    throw new UnsafeQaTargetError(
      `"${dbName}" does not match ${QA_DB_NAME_PATTERN}. QA databases must be named crm_qa or crm_qa_<suffix>.`,
    );
  }

  // (2) Explicit denylist, checked case-insensitively.
  const lowered = dbName.toLowerCase();
  if (PROTECTED_DATABASES.includes(lowered)) {
    throw new UnsafeQaTargetError(`"${dbName}" is a protected database and may never be modified.`);
  }

  // (3) The URL the backend and seed will use must agree with the guarded name,
  //     so a stale or edited env file cannot redirect a drop elsewhere.
  const urlDbName = databaseNameFromUrl(target.databaseUrl, "QA_DATABASE_URL");
  if (urlDbName !== dbName) {
    throw new UnsafeQaTargetError(
      `QA_DB_NAME ("${dbName}") does not match the database in QA_DATABASE_URL ("${urlDbName}").`,
    );
  }
  if (PROTECTED_DATABASES.includes(urlDbName.toLowerCase())) {
    throw new UnsafeQaTargetError(
      `QA_DATABASE_URL points at the protected database "${urlDbName}".`,
    );
  }

  // (4) The admin connection must be a maintenance connection, never an app db.
  const adminDbName = databaseNameFromUrl(target.adminDatabaseUrl, "QA_ADMIN_DATABASE_URL");
  if (adminDbName !== "postgres") {
    throw new UnsafeQaTargetError(
      `QA_ADMIN_DATABASE_URL must target the "postgres" maintenance database, not "${adminDbName}".`,
    );
  }
}

/** The QA target described by the current environment. */
export function currentTarget(): QaTarget {
  return {
    dbName: qaEnv.dbName,
    databaseUrl: qaEnv.databaseUrl,
    adminDatabaseUrl: qaEnv.adminDatabaseUrl,
  };
}

/** Quotes a Postgres identifier, doubling any embedded quotes. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Prints the resolved target before any destructive work, so the operator can
 * see exactly which database is about to be affected. Passwords are redacted.
 */
export function printTarget(operation: string, target: QaTarget): void {
  console.log(`\n[qa-db] operation      : ${operation}`);
  console.log(`[qa-db] target database: ${target.dbName}`);
  console.log(`[qa-db] target url     : ${redactUrl(target.databaseUrl)}`);
  console.log(`[qa-db] admin url      : ${redactUrl(target.adminDatabaseUrl)}`);
  console.log(`[qa-db] protected      : ${PROTECTED_DATABASES.join(", ")}`);
}

async function withAdminClient<T>(
  target: QaTarget,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: target.adminDatabaseUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function withQaClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const target = currentTarget();
  assertSafeQaTarget(target);
  const client = new pg.Client({ connectionString: target.databaseUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function databaseExists(target: QaTarget): Promise<boolean> {
  assertSafeQaTarget(target);
  return withAdminClient(target, async (client) => {
    const result = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      target.dbName,
    ]);
    return result.rowCount === 1;
  });
}

/**
 * Drops and recreates the QA database, owned by the role in QA_DATABASE_URL so
 * the backend can create tables in it.
 */
export async function resetDatabase(target: QaTarget = currentTarget()): Promise<void> {
  printTarget("reset (drop + create)", target);
  assertSafeQaTarget(target);

  const owner = new URL(target.databaseUrl).username;
  if (!owner) {
    throw new UnsafeQaTargetError("QA_DATABASE_URL must include a role name to own the database.");
  }

  await withAdminClient(target, async (client) => {
    // Re-assert at execution time (guard requirement 5): config could have been
    // mutated between validation and now.
    assertSafeQaTarget(target);

    // Terminate stragglers so DROP cannot block on a leftover connection.
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [target.dbName],
    );

    await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(target.dbName)}`);
    console.log(`[qa-db] dropped ${target.dbName} (if it existed)`);

    await client.query(
      `CREATE DATABASE ${quoteIdent(target.dbName)} OWNER ${quoteIdent(owner)}`,
    );
    console.log(`[qa-db] created ${target.dbName} owned by ${owner}`);
  });
}

/**
 * Tables truncated by a reseed, ordered to satisfy foreign keys.
 * Mirrors crm_backend/test/helpers/db.ts so QA and the backend's own Jest
 * suite agree on what "empty" means.
 */
export const TRUNCATE_TABLES = Object.freeze([
  "job_activity",
  "notes",
  "notifications",
  "saved_views",
  "product_events",
  "portal_tokens",
  "automation_rules",
  "invoice_line_items",
  "invoices",
  "estimate_line_items",
  "estimates",
  "job_measurements",
  "files",
  "tasks",
  "jobs",
  "leads",
  "supplier_webhook_events",
  "supplier_orders",
  "supplier_accounts",
  "supplier_connections",
  "users",
]);

/** Empties the QA database without dropping it. The fast inner loop. */
export async function truncateAll(target: QaTarget = currentTarget()): Promise<void> {
  printTarget("truncate (all tables)", target);
  assertSafeQaTarget(target);

  const client = new pg.Client({ connectionString: target.databaseUrl });
  await client.connect();
  try {
    assertSafeQaTarget(target);

    // Confirm at runtime that the open connection really is the QA database.
    const actual = await client.query<{ current_database: string }>(
      "SELECT current_database()",
    );
    const connected = actual.rows[0]?.current_database;
    if (connected !== target.dbName) {
      throw new UnsafeQaTargetError(
        `connected to "${connected}" but expected "${target.dbName}". Aborting truncate.`,
      );
    }

    const list = TRUNCATE_TABLES.map(quoteIdent).join(",\n      ");
    await client.query(`TRUNCATE TABLE\n      ${list}\n    RESTART IDENTITY CASCADE`);
    console.log(`[qa-db] truncated ${TRUNCATE_TABLES.length} tables in ${target.dbName}`);
  } finally {
    await client.end();
  }
}
