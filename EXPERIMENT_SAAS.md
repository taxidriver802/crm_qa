# Experiment: SaaS plan (`experiment/CC_saas_plan`)

Branch cut from `experiment/CC_final` at `20e0f9940b48`. The plan, ranking
the work that makes Joist hostable, is
`crm_backend/docs/EXPERIMENT_SAAS.md`.

**This repository's product code and tests did not change.** This file is
the only change on the branch.

## Where the plan reaches this repo

| Prospect | What it would touch here |
|---|---|
| 1. A public host that fails closed | `npm run test:qa` keeps passing with the production boot checks in place (QA stays on development defaults, ports 3100/4100, database `crm_qa`) |
| 2. Abuse limits | QA's serial sign-ins must stay under the login limit, or QA's environment raises it |
| 3. Rows that can't land in another company | `db/seed-data.ts` names `company_id` everywhere once the column defaults are dropped; a spec that signs in as a second company and sees none of Rooftop's records |
| 4. A way back in, and sessions that end | Forgot and reset, change password, and Sign out ending the session. Mail stays unconfigured in QA, so the copied-link path is the one driven |
| 5. Backups | The restore drill borrows the guard pattern in `db/admin.ts` (named scratch database, refused targets) |
