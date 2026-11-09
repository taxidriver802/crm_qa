# Experiment: Revise — make the base solid (`experiment/CC_revise`)

Branch cut from `experiment/CC_ui_reimagination`. The full decision log is in
`crm_backend/docs/EXPERIMENT_REVISE.md`.

## In this repo

- `scripts/lifecycle-drift-check.ts` (`npm run qa:drift-check`, and the
  second step of `test:qa`): fails when the frontend's copy of the job
  lifecycle and money vocabulary disagrees with the backend's.
- `tests/e2e/job-lifecycle.spec.ts`: the end-to-end flow now runs from the
  job's next step with each document opening in the peek.
- `tests/e2e/documents.spec.ts`: estimate and invoice records.
- `tests/e2e/access.spec.ts`: the seeded agent at desktop-1440 and
  phone-390.
- `tests/e2e/saved-views.spec.ts`: URL filters, and saved views that can
  be linked, pinned and deleted.

## Checks

```bash
npm run test:qa
```

```bash
npm run qa:verify-hygiene
```
