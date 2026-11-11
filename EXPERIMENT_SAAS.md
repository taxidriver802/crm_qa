# Experiment: SaaS plan (`experiment/CC_saas_plan`)

Branch cut from `experiment/CC_final` at `20e0f9940b48`. The plan, ranking
the work that makes Joist hostable, is
`crm_backend/docs/EXPERIMENT_SAAS.md`.

On `experiment/CC_saas_plan` this file is the only change. Progress is
ticked in the plan's **5. Sequence** checklist.

## Step 1 (`experiment/CC_public_host`)

- `tests/e2e/public-host.spec.ts` (desktop-1440 only): pages carry
  `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff` and the
  referrer policy; `/api/health` comes through the rewrite with helmet's
  headers and `"database": "ok"`; the public logo is served with a
  `sandbox` CSP.
- No other spec changed. The full suite passes with the new rate limits
  (287 passed): QA registers about five companies and fails about four
  sign-ins per run, well under the limits, and successful sign-ins are
  never counted.

## Step 2 (`experiment/CC_backups`)

- No change here. The restore drill took its backup from `crm_qa` (a
  read-only `pg_dump`) because it is seeded with real job photos, and
  restored it into `joist_restore_check`, never into `crm_qa`.
- The backend's Jest suite no longer empties `crm_backend/uploads/`
  (it uses a temporary `UPLOADS_DIR`), so the QA photo fixtures there now
  stay between runs. QA still seeds them into the default uploads
  directory.
- The full suite passes on the step 2 backend.

## Step 3 (`experiment/CC_tenancy`)

- `db/seed.ts`: every fixture insert names its company. `company_id` has
  no default now (backend migration 0002), so writes go through a small
  wrapper that refuses an INSERT without it. A new database has no
  company, so the seed puts Rooftop Realty back from the backend's own
  baseline starting rows (`db/schema.ts` `rooftopStartingRowsSql()`) and
  checks its slug.
- `tests/e2e/tenancy.spec.ts` (desktop-1440 and phone-390): a company
  registered beside Rooftop sees its own lead, job and invoice and none of
  Rooftop's records in the lists or in search. Rooftop's record URLs read
  "isn’t available", like an id nobody has. Its first invoice is INV-0001
  (Rooftop's seed ends at INV-1005). Rooftop's owner can't find or open
  what it made. It registers one company per width, because registration
  is limited to 10 an hour per address. The limiter is in memory, so the
  count starts again with each run's backend, and a run registers about
  seven.
- The full suite passes on the step 3 backend: 292 passed, 96 skipped at
  other widths, none failed.

## Step 4 (`experiment/CC_way_back_in`)

- `tests/e2e/accounts.spec.ts`. QA has no SMTP, so it drives the
  copied-link path. Each test invites its own agent through the owner's
  API session, and none touches the owner's shared session:
  - Forgot password (1440 and 390) says this Joist can't send email and
    to ask an owner or admin.
  - An owner makes a reset link from the Users page (1440). Using it on a
    new browser sets the password and signs in. The person's earlier
    browser and API sessions get 401, the old password fails, Account
    history shows the reset, and the link then reads "already been used".
  - Preferences (1440 and 390): a wrong current password is refused;
    Change password signs out the other device and keeps this one; "Sign
    out everywhere else" ends a later sign-in.
  - Log out (1440): a copy of the cookie taken before signing out gets
    401, while the person's other session still works.
- Backend migration 0003 ends every older sign-in. Global setup signs in
  fresh on each run, so nothing else changed.
- The full suite passes on the step 4 backend and frontend: 298 passed,
  106 skipped at other widths, none failed.

## Where the plan reaches this repo

| Prospect | What it would touch here |
|---|---|
| 1. A public host that fails closed | `npm run test:qa` keeps passing with the production boot checks in place (QA stays on development defaults, ports 3100/4100, database `crm_qa`) |
| 2. Abuse limits | QA's serial sign-ins must stay under the login limit, or QA's environment raises it |
| 3. Rows that can't land in another company | `db/seed-data.ts` names `company_id` everywhere once the column defaults are dropped; a spec that signs in as a second company and sees none of Rooftop's records |
| 4. A way back in, and sessions that end | Forgot and reset, change password, and Sign out ending the session. Mail stays unconfigured in QA, so the copied-link path is the one driven |
| 5. Backups | The restore drill borrows the guard pattern in `db/admin.ts` (named scratch database, refused targets) |
