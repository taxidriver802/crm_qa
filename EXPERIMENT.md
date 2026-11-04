# Experiment `experiment/CC_expansion` — QA changes

The full decision log is in
[`../crm_backend/docs/EXPERIMENT.md`](../crm_backend/docs/EXPERIMENT.md).

The backend added a job lifecycle past the sale (Sold → Work Scheduled →
In Progress → Work Complete → Closed, Lost off-path) and a payments ledger
(deposit and final invoices, partial payments, derived invoice status). What
changed in this repo:

- `db/schema.ts`: applies `patch_phase23_job_lifecycle_money.sql` last.
- `db/admin.ts`: truncates `invoice_payments` on reseed.
- `db/seed-data.ts`, `db/seed.ts`:
  - The lifecycle vocabulary (`Closed Won` → `Closed`).
  - Milestones derived from status on fixed dates, and `approved_at`.
  - Invoice kind, prior billing, `amount_paid`, `sent_at`, and payment rows.
    The seed throws if a Paid status disagrees with its payments.
  - A new repeat-customer job in billing: Helen Brooks, "Gutter guard
    install". Deposit INV-1004 is paid; final INV-1005 has $960 due.
  - The manifest gains `billingJobId`, `balanceInvoiceId` and
    `approvedEstimateId`.
- `tests/e2e/infrastructure.spec.ts`: seed counts (5 jobs, 4 estimates, 5
  invoices).
- `tests/e2e/job-lifecycle.spec.ts` (new):
  - Read-only checks at every viewport: billing job page, jobs phase filter,
    invoice ledger, dashboard money metric, customer portal and public
    invoice, each with an overflow check.
  - One desktop-only end-to-end flow, from client approval to the job closing
    itself on final payment. It creates its own records, so fixtures stay
    unchanged.
  - Portal and share tokens are minted per test and never stored in the
    manifest.
- `config/routes.ts`: catalogues `/public/invoice/{invoiceToken}`.

Last full run (`npm run test:qa`, scratch Postgres on 5433, database
`crm_qa`, ports 3100/4100): 209 passed, 11 skipped, 4 failed. All four
failures are `infrastructure › criterion 9`, because `crm_dev` and
`overnight_dev` don't exist on the scratch admin server. See the backend log,
§7–8.
