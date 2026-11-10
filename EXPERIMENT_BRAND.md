# Experiment: Brand — Joist (`experiment/CC_brand`)

Branch cut from `experiment/CC_schema` (which contains all of
`experiment/CC_help` plus the QA database build through the backend's
migration runner; the backend branch needs it). The decision log is
`crm_backend/docs/EXPERIMENT_BRAND.md`.

## In this repo

| Area | Files |
|---|---|
| Source checks, part of `npm run test:qa`: generated icons match the one drawing and nothing else redraws it; PNG and favicon sizes; the app's and the email's initials agree on every case in `crm_backend/test/fixtures/monogram-cases.json`; `--on-accent` on `--accent` is at least 3:1 in every palette; Ember is the `rooftop` label and Azure and Slate are unchanged; no Rooftop Realty, `mainlogo` or "Buy & Sell" left in frontend code | `scripts/brand-check.ts` (`npm run qa:brand-check`) |
| Tab, head tags and manifest are Joist; generated icons' sizes; maskable mark inside the 40% safe circle; the mark still has its orange and light pixels at 16px; sign-in Joist → Rooftop's logo → another company's initials → back, with no leak; a remembered company never flashes Joist; register stays Joist on the default palette; the staff shell is Rooftop's with its title and no Joist; a new company's initials in its own accent and ink, its title, and theme-color following its palette, then back to Rooftop in the same browser; a customer page's company header and one muted, unlinked Powered by Joist; a dead link falls back to Joist; the quiet tile while a customer page loads; 404 outside and inside the shell; Ember in Settings and the picker | `tests/e2e/brand.spec.ts` |
| Apple icon is `/apple-icon.png`; the offline page carries the Joist mark, name and title | `tests/e2e/pwa.spec.ts` |

## Checks

```bash
npm run qa:brand-check
npm run test:qa
```

The brand check failed when `src/app/icon.svg` was edited by hand and when
the frontend's monogram stopped skipping "The" (three cases named), then
passed once both were restored.

`npm run test:qa` on ports 3100/4100 and database `crm_qa`: **287 passed,
85 skipped, 0 failed**. The brand spec found `theme-color` falling back to
Ember's canvas after sign-in; fixed in crm_frontend.
