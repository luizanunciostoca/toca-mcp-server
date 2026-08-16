# Cloud SQL DR — Provider Revalidation — 2026-08-16

Status: **REAL ISOLATED BACKUP RESTORE + PITR RESTORE + DATA VALIDATION + CLEANUP PASS**

Production application source: `ce70c66c129b1c629f78e776b023a7fe9cf63569`.

For the full release snapshot, see `docs/operations/controlled-test-readiness-2026-08-16.md`.

Canonical PITR evidence: `docs/operations/cloud-sql-pitr-rpo-drill-2026-08-16.md`.

## Production source

Production instance:

`toca-mcp-db`

Verified controls after both drills and cleanup:

- state `RUNNABLE`;
- PostgreSQL 18;
- region `southamerica-east1`;
- deletion protection enabled;
- automated backups enabled;
- PITR enabled.

Production was never used as a drill restore target and its deletion protection was never disabled.

## Executed isolated backup restore

Recovery target used:

`toca-mcp-dr-final-31932660953`

Selected backup:

`projects/toca-mcp-production/backups/05416bd5-6ce8-409f-85f8-c53bdcf0b8b9`

Restore evidence:

- backup end `2026-08-16T04:27:19.186Z`;
- restore start `2026-08-16T06:57:43Z`;
- target PostgreSQL 18 / Enterprise / `db-g1-small` / `southamerica-east1`;
- production unchanged;
- observed backup-based RPO **9,024s (~2h30m)**.

### Backup restored-data validation

Validation run `31932980178`, artifact `9259838301`:

- exact deployed production image used against the isolated target;
- recovery migrations brought the target to migration count 16;
- `DR_DATABASE_VALIDATION=PASS migrations=16 critical_tables=21 audit_executions=0`;
- 21 critical tables readable;
- critical foreign keys validated;
- required append-only triggers enabled;
- Audit Ledger verifier completed without an integrity failure on the selected recovery point;
- validation Cloud Run job deleted;
- production read back unchanged.

Measured restore-start-to-validated-data RTO:

**496s (~8m16s)**.

The Foundation <=60m RTO objective therefore passes for the tested backup recovery path.

### Backup final cleanup — PASS

Run `31933900598` performed deterministic cleanup after deletion protection was disabled only on the temporary recovery target.

Provider evidence:

- target deletion protection read back as `false` before delete;
- `toca-mcp-dr-final-31932660953` deleted successfully;
- subsequent describe/readback proved the target is absent;
- production `toca-mcp-db` remained unchanged;
- production deletion protection remained enabled;
- automated backups remained enabled;
- PITR remained enabled.

Final cleanup artifact:

- ID `9260108983`;
- SHA-256 `e6adf99c54418b2eb19a751963e2ebfc5d94e26e609dfc10ad8ca39f3dd6cc9c`.

## Executed isolated PITR restore

Run `31936171307`, attempt 2, executed the timestamp-based PITR path after live IAM preflight passed.

Temporary target:

`toca-mcp-pitr-31936171307`

Provider recovery window at reference time `2026-08-16T08:34:46Z`:

- earliest recoverable: `2026-08-10T02:39:45.709Z`;
- latest recoverable: `2026-08-16T08:32:38.577470502Z`;
- latest recovery lag: **128s (2m08s)**.

Selected PITR timestamp:

`2026-08-16T08:26:12.648Z`

Measured PITR RPO:

**514s (8m34s)**.

The <=15m RPO objective therefore passes.

Temporal-boundary validation used existing append-only production evidence:

- `operational_signals/c24795ae-14f1-4952-80af-314187c1ff78` at `2026-08-16T08:26:10.648Z` was present after restore;
- `audit_ledger_events/49fff740-196b-4a0b-a5f1-d68a14e02ad3` at `2026-08-16T08:29:42.328Z` was absent after restore.

The target became `RUNNABLE` in **549s (9m09s)**. Full restored-data validation completed in **584s (9m44s)** from restore start.

Validation proved:

- PostgreSQL connection succeeded;
- migration count 16;
- 22 critical tables readable;
- critical foreign keys validated;
- required append-only triggers enabled;
- before-marker present;
- after-marker absent.

Provider line:

`DR_PITR_VALIDATION=PASS migrations=16 critical_tables=22 before_marker_present=1 after_marker_absent=1`

The <=60m RTO objective therefore passes for the PITR recovery path.

### PITR final cleanup — PASS

The workflow disabled deletion protection only on `toca-mcp-pitr-31936171307`, then deleted:

- the probe Cloud Run job;
- the validation Cloud Run job;
- the PITR Cloud SQL target.

Post-cleanup readback proved:

- PITR target absent;
- production remained `RUNNABLE`;
- production deletion protection enabled;
- automated backups enabled;
- PITR enabled;
- normalized source settings identical to the pre-drill snapshot.

Successful PITR artifact:

- ID `9261022842`;
- SHA-256 `6524043e56f2eacef34b129fa7eb2c7130711ce43e3071f67476573527dd5140`.

Final assertion:

`CLOUD_SQL_PITR_RPO_DRILL=PASS rpo_seconds=514 rto_seconds=584 provider_latest_lag_seconds=128`

No temporary Cloud SQL instance remains from either DR drill.

## RPO interpretation

The two recovery modes now have distinct measured evidence:

- backup restore path: **validated**, with backup-age RPO **9,024s (~2h30m)** and RTO **496s (~8m16s)**;
- PITR restore path: **validated**, with measured RPO **514s (8m34s)** and RTO **584s (9m44s)**;
- production PITR enabled: **validated**;
- PostgreSQL PITR RPO <=15m: **validated**;
- PostgreSQL recovery RTO <=60m: **validated**.

The former PITR/RPO evidence gap is closed.

GitHub issue #145 remains closed as completed.