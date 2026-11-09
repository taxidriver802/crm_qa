# Experiment: Help (`experiment/CC_help`)

Branch cut from `experiment/CC_revise`. The decision log is in
`crm_backend/docs/EXPERIMENT_HELP.md`.

## In this repo

| Area | Files |
|---|---|
| One source of article ids. Runs inside `npm run test:qa` | `scripts/help-source-check.ts` |
| Help opens from the account menu, survives reload, opens from ⌘K and from the shortcuts line, opens from a job's next step, hides owner-only articles from an agent, stays off a public portal, and opens every article the role can see. Phone menu opens the same panel | `tests/e2e/help.spec.ts` |
| Start here, walked: a new owner from sign-up through paid and closed, including the client's pages | `tests/e2e/help-start-here.spec.ts` |

## Checks

```bash
npm run qa:help-check
npm run test:qa
```

The help-source check failed when a UI id was forced off the guide
(`close-a-job-missing`), then passed (13 ids, 36 articles).

`npm run test:qa` on ports 3100/4100 and database `crm_qa`: **261 passed,
63 skipped, 0 failed**.
