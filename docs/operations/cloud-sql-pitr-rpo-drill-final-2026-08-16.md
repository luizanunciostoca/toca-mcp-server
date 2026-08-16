# Cloud SQL PITR/RPO Drill — Final Evidence — 2026-08-16

## Verdict

`PRODUCTION_VERIFIED` for the isolated PostgreSQL PITR/RPO drill.

GitHub Actions run: `31936171307`, attempt `2`
Workflow SHA: `ba28601bbcd111ad8acb3b8cf31ea9c804d74d69`
Repository baseline SHA used by the drill: `e0696df1d1860261afba78f1634e8c979401cdc7`
Source instance: `toca-mcp-db`
Temporary PITR target: `toca-mcp-pitr-31936171307`
Region: `southamerica-east1`

The run completed with `success` and the final gate emitted:

`CLOUD_SQL_PITR_RPO_DRILL=PASS rpo_seconds=514 rto_seconds=584 provider_latest_lag_seconds=128`

## Recovery-point proof

Provider recovery window observed during the drill:

- earliest recovery time: `2026-08-10T02:39:45.709Z`
- latest recovery time: `2026-08-16T08:32:38.577470502Z`
- reference time: `2026-08-16T08:34:46Z`
- provider latest-recovery lag: `128 s`

Selected recovery timestamp:

- PITR point: `2026-08-16T08:26:12.648Z`
- measured RPO: `514 s` (`8m34s`)
- RPO objective: `<= 900 s` (`15 min`)
- objective met: `true`

The proof used pre-existing append-only production evidence rather than writing a synthetic business marker:

- record before PITR point: `operational_signals:c24795ae-14f1-4952-80af-314187c1ff78` at `2026-08-16T08:26:10.648Z`; present in restored target: `true`
- record after PITR point: `audit_ledger_events:49fff740-196b-4a0b-a5f1-d68a14e02ad3` at `2026-08-16T08:29:42.328Z`; absent in restored target: `true`

This demonstrates the recovered database boundary is consistent with the selected timestamp and that the measured RPO satisfies the operational target.

## Recovery-time proof

- restore started: `2026-08-16T08:35:22Z`
- target reached `RUNNABLE`: `2026-08-16T08:44:31Z`
- provider restore-to-RUNNABLE: `549 s` (`9m09s`)
- validation completed: `2026-08-16T08:45:06Z`
- measured end-to-end RTO: `584 s` (`9m44s`)
- RTO objective: `<= 3600 s` (`1 h`)
- objective met: `true`

## Restored-database validation

The isolated restored PostgreSQL instance passed real connection/readback checks:

- PostgreSQL version: `POSTGRES_18`
- target state: `RUNNABLE`
- schema migrations: `16 / 16`
- critical tables read successfully: `22`
- required foreign keys validated
- required append-only triggers present/enabled
- temporal record before the recovery timestamp present
- temporal record after the recovery timestamp absent

Validation emitted:

`DR_PITR_VALIDATION=PASS migrations=16 critical_tables=22 before_marker_present=1 after_marker_absent=1`

## Isolation and cleanup proof

The drill used a new temporary Cloud SQL instance and did not restore over production.

Deletion protection inherited by the temporary target was disabled only on the target. The cleanup gate then confirmed:

- probe Cloud Run job deleted: `true`
- validation Cloud Run job deleted: `true`
- temporary PITR Cloud SQL target deleted: `true`
- production mutated by drill: `false`
- production settings unchanged on before/after readback: `true`

Cleanup emitted:

`PITR_DR_CLEANUP=PASS target_deleted=true production_unchanged=true`

Production remained `RUNNABLE`, PostgreSQL 18, in `southamerica-east1`, with deletion protection, automated backups and point-in-time recovery enabled.

## Preserved artifact

Artifact ID: `9261022842`
Name: `cloud-sql-pitr-rpo-evidence-ba28601bbcd111ad8acb3b8cf31ea9c804d74d69`
Artifact SHA-256: `6524043e56f2eacef34b129fa7eb2c7130711ce43e3071f67476573527dd5140`
Created: `2026-08-16T08:47:19Z`
Configured retention: `90 days` (GitHub reports expiry `2026-11-14T08:34:03Z`).

The artifact contains the machine-readable final evidence plus source before/after readback data.

## Final decision

The previously open DR gap — real isolated PITR proof of RPO — is closed.

Measured objectives:

- `RPO = 514 s <= 900 s` — PASS
- `RTO = 584 s <= 3600 s` — PASS
- provider latest recovery lag `128 s <= 900 s` — PASS
- restored data boundary — PASS
- schema/migrations/critical tables — PASS
- cleanup — PASS
- production unchanged — PASS

No temporary Cloud SQL or Cloud Run test resource remains from this drill.

## Post-drill IAM hygiene

The temporary elevated IAM grants used solely to unblock this controlled drill should now be removed:

- remove temporary `roles/cloudsql.admin` from `toca-mcp-deployer@toca-mcp-production.iam.gserviceaccount.com`;
- remove temporary `roles/cloudsql.editor` from `toca-mcp-infra-admin@toca-mcp-production.iam.gserviceaccount.com`.

After removal, a read-only `testIamPermissions` revalidation should confirm the privilege window is closed.