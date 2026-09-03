/**
 * Proves the destructive-operation guard rejects unsafe targets.
 *
 * Runs BEFORE any real database work (it is the first step of `test:qa`).
 * Feeds assertSafeQaTarget() hostile input and requires every case to throw.
 * Exits non-zero if any unsafe target would have been accepted, or if the
 * legitimate QA target is wrongly rejected.
 *
 * This is pure validation - it opens no database connections.
 */

import {
  assertSafeQaTarget,
  currentTarget,
  UnsafeQaTargetError,
  type QaTarget,
} from "../db/admin.ts";
import { describeConfig } from "../config/env.ts";

const GOOD_ADMIN = "postgresql://superuser@localhost:5432/postgres";

function target(dbName: string, databaseUrl: string, adminDatabaseUrl = GOOD_ADMIN): QaTarget {
  return { dbName, databaseUrl, adminDatabaseUrl };
}

interface Case {
  why: string;
  target: QaTarget;
}

/** Every one of these MUST be rejected. */
const mustReject: Case[] = [
  {
    why: "the live development database",
    target: target("crm_dev", "postgresql://crm:pw@localhost:5432/crm_dev"),
  },
  {
    why: "the postgres maintenance database",
    target: target("postgres", "postgresql://crm:pw@localhost:5432/postgres"),
  },
  {
    why: "an unrelated project database",
    target: target("overnight_dev", "postgresql://crm:pw@localhost:5432/overnight_dev"),
  },
  {
    why: "a template database",
    target: target("template1", "postgresql://crm:pw@localhost:5432/template1"),
  },
  {
    why: "the personal role database",
    target: target("jasoncox", "postgresql://crm:pw@localhost:5432/jasoncox"),
  },
  {
    why: "name says crm_qa but the URL points at crm_dev (mismatch redirect)",
    target: target("crm_qa", "postgresql://crm:pw@localhost:5432/crm_dev"),
  },
  {
    why: "URL says crm_qa but the guarded name is crm_dev",
    target: target("crm_dev", "postgresql://crm:pw@localhost:5432/crm_qa"),
  },
  {
    why: "SQL injection attempt in the database name",
    target: target(
      'crm_qa"; DROP DATABASE crm_dev; --',
      'postgresql://crm:pw@localhost:5432/crm_qa"; DROP DATABASE crm_dev; --',
    ),
  },
  {
    why: "trailing semicolon and second statement",
    target: target("crm_qa; DROP DATABASE crm_dev", "postgresql://crm:pw@localhost:5432/crm_qa"),
  },
  {
    why: "whitespace padding used to slip past a naive comparison",
    target: target(" crm_qa", "postgresql://crm:pw@localhost:5432/ crm_qa"),
  },
  {
    why: "a name that merely contains crm_qa as a prefix of something else",
    target: target("crm_qadev", "postgresql://crm:pw@localhost:5432/crm_qadev"),
  },
  {
    why: "empty database name",
    target: target("", "postgresql://crm:pw@localhost:5432/"),
  },
  {
    why: "admin URL pointing at an application database instead of postgres",
    target: target(
      "crm_qa",
      "postgresql://crm:pw@localhost:5432/crm_qa",
      "postgresql://superuser@localhost:5432/crm_dev",
    ),
  },
  {
    why: "unparseable QA connection string",
    target: target("crm_qa", "not-a-url"),
  },
  {
    why: "uppercase evasion of the denylist",
    target: target("CRM_DEV", "postgresql://crm:pw@localhost:5432/CRM_DEV"),
  },
];

/** These MUST be accepted. */
const mustAccept: Case[] = [
  {
    why: "the canonical QA database",
    target: target("crm_qa", "postgresql://crm:pw@localhost:5432/crm_qa"),
  },
  {
    why: "a suffixed QA database (e.g. a parallel shard)",
    target: target("crm_qa_ci", "postgresql://crm:pw@localhost:5432/crm_qa_ci"),
  },
];

let failures = 0;

console.log("=".repeat(72));
console.log("QA destructive-operation guard check");
console.log("=".repeat(72));

console.log("\n-- Must be REJECTED " + "-".repeat(51));
for (const testCase of mustReject) {
  let threw: Error | null = null;
  try {
    assertSafeQaTarget(testCase.target);
  } catch (error) {
    threw = error as Error;
  }

  if (threw instanceof UnsafeQaTargetError) {
    console.log(`  PASS  rejected: ${testCase.why}`);
  } else if (threw) {
    console.log(`  PASS  rejected: ${testCase.why} (${threw.name})`);
  } else {
    console.error(`  FAIL  ACCEPTED UNSAFE TARGET: ${testCase.why}`);
    console.error(`        dbName=${JSON.stringify(testCase.target.dbName)}`);
    failures += 1;
  }
}

console.log("\n-- Must be ACCEPTED " + "-".repeat(51));
for (const testCase of mustAccept) {
  try {
    assertSafeQaTarget(testCase.target);
    console.log(`  PASS  accepted: ${testCase.why}`);
  } catch (error) {
    console.error(`  FAIL  wrongly rejected: ${testCase.why}`);
    console.error(`        ${(error as Error).message}`);
    failures += 1;
  }
}

console.log("\n-- Live configuration " + "-".repeat(49));
try {
  const live = currentTarget();
  assertSafeQaTarget(live);
  console.log(`  PASS  configured target "${live.dbName}" is a safe QA database`);
  console.log("\n" + describeConfig());
} catch (error) {
  console.error(`  FAIL  configured target is unsafe: ${(error as Error).message}`);
  failures += 1;
}

console.log("\n" + "=".repeat(72));
if (failures > 0) {
  console.error(`GUARD CHECK FAILED: ${failures} problem(s). No database work will run.`);
  process.exit(1);
}
console.log(
  `GUARD CHECK PASSED: ${mustReject.length} unsafe targets rejected, ` +
    `${mustAccept.length} safe targets accepted.`,
);
console.log("=".repeat(72) + "\n");
