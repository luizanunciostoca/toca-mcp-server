# Cloud SQL PITR/RPO Drill — 2026-08-16

Status: **PRODUCTION_VERIFIED — ISOLATED PITR + RPO/RTO + CLEANUP PASS**

This evidence records the completed PostgreSQL point-in-time recovery drill for the production Cloud SQL source without restoring over production.

## Source and execution identity

- production source instance: `toca-mcp-db`;
- region: `southamerica-east1`;
- database version: PostgreSQL 18;
- drill workflow run: `31936171307`, attempt 2;
- workflow SHA: `ba28601bbcd111ad8acb3b8cf31ea9c804d74d69`;
- repository baseline used by the drill: `e0696df1d1860261afba78f1634e8c979401cdc7`;
- temporary PITR target: `toca-mcp-pitr-31936171307`;
- validation image tag: `toca-managed-daemon-0a8a33bdadbb74789556cdf110249add39d5877c`;
- validation image digest: `sha256:25d8bf2e47a6bc31eaaac440b9bb04d7755c483896b5473c077e5c25f76164d7`.

The workflow failed closed on two earlier attempts while IAM was insufficient. The successful attempt began only after live `testIamPermissions` proved the required temporary Cloud SQL authority.

## Production safeguards — PASS

Before the PITR mutation, the workflow re-read production and required:

- state `RUNNABLE`;
- PostgreSQL 18;
- region `southamerica-east1`;
- deletion protection enabled;
- automated backups enabled;
- PITR enabled.

The drill target was a separate instance name. Production was never the restore target, and production deletion protection was never disabled.

## Provider recovery window — PASS

Provider recovery-window readback at `2026-08-16T08:34:46Z` returned:

- earliest recoverable time: `2026-08-10T02:39:45.709Z`;
- latest recoverable time: `2026-08-16T08:32:38.577470502Z`;
- latest-recovery lag: **128s (2m08s)**.

Objective: <=900s. Result: **PASS**.

## PITR RPO measurement — PASS

The drill did not write a synthetic marker into production. It reused existing append-only temporal evidence from `operational_signals` and `audit_ledger_events` and selected a recoverable timestamp between two real records.

Selected recovery point:

`2026-08-16T08:26:12.648Z`

Reference time:

`2026-08-16T08:34:46Z`

Measured PITR RPO:

**514s (8m34s)**.

Objective: <=900s (15m). Result: **PASS**.

Temporal boundary proof:

- record immediately before the recovery point: `operational_signals/c24795ae-14f1-4952-80af-314187c1ff78` at `2026-08-16T08:26:10.648Z` — **present** in the restored target;
- record after the recovery point: `audit_ledger_events/49fff740-196b-4a0b-a5f1-d68a14e02ad3` at `2026-08-16T08:29:42.328Z` — **absent** from the restored target.

This demonstrates that the restore landed on the intended temporal side of the selected PITR boundary rather than merely producing a readable clone.

## Restore and RTO — PASS

Timing:

- restore started: `2026-08-16T08:35:22Z`;
- target `RUNNABLE`: `2026-08-16T08:44:31Z`;
- restore-to-`RUNNABLE`: **549s (9m09s)**;
- validation completed: `2026-08-16T08:45:06Z`;
- restore-start-to-validated-data RTO: **584s (9m44s)**.

Objective: <=3600s (60m). Result: **PASS**.

## Restored-data validation — PASS

The isolated target was validated through the runtime database stack. Evidence:

- PostgreSQL connection succeeded;
- `schema_migrations` count = **16**;
- **22 critical tables** present and readable;
- no unvalidated critical foreign keys;
- required append-only triggers enabled;
- before-marker present;
- after-marker absent;
- `DR_PITR_VALIDATION=PASS migrations=16 critical_tables=22 before_marker_present=1 after_marker_absent=1`.

## Cleanup — PASS

Deletion protection inherited by the temporary target was disabled only on `toca-mcp-pitr-31936171307` after the target identity was re-read and bounded by name.

Cleanup then proved:

- probe Cloud Run job deleted;
- validation Cloud Run job deleted;
- PITR target deleted;
- post-delete describe/readback confirmed target absence;
- production source re-read as `RUNNABLE`;
- production deletion protection remained enabled;
- automated backups remained enabled;
- PITR remained enabled;
- normalized production settings matched the pre-drill snapshot.

Final provider line:

`PITR_DR_CLEANUP=PASS target_deleted=true production_unchanged=true`

No temporary PITR Cloud SQL instance remains from this drill.

## Preserved evidence

Successful artifact:

- artifact ID: `9261022842`;
- name: `cloud-sql-pitr-rpo-evidence-ba28601bbcd111ad8acb3b8cf31ea9c804d74d69`;
- artifact SHA-256: `6524043e56f2eacef34b129fa7eb2c7130711ce43e3071f67476573527dd5140`;
- created: `2026-08-16T08:47:19Z`;
- provider retention expiry: `2026-11-14T08:34:03Z`.

The artifact contains:

- `cloud-sql-pitr-rpo-drill.json`;
- `dr-state.json`;
- `source-before.json`;
- `source-after.json`.

Final workflow assertion:

`CLOUD_SQL_PITR_RPO_DRILL=PASS rpo_seconds=514 rto_seconds=584 provider_latest_lag_seconds=128`

## DR classification

The Cloud SQL DR evidence now independently covers both recovery modes exercised in this release cycle:

- isolated backup restore: validated;
- isolated PITR restore: validated;
- RTO <=60m: validated;
- PITR RPO <=15m: validated;
- restored schema/data controls: validated;
- deterministic cleanup: validated;
- production unchanged after drill: validated.

For this tested Cloud SQL configuration, the PITR/RPO evidence gap is closed and may be classified **PRODUCTION_VERIFIED**.