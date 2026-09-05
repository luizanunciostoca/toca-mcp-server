# TOCA OS — Independent Lane Review

Review the supplied PR/lane adversarially against its issue, Lane Contract, canonical architecture, and exact base/head diff.

Check for scope creep, duplicate implementation, missing tests, weak assertions, state-machine errors, idempotency/retry issues, race conditions, provider ambiguity, authorization bypass, tenant leakage, secret/PII exposure, migration conflicts, incompatible contracts, cleanup leaks, and false acceptance claims.

Separate findings into:
- `BLOCKING`
- `IMPORTANT_NON_BLOCKING`
- `NO_ISSUE`

For every finding include concrete code evidence and the smallest safe fix. Do not create noise from stylistic preference. PASS applies only to the exact reviewed HEAD.
