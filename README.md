# crm_qa

External automated QA harness for the CRM. Drives the real `crm_frontend` and
`crm_backend` against a dedicated, deterministically seeded `crm_qa` database —
without modifying either application repository, exposing the app publicly, or
disturbing a running development environment.

**Phase 2 (this milestone): Playwright foundation.** Database lifecycle,
deterministic seed, real authentication with session reuse, server
orchestration, and route smoke coverage across four viewports.
Accessibility (Phase 3), visual regression (Phase 4), Lighthouse (Phase 5) and
CI (Phase 6) are not implemented yet.

## Quick start

```bash
cp .env.qa.example .env.qa.local   # then fill in real values
npm install
npm run qa:install                 # one-time Playwright browser download
npm run test:qa
```

`npm run test:qa` runs the whole pipeline: guard check → database reset, schema
and seed → staged frontend build → Playwright across all four viewports.

## How isolation works

Three properties keep a QA run from touching your development setup.

**Separate ports.** QA binds 3100 (frontend) and 4100 (backend). `config/env.ts`
refuses to start if either is configured as 3000 or 4000, and Playwright uses
`reuseExistingServer: false` so it never adopts a server it did not start.

**Separate database.** QA uses `crm_qa`, never `crm_dev`. Every destructive
statement routes through `db/admin.ts`, which validates the target five ways
before executing — see below.

**Separate build output.** `next build` cannot be told to write elsewhere
without editing `next.config.mjs`, and `next dev` and `next build` share the
same `.next`. So `scripts/prepare-frontend.mjs` stages a copy of the frontend
into `.qa-build/frontend/` (excluding `node_modules`, `.next`, `.git`, `.env*`)
and builds there. `crm_frontend/.next` is never written — the smoke suite
asserts this by comparing `BUILD_ID`s.

## Database safety

`assertSafeQaTarget()` in `db/admin.ts` gates every drop and truncate:

1. the name must match `/^crm_qa(_[a-z0-9_]+)?$/`
2. the name must not be in `PROTECTED_DATABASES` (`crm_dev`, `postgres`,
   `overnight_dev`, `template0`, `template1`, `jasoncox`), matched
   case-insensitively
3. `QA_DB_NAME` must equal the database inside `QA_DATABASE_URL` exactly, so a
   stale env file cannot redirect a drop
4. `QA_ADMIN_DATABASE_URL` must target the `postgres` maintenance database
5. the guard is re-asserted at execution time, and `truncateAll` additionally
   asks the open connection `SELECT current_database()` before firing

`npm run qa:guard-check` feeds the guard 15 hostile targets — including
`crm_dev`, SQL injection in the name, and a name/URL mismatch — and fails if
any is accepted. It runs first in `test:qa`, before any database work.

## Determinism

Visual regression in Phase 4 needs pixel-identical input, which requires
removing every source of run-to-run variation:

- **Fixed seed anchor.** All seeded timestamps derive from `QA_SEED_ANCHOR`
  (`2026-03-02T09:00Z`), so rendered dates never drift. This is the primary
  mechanism.
- **Pinned browser clock.** `page.clock.setFixedTime(QA_NOW)` makes relative
  labels ("overdue", "due today") agree with that fixed data.
- **Fixed user UUIDs.** The `users` table defaults to `gen_random_uuid()`, so
  the seed supplies explicit ids.
- **Pinned `localStorage`.** Theme, palette, sidebar and list view modes are
  set before first paint rather than inherited.
- **No background jobs.** The backend runs with `NODE_ENV=test`, which skips
  the two `setInterval` jobs in `crm_backend/src/app.ts` that would otherwise
  mutate seeded rows mid-run, and leaves SMTP unconfigured so nothing can send
  real email.

Verified by resetting and reseeding twice and comparing an MD5 over all seeded
content: the digests match.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run test:qa` | Full pipeline: guards, database, build, tests |
| `npm run test:e2e` | Tests only, against the existing database and build |
| `npm run qa:guard-check` | Prove the destructive guards reject unsafe targets |
| `npm run qa:db:setup` | Drop, recreate, apply schema, seed |
| `npm run qa:db:reseed` | Truncate and reseed (fast inner loop) |
| `npm run qa:db:verify` | Report row counts; makes no writes |
| `npm run qa:prepare` | Stage the isolated frontend copy |
| `npm run qa:build` | Production-build the staged copy |
| `npm run qa:verify-hygiene` | Fail if any secret reached a tracked file or artifact |

Useful Playwright flags: `--project=phone-390` for a single viewport,
`--ui` for the interactive runner, `--headed` to watch.

## Layout

```
config/      env, constants, viewport matrix, route registry
db/          guards, schema application, deterministic seed, manifest
scripts/     database CLI, frontend staging/build, guard + hygiene checks
tests/
  global-setup.ts   logs in once, saves storageState
  fixtures/         extended test object (+ gitignored .auth/ and manifest)
  utils/            auth, readiness, stabilisation, navigation helpers
  e2e/              infrastructure, auth, and route smoke specs
fixtures/uploads/   deterministic file-upload fixtures
qa-artifacts/       generated reports (gitignored)
.qa-build/          staged frontend copy (gitignored)
```

## Viewports

Chosen to straddle the app's real breakpoints, not for round numbers. Tailwind
defaults apply (`sm:640 md:768 lg:1024 xl:1280`), plus a hand-written
`max-width: 767px` rule in `globals.css` where tables collapse into cards, and
a `lg:hidden` bottom nav.

| Project | Size | Navigation | Tables |
| --- | --- | --- | --- |
| `desktop-1440` | 1440×900 | sidebar | table |
| `laptop-1280` | 1280×800 | sidebar | table |
| `tablet-768` | 768×1024 | **mobile** | **table** |
| `phone-390` | 390×844 | mobile | stacked cards |

`tablet-768` is the interesting one: at exactly 768px tables have returned
(`≥ md`) but navigation is still mobile (`< lg`). That combination exists at no
other width.

## Secrets

All QA secrets live in `.env.qa.local`, which is gitignored and written `0600`.
`.env.qa.example` contains placeholders only. Secrets reach logs and artifacts
only through `redactUrl()` / `redactSecret()` / `scrubSecrets()` in
`config/env.ts`; `run-metadata.json` is built from an explicit allowlist and
records the database *name* only, never a connection string.

The saved session (`tests/fixtures/.auth/owner.json`) contains a live auth
cookie and is gitignored and `0600`. `npm run qa:verify-hygiene` scans every
git-tracked file and every artifact for the real secret values and fails if one
appears.

QA credentials are unrelated to any development or production secret. Rotate
them freely — they only ever sign throwaway QA sessions.
