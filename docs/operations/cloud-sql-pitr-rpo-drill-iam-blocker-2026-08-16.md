# Cloud SQL PITR/RPO Drill — IAM blocker evidence — 2026-08-16

## Scope

This evidence records the fail-closed preflight for the isolated Cloud SQL PostgreSQL PITR/RPO drill. No production restore was attempted. No temporary Cloud SQL PITR instance was created because current IAM permissions are insufficient to both create and safely delete the isolated target.

Production source: `toca-mcp-db`
Region: `southamerica-east1`
Drill branch: `ops/cloud-sql-pitr-rpo-drill-20260816`
Repository baseline SHA: `e0696df1d1860261afba78f1634e8c979401cdc7`

## Drill workflow attempts

### Run 31935975495

The first one-shot workflow stopped at IAM preflight before target creation. Artifact `9260659557` preserves failure evidence. No PITR target and no probe/validation resource survived the run.

### Run 31936171307

The second workflow separated deployer and infrastructure-admin identities. The infrastructure-admin WIF authentication succeeded, but project `testIamPermissions` returned no Cloud SQL permissions and the workflow failed closed with `INFRA_PREFLIGHT_MISSING_PERMISSION=cloudsql.instances.get`. The PITR target was never created. Artifact `9260713706` records `FAILED_BEFORE_PITR_STATE`.

## Current live IAM probe

Read-only probe workflow run: `31936245290`
Job: `95138518601`

Identity: `toca-mcp-deployer@toca-mcp-production.iam.gserviceaccount.com`

Granted by live `testIamPermissions`:

- `cloudsql.instances.get`
- `cloudsql.backupRuns.get`
- `cloudsql.backupRuns.list`

Missing by live `testIamPermissions`:

- `cloudsql.instances.clone`
- `cloudsql.instances.update`
- `cloudsql.instances.delete`
- `cloudsql.instances.create`
- `cloudsql.instances.restoreBackup`

Identity: `toca-mcp-infra-admin@toca-mcp-production.iam.gserviceaccount.com`

The drill preflight requested `cloudsql.instances.get` and `cloudsql.instances.update`; project `testIamPermissions` returned `{}`. Therefore neither requested permission is currently available through that WIF identity.

## Safety result

The drill remains **NOT PRODUCTION_VERIFIED for PITR/RPO**. The workflow correctly stopped before a mutation because it cannot guarantee the full lifecycle `PITR clone -> validate -> disable target deletion protection -> delete target` with current IAM.

No production Cloud SQL settings were intentionally changed by these attempts. No temporary PITR Cloud SQL instance was created by these attempts.

## Prepared PITR proof

The isolated drill workflow is prepared to:

1. confirm production remains `RUNNABLE` with backup, PITR and deletion protection enabled;
2. query the provider recovery window and enforce provider latest-recovery lag <= 900 seconds;
3. read existing append-only `operational_signals` and `audit_ledger_events` without writing a synthetic production marker;
4. select a recoverable timestamp between two real temporal records and enforce selected RPO <= 900 seconds;
5. create a separate PITR Cloud SQL target;
6. validate PostgreSQL connectivity, all 16 schema migrations, critical tables, foreign keys and append-only triggers;
7. prove the record before the selected timestamp exists in the restored target and the record after it is absent;
8. measure restore-to-RUNNABLE time and validation-complete RTO;
9. delete validation jobs and the temporary PITR target;
10. compare production source settings before/after and emit immutable workflow artifact evidence.

## External IAM action required before the drill can run

The current v2 workflow requires temporary authority as follows:

- `toca-mcp-deployer@toca-mcp-production.iam.gserviceaccount.com`: capability to get, clone and delete Cloud SQL instances (a temporary `roles/cloudsql.admin` grant is the straightforward predefined-role option for this controlled drill).
- `toca-mcp-infra-admin@toca-mcp-production.iam.gserviceaccount.com`: capability to get and update only the temporary target so inherited deletion protection can be disabled before cleanup (a temporary `roles/cloudsql.editor` grant is sufficient for this workflow phase).

These elevated bindings are intended only for the controlled drill window and should be removed after the target is confirmed deleted and evidence is preserved.
