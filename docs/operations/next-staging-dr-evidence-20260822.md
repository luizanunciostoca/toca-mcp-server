# TOCA OS Next — Isolated Staging DR Evidence — 2026-08-22

This document records the sanitized live evidence for the final-candidate isolated staging disaster-recovery rehearsal. It does not authorize or claim any production or provider lifecycle promotion.

## Identity and immutable boundary

- repository: `luizanunciostoca/toca-mcp-server`
- frozen application candidate: `75c165a044c6e79e9545328dd04a2a3e73d2e910`
- DR harness head: `3914c46aadb5eac321c2ec02761914b59d8858c8`
- workflow run: `32583241943`
- staging project: `toca-mcp-next-staging` (`729069789107`)
- staging source Cloud SQL: `toca-mcp-next-staging-db`
- production project boundary: `toca-mcp-production` (`990081828836`)

The final gate published `AUTHORIZED_STAGING_DR_LP_V14=PASS` only after syntax/boundary validation, least-privilege bootstrap, the PITR drill, target cleanup and IAM cleanup all completed successfully.

## Recovery proof

The sanitized artifact manifest records:

- provider latest recovery lag: `16s`
- selected recovery point lag / measured RPO: `46s`
- RPO objective: `<= 900s` (`15m`)
- restore start to target `RUNNABLE`: `450s`
- full PostgreSQL validation completion / measured RTO: `737s`
- RTO objective: `<= 3600s` (`60m`)
- audit ledger head mismatch count: `0`

Result: **RPO PASS** and **RTO PASS**.

## Database and migration validation

The restored clone was validated against the frozen candidate migration set.

- restored migration count: `27`
- maximum migration: `033_omnichannel_prepared_content.sql`
- migration `027`: intentionally absent, as required
- database validation marker: `DR_LP_V3_DATABASE_VALIDATION=PASS`
- critical table count validated: `28`

The restored critical surface included canonical Workflow/timers, Approval, Outbox, Audit, Privacy, CRM, AG-01, Email, WhatsApp and `omnichannel_prepared_content` tables. The clone-only application-table-owner authentication path passed with `grants_changed=false` and clean evidence stdout.

## Cleanup and isolation proof

After validation:

- temporary PITR target deletion: PASS
- source staging instance unchanged: PASS
- temporary DR service account removal: PASS
- temporary project IAM binding/custom-role cleanup: PASS
- final IAM cleanup marker: `DR_LP_V3_IAM_CLEANUP=PASS target_absent=true source_unchanged=true`

The sanitized manifest explicitly records:

- `productionMutation=false`
- `providerMutation=false`
- `trafficMutation=false`
- `cloudRunMutation=false`
- `secretManagerRead=false`
- `secretManagerMutation=false`

No provider verification is promoted by this drill, and no production rollout is authorized by this evidence.

## Artifact integrity

- artifact name: `staging-dr-lp-v14-32583241943`
- artifact ID: `9478540826`
- artifact size: `2974` bytes
- artifact ZIP SHA-256: `725049314a3e12123c3dbdbcb60791c608e592e5ecb90f05e1df87e2266c47d1`
- retention expiry reported by GitHub: `2026-11-20T15:57:09Z`

The artifact contains the sanitized manifest, recovery-window readback, restored migration list, critical-table counts, source-before/target-runnable readbacks and per-file SHA-256 sums.

## Lifecycle conclusion

For the frozen candidate, the staging reliability recovery requirement is now supported by live evidence:

- `STAGING_VERIFIED=true`
- `DR_VERIFIED=true`
- `RELIABILITY_VERIFIED=true`

These statements are limited to the isolated Next staging environment. `PROVIDER_VERIFIED` remains false where provider evidence is pending, and `PRODUCTION_VERIFIED` remains false because production promotion is not authorized or executed.
