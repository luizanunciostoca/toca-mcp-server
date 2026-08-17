# Cloud SQL Disaster Recovery V1 Closeout — 2026-08-17

Status: **DRILL EVIDENCE CLOSED — LIVE PROVIDER READBACK PENDING ACCESS**

## Purpose

This closeout records the canonical Disaster Recovery state after reviewing the V1 Cloud SQL restore/PITR evidence. It deliberately avoids repeating destructive or costly recovery operations that already have valid provider-backed evidence.

## Canonical V1 result

The V1 provider-backed drills executed on 2026-08-16 establish:

- isolated backup restore: PASS;
- backup restore validated-data RTO: 496s (8m16s), objective <=3600s: PASS;
- isolated PITR restore: PASS;
- provider latest-recovery lag: 128s (2m08s), objective <=900s: PASS;
- PITR RPO: 514s (8m34s), objective <=900s: PASS;
- PITR restore-to-RUNNABLE: 549s (9m09s);
- PITR validated-data RTO: 584s (9m44s), objective <=3600s: PASS;
- restored PostgreSQL connection/schema/table/integrity checks: PASS;
- PITR temporal boundary proof: PASS;
- temporary Cloud SQL targets/jobs: removed;
- production unchanged after drill: PASS.

No new backup restore or PITR restore was executed during this closeout because the evidence remains valid and repeating a destructive/costly provider operation solely for recency would add risk without closing a technical gap.

## Durable evidence

The machine-readable non-secret summary is preserved at:

`docs/operations/evidence/cloud-sql-dr-v1-2026-08-16.json`

The canonical human-readable evidence remains:

- `docs/operations/cloud-sql-dr-provider-revalidation-2026-08-16.md`;
- `docs/operations/cloud-sql-pitr-rpo-drill-2026-08-16.md`.

The PITR artifact digest preserved in repository evidence is:

`6524043e56f2eacef34b129fa7eb2c7130711ce43e3071f67476573527dd5140`

The backup cleanup artifact digest is:

`e6adf99c54418b2eb19a751963e2ebfc5d94e26e609dfc10ad8ca39f3dd6cc9c`

The CI artifact retention expiry therefore no longer removes the durable summary, metrics, execution identity or integrity digest from the repository.

## Operator runbook

A standalone manual runbook independent of GitHub Actions is now maintained at:

`docs/operations/cloud-sql-dr-runbook.md`

It defines fail-closed guards, isolated target naming, provider preflight, backup restore, PITR, temporal proof, RPO/RTO timing, data validation, evidence packaging, deterministic cleanup and the emergency production-recovery boundary.

## Live provider readback

A fresh read-only Google Cloud provider readback for 2026-08-17 was attempted as part of the closeout environment assessment, but this execution environment does not expose a Google Cloud / Cloud SQL connector or Google Cloud credentials/CLI authority.

Therefore this closeout DOES NOT claim a new 2026-08-17 provider confirmation of:

- current source state;
- exact current retained-backup count;
- exact current transaction-log retention;
- latest successful backup timestamp;
- current PITR recovery window.

The most recent authenticated provider-backed evidence remains the 2026-08-16 drill evidence, which proved the production instance `RUNNABLE`, deletion protection enabled, automated backups enabled, PITR enabled and production settings unchanged after cleanup.

Repository policy currently expects retained backups = 7 and transaction-log retention = 7 days. These are desired/canonical policy values and MUST NOT be presented as a new live provider readback until authenticated Cloud SQL access is available.

## Next provider-only check

When authenticated Google Cloud access is available, perform a READ-ONLY check only. Do not run another restore solely for this closeout.

Confirm and record:

1. `toca-mcp-db` is `RUNNABLE`;
2. deletion protection enabled;
3. automated backups enabled;
4. PITR enabled;
5. retained backups = 7 or reconcile drift;
6. transaction-log retention = 7 days or reconcile drift;
7. latest successful backup age <=36h;
8. current earliest/latest PITR recovery timestamps.

If these readbacks match policy, no further V1 DR action is required until the next scheduled evidence window or a material infrastructure change.

## Branch interpretation

Historical `ops/cloud-sql-*` branches are evidence/implementation history, not competing canonical DR truth. The canonical state is the current `main` plus the documents referenced above.

Branches whose changes are already represented by merged evidence or later closeout work should be treated as **superseded candidates for governance cleanup**, not as sources for a new recovery execution.

Do not delete historical branches as part of a DR drill itself. Repository-governance cleanup should delete them only after confirming no unique unmerged evidence remains.

## Final V1 DR assessment

- measured PITR RPO: **514s — PASS**;
- measured validated-data PITR RTO: **584s — PASS**;
- measured validated-data backup-restore RTO: **496s — PASS**;
- isolated recovery paths: **PASS**;
- restored-data validation: **PASS**;
- deterministic cleanup: **PASS**;
- temporary drill resources remaining: **none according to final provider-backed cleanup evidence**;
- new destructive operation required now: **NO**;
- GitHub Actions required to preserve/operate the runbook: **NO**;
- remaining blocker: **fresh read-only Google Cloud provider readback requires authenticated provider access not available in this execution environment**.
