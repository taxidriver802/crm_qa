# Experiment CA — UI reimagination

Parent branch: `experiment/CA_expansion`. This branch: `experiment/CA_ui_reimagination`.

The decision log is [`../crm_backend/docs/EXPERIMENT_UI_UX.md`](../crm_backend/docs/EXPERIMENT_UI_UX.md).

The harness applies `patch_phase24_workspace.sql`. The bottom nav is recognized by the Today tab. `tests/e2e/workspace.spec.ts` sets a compact density and the job Money pane, reloads, and restores the owner defaults.
