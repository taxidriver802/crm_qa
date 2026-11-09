/**
 * Lifecycle drift check.
 *
 * The backend owns the job lifecycle and the money vocabulary
 * (crm_backend/src/lib/jobLifecycle.ts, invoices.service.ts,
 * estimates.service.ts). The frontend mirrors the names it shows
 * (crm_frontend/src/lib/job-lifecycle.js, status-tones.js) and handles each
 * next-step action the backend can return (components/jobs/job-next-step.js).
 * There is deliberately no shared package, so this script reads both sides'
 * source and fails when they disagree: a status the UI cannot show, a phase
 * that groups differently, a payment method the API refuses, a next step
 * with no control.
 *
 * It reads source text only. Importing backend modules would open the
 * database pool, and the frontend files use the Next alias. Runs in
 * `test:qa` before any database work.
 */

import fs from "node:fs";
import path from "node:path";
import { qaEnv } from "../config/env.ts";

const backend = (rel: string) => fs.readFileSync(path.join(qaEnv.backendPath, rel), "utf8");
const frontend = (rel: string) => fs.readFileSync(path.join(qaEnv.frontendPath, rel), "utf8");

const failures: string[] = [];
let checks = 0;

function quoted(text: string): string[] {
  return [...text.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

function block(src: string, pattern: RegExp, what: string): string {
  const match = src.match(pattern);
  if (!match) {
    failures.push(`could not find ${what} — update lifecycle-drift-check.ts if it moved`);
    return "";
  }
  return match[1];
}

function arrayOf(src: string, name: string, file: string): string[] {
  return quoted(
    block(src, new RegExp(`export const ${name}(?:\\s*:[^=]+)?\\s*=\\s*\\[([\\s\\S]*?)\\]`), `${name} in ${file}`),
  );
}

function objectKeys(body: string): string[] {
  return [...body.matchAll(/(?:^|[\s,{])(?:['"]([^'"]+)['"]|([A-Za-z_][\w]*))\s*:/g)].map((m) => m[1] ?? m[2]);
}

function sameList(what: string, left: string[], right: string[], { ordered = false } = {}) {
  checks += 1;
  const a = ordered ? left : [...left].sort();
  const b = ordered ? right : [...right].sort();
  if (a.length === 0 || b.length === 0 || a.join("|") !== b.join("|")) {
    const missing = left.filter((x) => !right.includes(x));
    const extra = right.filter((x) => !left.includes(x));
    failures.push(
      `${what}: backend [${left.join(", ")}] vs frontend [${right.join(", ")}]` +
        (missing.length ? ` — missing on frontend: ${missing.join(", ")}` : "") +
        (extra.length ? ` — unknown to backend: ${extra.join(", ")}` : "") +
        (ordered && !missing.length && !extra.length ? " — order differs" : ""),
    );
  }
}

// --- backend -----------------------------------------------------------------
const lifecycle = backend("src/lib/jobLifecycle.ts");
const invoices = backend("src/services/invoices.service.ts");
const estimates = backend("src/services/estimates.service.ts");

const beStatuses = arrayOf(lifecycle, "JOB_STATUSES", "jobLifecycle.ts");
const bePhases = arrayOf(lifecycle, "JOB_PHASES", "jobLifecycle.ts");
const bePhaseBody = block(lifecycle, /const PHASE_BY_STATUS[^=]*=\s*\{([\s\S]*?)\};/, "PHASE_BY_STATUS");
const bePhaseOf = new Map(
  [...bePhaseBody.matchAll(/(?:['"]([^'"]+)['"]|([A-Za-z]+))\s*:\s*'([a-z]+)'/g)].map((m) => [m[1] ?? m[2], m[3]]),
);
const beActions = quoted(block(lifecycle, /export type NextStepAction\s*=([\s\S]*?);/, "NextStepAction"));
const beInvoiceStatuses = arrayOf(invoices, "INVOICE_STATUSES", "invoices.service.ts");
const beInvoiceKinds = arrayOf(invoices, "INVOICE_KINDS", "invoices.service.ts");
const bePaymentMethods = arrayOf(invoices, "PAYMENT_METHODS", "invoices.service.ts");
const beEstimateStatuses = quoted(
  block(estimates, /\n\s+status:\s*((?:'[^']+'\s*\|?\s*)+);/, "estimate status union in estimates.service.ts"),
);

// --- frontend ----------------------------------------------------------------
const feLifecycle = frontend("src/lib/job-lifecycle.js");
const feTones = frontend("src/lib/status-tones.js");
const feNextStep = frontend("src/components/jobs/job-next-step.js");
const feDocuments = frontend("src/lib/documents.js");

const feStatuses = arrayOf(feLifecycle, "JOB_STATUSES", "job-lifecycle.js");
const fePhaseBlocks = [
  ...block(feLifecycle, /export const JOB_PHASES\s*=\s*\[([\s\S]*?)\n\];/, "JOB_PHASES in job-lifecycle.js").matchAll(
    /id:\s*"([^"]+)"[\s\S]*?statuses:\s*\[([^\]]*)\]/g,
  ),
].map((m) => ({ id: m[1], statuses: quoted(m[2]) }));
const fePhases = fePhaseBlocks.map((p) => p.id);
const fePaymentMethods = [
  ...block(feLifecycle, /export const PAYMENT_METHODS\s*=\s*\[([\s\S]*?)\];/, "PAYMENT_METHODS in job-lifecycle.js").matchAll(
    /value:\s*"([^"]+)"/g,
  ),
].map((m) => m[1]);
const feInvoiceKinds = objectKeys(
  block(feLifecycle, /export const INVOICE_KIND_LABEL\s*=\s*\{([\s\S]*?)\};/, "INVOICE_KIND_LABEL"),
);
const toneKeys = (kind: string) =>
  objectKeys(block(feTones, new RegExp(`\\n  ${kind}:\\s*\\{([\\s\\S]*?)\\n  \\}`), `STATUS_TONE.${kind}`));
const feHandledActions = [...feNextStep.matchAll(/case\s+"([a-z_]+)":/g)].map((m) => m[1]);
const feOpenInvoice = arrayOf(feDocuments, "OPEN_INVOICE_STATUSES", "documents.js");

// --- compare -----------------------------------------------------------------
sameList("job statuses (and their order on the path)", beStatuses, feStatuses, { ordered: true });
sameList("job phases (and their order)", bePhases, fePhases, { ordered: true });
for (const phase of fePhaseBlocks) {
  const expected = beStatuses.filter((s) => bePhaseOf.get(s) === phase.id);
  sameList(`statuses in the ${phase.id} phase`, expected, phase.statuses, { ordered: true });
}
sameList("job status tones", beStatuses, toneKeys("job"));
sameList("invoice statuses with a tone", beInvoiceStatuses, toneKeys("invoice"));
sameList("estimate statuses with a tone", beEstimateStatuses, toneKeys("estimate"));
sameList("invoice kinds with a label", beInvoiceKinds, feInvoiceKinds);
sameList("payment methods", bePaymentMethods, fePaymentMethods);
sameList(
  "next-step actions with a control on the job",
  beActions.filter((a) => a !== "none"),
  feHandledActions,
);
checks += 1;
const unknownOpen = feOpenInvoice.filter((s) => !beInvoiceStatuses.includes(s));
if (feOpenInvoice.length === 0 || unknownOpen.length) {
  failures.push(`open invoice statuses in documents.js not known to the backend: ${unknownOpen.join(", ") || "(none found)"}`);
}

if (failures.length) {
  console.error(`[lifecycle-drift] ${failures.length} of ${checks} checks failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `[lifecycle-drift] ok — ${checks} checks: ${beStatuses.length} statuses, ${bePhases.length} phases, ` +
    `${beActions.length - 1} next-step actions, ${beInvoiceStatuses.length} invoice statuses, ` +
    `${bePaymentMethods.length} payment methods agree`,
);
