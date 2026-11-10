/**
 * Inserts the deterministic QA fixture set into the crm_qa database.
 *
 * Runs inside a single transaction. All ids returned by the database are
 * captured into the seed manifest (see manifest.ts) so tests reference real
 * ids rather than assuming serials start at 1.
 *
 * Password hashing happens here, from QA_OWNER_PASSWORD / QA_AGENT_PASSWORD.
 * The plaintext never touches disk or logs.
 */

import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import type pg from "pg";
import { anchorPlusDays, nowPlusDays, QA_SEED_ANCHOR, QA_NOW } from "../config/constants.ts";
import { qaEnv } from "../config/env.ts";
import { withQaClient } from "./admin.ts";
import { writeManifest, type SeedManifest } from "./manifest.ts";
import { rooftopStartingRowsSql } from "./schema.ts";
import {
  ACTIVITY,
  AUTOMATION_RULES,
  ESTIMATES,
  FILES,
  INVOICES,
  JOBS,
  LEADS,
  MEASUREMENTS,
  NOTES,
  NOTIFICATIONS,
  QA_AGENT_ID,
  QA_COMPANY_ID,
  QA_OWNER_ID,
  SAVED_VIEWS,
  TASKS,
} from "./seed-data.ts";

/** bcrypt cost. Low but valid: QA hashes are throwaway and speed matters. */
const BCRYPT_ROUNDS = 10;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Statuses that mean the client said yes (crm_backend jobLifecycle WON_STATUSES). */
const WON = new Set(["Sold", "Work Scheduled", "In Progress", "Work Complete", "Closed"]);

/**
 * Lifecycle milestones for a seeded job, derived from its status so a job
 * listed as Work Complete really was sold and completed, on fixed dates.
 */
function milestonesFor(status: string, createdDayOffset: number) {
  return {
    sold_at: WON.has(status) ? anchorPlusDays(createdDayOffset + 7) : null,
    work_completed_at:
      status === "Work Complete" || status === "Closed"
        ? anchorPlusDays(createdDayOffset + 9)
        : null,
    closed_at: status === "Closed" ? anchorPlusDays(createdDayOffset + 10) : null,
    lost_at: status === "Lost" ? anchorPlusDays(createdDayOffset + 5) : null,
  };
}

/**
 * Every fixture row names its company: company_id has no default (backend
 * migration 0002), so an insert without it fails. Writes go through this,
 * with $company in the SQL, which becomes the next numbered parameter; an
 * INSERT that does not name company_id is refused before it is sent.
 */
function companyScoped(client: pg.Client, companyId: string) {
  return {
    query<R extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []) {
      if (/^\s*INSERT\b/i.test(sql) && !/\bcompany_id\b/.test(sql)) {
        throw new Error(`QA seed insert does not name its company: ${sql.trim().split("\n")[0]}`);
      }
      if (!sql.includes("$company")) return client.query<R>(sql, params);
      return client.query<R>(sql.split("$company").join(`$${params.length + 1}`), [
        ...params,
        companyId,
      ]);
    },
  };
}

/** Copies fixture binaries into the backend's uploads directory. */
function installUploadFixtures(): string[] {
  const source = path.join(qaEnv.qaRoot, "fixtures", "uploads");
  const destination = path.join(qaEnv.backendPath, "uploads");
  fs.mkdirSync(destination, { recursive: true });

  const installed: string[] = [];
  for (const file of FILES) {
    const from = path.join(source, file.fixture);
    if (!fs.existsSync(from)) {
      throw new Error(`Missing upload fixture: ${from}`);
    }
    const to = path.join(destination, file.storage_key);
    fs.copyFileSync(from, to);
    installed.push(file.storage_key);
  }
  return installed;
}

export async function seed(): Promise<SeedManifest> {
  console.log(`\n[qa-seed] anchor : ${QA_SEED_ANCHOR.toISOString()}`);
  console.log(`[qa-seed] pinned now: ${QA_NOW.toISOString()}`);

  const ownerHash = await bcrypt.hash(qaEnv.ownerPassword, BCRYPT_ROUNDS);
  const agentHash = qaEnv.agentPassword
    ? await bcrypt.hash(qaEnv.agentPassword, BCRYPT_ROUNDS)
    : null;

  const storageKeys = installUploadFixtures();
  console.log(`[qa-seed] installed ${storageKeys.length} upload fixture(s) into backend uploads/`);

  return withQaClient(async (client) => {
    await client.query("BEGIN");
    try {
      const manifest = await insertAll(client, ownerHash, agentHash);
      await client.query("COMMIT");
      writeManifest(manifest);
      return manifest;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

async function insertAll(
  client: pg.Client,
  ownerHash: string,
  agentHash: string | null,
): Promise<SeedManifest> {
  // --- company ------------------------------------------------------------
  // A new database has no company (backend migration 0002). The QA company
  // is Rooftop Realty exactly as the backend's baseline defines it: name,
  // built-in logo and estimate templates. A reseed (truncate, then seed)
  // keeps companies, so it is added only when missing.
  const existing = await client.query(`SELECT 1 FROM companies WHERE id = $1`, [QA_COMPANY_ID]);
  if (existing.rowCount === 0) {
    await client.query(rooftopStartingRowsSql());
  }
  const company = await client.query<{ slug: string }>(
    `SELECT slug FROM companies WHERE id = $1`,
    [QA_COMPANY_ID],
  );
  if (company.rows[0]?.slug !== "rooftop") {
    throw new Error(`The baseline's starting rows did not create the QA company ${QA_COMPANY_ID}.`);
  }
  const db = companyScoped(client, QA_COMPANY_ID);

  // --- users --------------------------------------------------------------
  // Fixed UUIDs, so every downstream foreign key is stable run to run.
  await client.query(
    `INSERT INTO users
       (id, first_name, last_name, email, password_hash, role, status,
        company_id, password_set_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'owner', 'active', $6, $7, $7, $7)`,
    [
      QA_OWNER_ID,
      "Quinn",
      "Archer",
      qaEnv.ownerEmail,
      ownerHash,
      QA_COMPANY_ID,
      anchorPlusDays(-30),
    ],
  );

  if (agentHash) {
    await client.query(
      `INSERT INTO users
         (id, first_name, last_name, email, password_hash, role, status,
          company_id, password_set_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'agent', 'active', $6, $7, $7, $7)`,
      [
        QA_AGENT_ID,
        "Avery",
        "Sloan",
        qaEnv.agentEmail,
        agentHash,
        QA_COMPANY_ID,
        anchorPlusDays(-29),
      ],
    );
  }

  // --- leads --------------------------------------------------------------
  const leadIds: Record<string, number> = {};
  for (const lead of LEADS) {
    const at = anchorPlusDays(lead.createdDayOffset);
    const result = await db.query<{ id: number }>(
      `INSERT INTO leads
         (company_id, user_id, assigned_to, first_name, last_name, email, phone, source,
          status, budget_min, budget_max, notes, created_at, updated_at)
       VALUES ($company, $1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
       RETURNING id`,
      [
        QA_OWNER_ID,
        lead.first_name,
        lead.last_name,
        lead.email,
        lead.phone,
        lead.source,
        lead.status,
        lead.budget_min,
        lead.budget_max,
        lead.notes,
        at,
      ],
    );
    leadIds[lead.key] = result.rows[0].id;
  }
  console.log(`[qa-seed] leads: ${Object.keys(leadIds).length}`);

  // --- jobs ---------------------------------------------------------------
  const jobIds: Record<string, number> = {};
  for (const job of JOBS) {
    const at = anchorPlusDays(job.createdDayOffset);
    const milestones = milestonesFor(job.status, job.createdDayOffset);
    const result = await db.query<{ id: number }>(
      `INSERT INTO jobs
         (company_id, user_id, assigned_to, lead_id, title, description, status, address,
          created_at, updated_at, sold_at, work_completed_at, closed_at, lost_at)
       VALUES ($company, $1, $1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        QA_OWNER_ID,
        leadIds[job.leadKey],
        job.title,
        job.description,
        job.status,
        job.address,
        at,
        milestones.sold_at,
        milestones.work_completed_at,
        milestones.closed_at,
        milestones.lost_at,
      ],
    );
    jobIds[job.key] = result.rows[0].id;
  }
  console.log(`[qa-seed] jobs: ${Object.keys(jobIds).length}`);

  // --- tasks --------------------------------------------------------------
  // The schema enforces exactly one owner (lead_id XOR job_id).
  const taskIds: Record<string, number> = {};
  for (const task of TASKS) {
    if ((task.leadKey ? 1 : 0) + (task.jobKey ? 1 : 0) !== 1) {
      throw new Error(
        `Task "${task.key}" must have exactly one of leadKey/jobKey ` +
          `(tasks_exactly_one_owner_check).`,
      );
    }
    const at = anchorPlusDays(task.status === "Completed" ? 5 : 3);
    const due = task.dueDayOffsetFromNow === null ? null : nowPlusDays(task.dueDayOffsetFromNow);
    const result = await db.query<{ id: number }>(
      `INSERT INTO tasks
         (company_id, user_id, assigned_to, lead_id, job_id, title, description, due_date,
          status, created_at, updated_at)
       VALUES ($company, $1, $1, $2, $3, $4, $5, $6, $7, $8, $8)
       RETURNING id`,
      [
        QA_OWNER_ID,
        task.leadKey ? leadIds[task.leadKey] : null,
        task.jobKey ? jobIds[task.jobKey] : null,
        task.title,
        task.description,
        due,
        task.status,
        at,
      ],
    );
    taskIds[task.key] = result.rows[0].id;
  }
  console.log(`[qa-seed] tasks: ${Object.keys(taskIds).length}`);

  // --- estimates and line items -------------------------------------------
  const estimateIds: Record<string, number> = {};
  for (const estimate of ESTIMATES) {
    const subtotal = round2(
      estimate.lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0),
    );
    const taxable = Math.max(0, subtotal - estimate.discount);
    const tax = round2(taxable * estimate.taxRate);
    const grand = round2(taxable + tax);
    const at = anchorPlusDays(estimate.createdDayOffset);

    const result = await db.query<{ id: number }>(
      `INSERT INTO estimates
         (company_id, user_id, job_id, title, status, subtotal, tax_total, discount_total,
          grand_total, notes, client_responded_at, client_response_note,
          created_at, updated_at, approved_at)
       VALUES ($company, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $13)
       RETURNING id`,
      [
        QA_OWNER_ID,
        jobIds[estimate.jobKey],
        estimate.title,
        estimate.status,
        subtotal,
        tax,
        estimate.discount,
        grand,
        estimate.notes,
        estimate.respondedDayOffset === undefined
          ? null
          : anchorPlusDays(estimate.respondedDayOffset),
        estimate.responseNote ?? null,
        at,
        estimate.approvedDayOffset === undefined
          ? null
          : anchorPlusDays(estimate.approvedDayOffset),
      ],
    );
    const estimateId = result.rows[0].id;
    estimateIds[estimate.key] = estimateId;

    let sortOrder = 0;
    for (const line of estimate.lines) {
      await db.query(
        `INSERT INTO estimate_line_items
           (company_id, estimate_id, name, description, quantity, unit_price, line_total,
            sort_order, source, created_at, updated_at)
         VALUES ($company, $1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
        [
          estimateId,
          line.name,
          line.description,
          line.quantity,
          line.unit_price,
          round2(line.quantity * line.unit_price),
          sortOrder,
          line.source,
          at,
        ],
      );
      sortOrder += 1;
    }
  }
  console.log(`[qa-seed] estimates: ${Object.keys(estimateIds).length}`);

  // --- invoices and line items --------------------------------------------
  const invoiceIds: Record<string, number> = {};
  const invoiceGrand: Record<string, number> = {};
  let paymentCount = 0;
  for (const invoice of INVOICES) {
    const subtotal = round2(
      invoice.lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0),
    );
    const taxable = Math.max(0, subtotal - invoice.discount);
    const tax = round2(taxable * invoice.taxRate);
    const priorBilled = invoice.priorBilledFromKey
      ? invoiceGrand[invoice.priorBilledFromKey] ?? 0
      : 0;
    const grand = round2(Math.max(0, taxable + tax - priorBilled));
    const at = anchorPlusDays(invoice.createdDayOffset);
    const payments = (invoice.payments ?? []).map((payment) => ({
      ...payment,
      amount: payment.amount < 0 ? grand : payment.amount,
    }));
    const amountPaid = round2(payments.reduce((sum, payment) => sum + payment.amount, 0));
    if ((invoice.status === "Paid") !== (amountPaid >= grand && grand > 0)) {
      throw new Error(
        `Seed invoice ${invoice.invoice_number}: status ${invoice.status} disagrees with ` +
          `its payments (${amountPaid} of ${grand}).`,
      );
    }

    const result = await db.query<{ id: number }>(
      `INSERT INTO invoices
         (company_id, user_id, job_id, estimate_id, invoice_number, status, subtotal,
          tax_total, discount_total, grand_total, due_date, paid_at, notes,
          created_at, updated_at, kind, prior_billed_total, amount_paid, sent_at)
       VALUES ($company, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13,
               $14, $15, $16, $17)
       RETURNING id`,
      [
        QA_OWNER_ID,
        jobIds[invoice.jobKey],
        invoice.estimateKey ? estimateIds[invoice.estimateKey] : null,
        invoice.invoice_number,
        invoice.status,
        subtotal,
        tax,
        invoice.discount,
        grand,
        invoice.dueDayOffsetFromNow === null ? null : nowPlusDays(invoice.dueDayOffsetFromNow),
        invoice.paidDayOffsetFromNow === undefined
          ? null
          : nowPlusDays(invoice.paidDayOffsetFromNow),
        invoice.notes,
        at,
        invoice.kind ?? "standard",
        priorBilled,
        amountPaid,
        invoice.status === "Draft" ? null : at,
      ],
    );
    const invoiceId = result.rows[0].id;
    invoiceIds[invoice.key] = invoiceId;
    invoiceGrand[invoice.key] = grand;

    for (const payment of payments) {
      await db.query(
        `INSERT INTO invoice_payments
           (company_id, invoice_id, job_id, recorded_by_user_id, amount, method,
            reference, received_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [
          QA_COMPANY_ID,
          invoiceId,
          jobIds[invoice.jobKey],
          QA_OWNER_ID,
          payment.amount,
          payment.method,
          payment.reference,
          anchorPlusDays(payment.receivedDayOffset),
        ],
      );
      paymentCount += 1;
    }

    let sortOrder = 0;
    for (const line of invoice.lines) {
      await db.query(
        `INSERT INTO invoice_line_items
           (company_id, invoice_id, name, description, quantity, unit_price, line_total,
            sort_order, created_at, updated_at)
         VALUES ($company, $1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [
          invoiceId,
          line.name,
          line.description,
          line.quantity,
          line.unit_price,
          round2(line.quantity * line.unit_price),
          sortOrder,
          at,
        ],
      );
      sortOrder += 1;
    }
  }
  console.log(
    `[qa-seed] invoices: ${Object.keys(invoiceIds).length} (${paymentCount} payments)`,
  );

  // --- measurements -------------------------------------------------------
  let measurementOrder: Record<string, number> = {};
  for (const measurement of MEASUREMENTS) {
    const order = measurementOrder[measurement.jobKey] ?? 0;
    measurementOrder[measurement.jobKey] = order + 1;
    await db.query(
      `INSERT INTO job_measurements
         (company_id, job_id, label, value, unit, sort_order, created_at, updated_at)
       VALUES ($company, $1, $2, $3, $4, $5, $6, $6)`,
      [
        jobIds[measurement.jobKey],
        measurement.label,
        measurement.value,
        measurement.unit,
        order,
        anchorPlusDays(7),
      ],
    );
  }
  console.log(`[qa-seed] measurements: ${MEASUREMENTS.length}`);

  // --- notes --------------------------------------------------------------
  for (const note of NOTES) {
    const entityId =
      note.entityType === "lead" ? leadIds[note.entityKey] : jobIds[note.entityKey];
    const at = anchorPlusDays(note.createdDayOffset);
    await db.query(
      `INSERT INTO notes (company_id, user_id, entity_type, entity_id, body, created_at, updated_at)
       VALUES ($company, $1, $2, $3, $4, $5, $5)`,
      [QA_OWNER_ID, note.entityType, entityId, note.body, at],
    );
  }
  console.log(`[qa-seed] notes: ${NOTES.length}`);

  // --- job activity -------------------------------------------------------
  for (const entry of ACTIVITY) {
    await db.query(
      `INSERT INTO job_activity (company_id, user_id, job_id, type, title, message, created_at)
       VALUES ($company, $1, $2, $3, $4, $5, $6)`,
      [
        QA_OWNER_ID,
        jobIds[entry.jobKey],
        entry.type,
        entry.title,
        entry.message,
        anchorPlusDays(entry.createdDayOffset),
      ],
    );
  }
  console.log(`[qa-seed] activity: ${ACTIVITY.length}`);

  // --- files --------------------------------------------------------------
  const fileIds: Record<string, number> = {};
  const fixtureDir = path.join(qaEnv.qaRoot, "fixtures", "uploads");
  for (const file of FILES) {
    const sizeBytes = fs.statSync(path.join(fixtureDir, file.fixture)).size;
    const result = await db.query<{ id: number }>(
      `INSERT INTO files
         (company_id, uploaded_by_user_id, original_name, storage_key, mime_type,
          size_bytes, lead_id, job_id, created_at)
       VALUES ($company, $1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        QA_OWNER_ID,
        file.original_name,
        file.storage_key,
        file.mime_type,
        sizeBytes,
        file.leadKey ? leadIds[file.leadKey] : null,
        file.jobKey ? jobIds[file.jobKey] : null,
        anchorPlusDays(file.createdDayOffset),
      ],
    );
    fileIds[file.key] = result.rows[0].id;
  }
  console.log(`[qa-seed] files: ${Object.keys(fileIds).length}`);

  // --- notifications ------------------------------------------------------
  const entityLookup: Record<string, Record<string, number>> = {
    lead: leadIds,
    job: jobIds,
    task: taskIds,
    estimate: estimateIds,
    invoice: invoiceIds,
  };
  let notificationIndex = 0;
  for (const notification of NOTIFICATIONS) {
    const at = anchorPlusDays(notification.createdDayOffset);
    const entityId =
      notification.entityKind && notification.entityKey
        ? entityLookup[notification.entityKind][notification.entityKey]
        : null;
    await db.query(
      `INSERT INTO notifications
         (company_id, user_id, type, title, message, entity_type, entity_id, read_at,
          dedupe_key, created_at)
       VALUES ($company, $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        QA_OWNER_ID,
        notification.type,
        notification.title,
        notification.message,
        notification.entityType,
        entityId,
        notification.read ? anchorPlusDays(23) : null,
        // Deterministic dedupe key: the unique index requires distinct values.
        `qa-seed-${notificationIndex}`,
        at,
      ],
    );
    notificationIndex += 1;
  }
  const unread = NOTIFICATIONS.filter((n) => !n.read).length;
  console.log(`[qa-seed] notifications: ${NOTIFICATIONS.length} (${unread} unread)`);

  // --- saved views --------------------------------------------------------
  for (const view of SAVED_VIEWS) {
    await db.query(
      `INSERT INTO saved_views (company_id, user_id, entity_type, name, filters, created_at, updated_at)
       VALUES ($company, $1, $2, $3, $4::jsonb, $5, $5)`,
      [QA_OWNER_ID, view.entity_type, view.name, JSON.stringify(view.filters), anchorPlusDays(24)],
    );
  }
  console.log(`[qa-seed] saved views: ${SAVED_VIEWS.length}`);

  // --- automation rules ---------------------------------------------------
  for (const rule of AUTOMATION_RULES) {
    await db.query(
      `INSERT INTO automation_rules
         (company_id, user_id, name, description, trigger_event, conditions, action_type,
          action_config, enabled, created_at, updated_at)
       VALUES ($company, $1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9, $9)`,
      [
        QA_OWNER_ID,
        rule.name,
        rule.description,
        rule.trigger_event,
        JSON.stringify(rule.conditions),
        rule.action_type,
        JSON.stringify(rule.action_config),
        rule.enabled,
        anchorPlusDays(25),
      ],
    );
  }
  console.log(`[qa-seed] automation rules: ${AUTOMATION_RULES.length}`);

  return {
    generatedFrom: {
      seedAnchor: QA_SEED_ANCHOR.toISOString(),
      pinnedNow: QA_NOW.toISOString(),
      database: qaEnv.dbName,
    },
    users: {
      ownerId: QA_OWNER_ID,
      ownerEmail: qaEnv.ownerEmail,
      agentId: agentHash ? QA_AGENT_ID : null,
      agentEmail: agentHash ? qaEnv.agentEmail : null,
      companyId: QA_COMPANY_ID,
    },
    leads: leadIds,
    jobs: jobIds,
    tasks: taskIds,
    estimates: estimateIds,
    invoices: invoiceIds,
    files: fileIds,
    /** Convenience tokens consumed by config/routes.ts resolveRoutePath(). */
    routeTokens: {
      leadId: leadIds["webb"],
      emptyLeadId: leadIds["nakamura"],
      jobId: jobIds["webb-reroof"],
      taskId: taskIds["adjuster-meeting"],
      estimateId: estimateIds["webb-primary"],
      invoiceId: invoiceIds["webb-sent"],
      // Phase 23: a job in billing with a deposit paid and a balance due.
      billingJobId: jobIds["brooks-gutters"],
      balanceInvoiceId: invoiceIds["brooks-gutters-final"],
      approvedEstimateId: estimateIds["brooks-gutters-scope"],
    },
  };
}
