# Cloud SQL DR — Provider Revalidation — 2026-08-16

Status: **REAL ISOLATED BACKUP RESTORE + DATA VALIDATION + CLEANUP PASS**

Production application source: `ce70c66c129b1c629f78e776b023a7fe9cf63569`.

For the full release snapshot, see `docs/operations/controlled-test-readiness-2026-08-16.md`.

## Production source

Production instance:

`toca-mcp-db`

Verified controls after the drill and cleanup:

- state `RUNNABLE`;
- PostgreSQL 18;
- region `southamerica-east1`;
- deletion protection enabled;
- automated backups enabled;
- PITR enabled.

Production was never used as the drill restore target and its deletion protection was never disabled.

## Executed isolated restore

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

## Restored-data validation

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

The Foundation <=60m RTO objective therefore passes for this tested backup recovery path.

## Final cleanup — PASS

The owner disabled deletion protection only on the temporary recovery target. Run `31933900598` then performed the deterministic cleanup.

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

No temporary Cloud SQL instance remains from this drill.

## RPO interpretation

The <=15-minute PostgreSQL RPO objective is associated with PITR. This drill restored the latest successful backup, which was ~2h30m old at restore start. Therefore:

- backup restore path: **validated**;
- RTO <=60m: **validated**;
- production PITR enabled: **validated**;
- measured RPO <=15m: **not demonstrated by this backup-based drill**.

A future PITR-specific drill is appropriate for measured <=15m RPO evidence, but is not a blocker for the current controlled real-system test release.

GitHub issue #145 is closed as completed.
