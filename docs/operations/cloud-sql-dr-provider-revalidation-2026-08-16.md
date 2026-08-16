# Cloud SQL DR — Provider Revalidation — 2026-08-16

Status: **REAL ISOLATED BACKUP RESTORE + DATA VALIDATION PASS; TEMPORARY TARGET CLEANUP PENDING**

Current application baseline: `main@ce70c66c129b1c629f78e776b023a7fe9cf63569`.

For the full release snapshot, see `docs/operations/controlled-test-readiness-2026-08-16.md`.

This file supersedes the earlier same-day statement that create/restore/delete permissions prevented a real drill. Those permissions were subsequently granted and provider execution changed the factual state.

## Production source

Production instance:

`toca-mcp-db`

Current verified controls:

- state `RUNNABLE`;
- PostgreSQL 18;
- region `southamerica-east1`;
- deletion protection enabled;
- automated backups enabled;
- PITR enabled.

No drill in this closeout restored over production and no drill disabled production deletion protection.

## Executed isolated restore

Final recovery target:

`toca-mcp-dr-final-31932660953`

Selected backup:

`projects/toca-mcp-production/backups/05416bd5-6ce8-409f-85f8-c53bdcf0b8b9`

Restore run:

`31932660953`

Evidence artifact:

`9259793788`

Provider evidence:

- backup end: `2026-08-16T04:27:19.186Z`;
- restore start: `2026-08-16T06:57:43Z`;
- recovery target created successfully;
- target PostgreSQL 18;
- target region `southamerica-east1`;
- target tier `db-g1-small`;
- target edition Enterprise;
- source production instance read back unchanged;
- observed backup-based RPO: **9,024 seconds (~2h30m)**.

The provider created the target with deletion protection enabled even though the restore requested an unprotected new target. This did not affect data validation, but it prevents automatic cleanup under the current deployer IAM.

## Restored-data validation

Validation run:

`31932980178`

Artifact:

`9259838301`

Artifact digest:

`sha256:52f70ddc2e807bd61006f1d168db8953fc32c3b9045cbeb9d979eaf3c4313b84`

The validation job used the exact production image bound to `ce70c66c129b1c629f78e776b023a7fe9cf63569` and connected only to the isolated recovery target.

Observed recovery actions/results:

- migration `020_content_item_versioning_video.sql` applied on the recovery target;
- migration `021_r29_video_artifacts.sql` applied on the recovery target;
- `PRODUCTION_SCHEMA_MIGRATIONS_CURRENT=16`;
- `DR_DATABASE_VALIDATION=PASS migrations=16 critical_tables=21 audit_executions=0`;
- 21 critical tables were readable;
- critical foreign keys were validated;
- required append-only triggers were enabled;
- Audit Ledger verification completed without an integrity failure; the selected recovery point contained zero ledger executions;
- the validation Cloud Run job was deleted after execution;
- production was re-read with no drift and retained deletion protection, backups and PITR.

Measured restore-start-to-validated-data RTO:

**496 seconds (~8m16s)**.

Foundation RTO objective is <=60 minutes, so this drill validates the RTO objective for this recovery path.

## RPO interpretation

Foundation's PostgreSQL RPO objective is <=15 minutes when PITR is used.

This drill selected the latest successful backup, not a PITR timestamp. The backup was ~2h30m old at restore start. Therefore:

- backup restore path: **validated**;
- RTO <=60m: **validated**;
- PITR capability enabled in production: **validated by readback**;
- RPO <=15m: **not demonstrated by this backup-based drill**.

A future PITR-specific drill is required before claiming provider-measured <=15-minute RPO.

## Cleanup state

Read-only IAM probe `31932927957` verified the deployer has:

- `cloudsql.instances.get`;
- `cloudsql.instances.delete`.

It does not have:

- `cloudsql.instances.update`.

Current target:

`toca-mcp-dr-final-31932660953`

Current target deletion protection:

`true`

Cloud SQL requires deletion protection to be disabled before deletion. The exact remaining administrative action is therefore:

1. disable deletion protection **only** on `toca-mcp-dr-final-31932660953`;
2. never change deletion protection on `toca-mcp-db`;
3. let the existing deployer delete the exact temporary target;
4. read back that the target is absent;
5. re-read production recovery controls unchanged.

This is a cleanup blocker only. Restore, schema recovery, critical-data validation and measured RTO have already passed.

Tracking: GitHub issues #145 and #154.
