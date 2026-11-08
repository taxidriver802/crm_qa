# Experiment: Workbench UI (`experiment/CC_ui_reimagination`)

Branch cut from `experiment/CC_expansion`. The full decision log is in
`crm_backend/docs/EXPERIMENT_UI_UX.md`.

## What changed in the harness

- `db/schema.ts` applies `patch_phase24_workspace_preferences.sql`;
  `db/admin.ts` truncates `user_preferences` on reset, so every run starts
  with nobody's preferences saved.
- `tests/utils/nav.ts`: the phone tab bar is `nav[aria-label="Primary"]`;
  new helpers `createButton()` and `peekPanel()`.
- `tests/e2e/job-lifecycle.spec.ts`: job records are tabbed now, so money
  assertions open the **Money** tab first; the end-to-end flow reaches it
  through the next step's own "Bill deposit" button.
- New `tests/e2e/workbench.spec.ts`:
  - every viewport: shell chrome per width, the Create menu (global and on a
    job), peek from a list row (URL, reload, Escape, open full page), record
    tabs in the URL, Preferences sections without overflow or console errors;
  - desktop-1440 only, because preferences are per user and the four
    projects share one database: density, hidden sidebar item and a pin
    survive a reload and a brand-new browser context; Reset all; a hidden
    Today widget; list columns per list; keyboard shortcuts. Each test resets
    the owner's preferences before and after;
  - roles, desktop-1440: the seeded agent sees no admin destinations, widgets
    or settings, and gets 403 writing team defaults.

## Run

```bash
npm run test:qa
```

```bash
npm run qa:verify-hygiene
```

QA stays on ports 3100/4100 and the `crm_qa` database.
