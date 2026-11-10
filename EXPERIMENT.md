# Experiment CA — expansion

Branch: `experiment/CA_expansion`

The decision log is [`../crm_backend/docs/EXPERIMENT.md`](../crm_backend/docs/EXPERIMENT.md).

This harness applies `patch_phase23_contract_payments.sql` with the rest of the backend schema. The Brooks tear-off job is seeded with its approved estimate as the contract, and the paid invoice has a matching check in `payments`. `tests/e2e/contract-money.spec.ts` reads those figures on the job at every viewport. On desktop it also accepts a contract and records a $250 check through the form, then removes that payment so the shared database is left as seeded.
