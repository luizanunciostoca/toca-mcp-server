# Foundation v1 — Telemetry, Alerting, SLO and Disaster Recovery

Status: **PRODUCTION_VERIFIED**

Production application/runtime source for this verification: `e0696df1d1860261afba78f1634e8c979401cdc7`.

Canonical production closeout: `docs/operations/foundation-production-verification-2026-08-16.md`.

Provider evidence: `docs/operations/foundation-reliability-provider-evidence.md`.

## Foundation objectives

The operational objectives are:

- Core governed request availability >=99.9%;
- managed scheduler tick success >=99.5%;
- verified terminal external writes = 100%;
- oldest pending Transactional Outbox age <=300s;
- Audit Ledger integrity = 100% valid;
- latest successful Cloud SQL backup <=36h old;
- Cloud SQL PITR enabled;
- restore-drill evidence <=90d old;
- PostgreSQL recovery RTO <=60m;
- PostgreSQL PITR RPO objective <=15m.

## Managed alerting

The Foundation alerting path is configured with permanent P0/P1 policies for Audit Ledger integrity, Foundation daily-control failure, stale scheduler jobs and stalled Outbox. The provider configuration and firing-path evidence are recorded in `docs/operations/foundation-reliability-provider-evidence.md`.

## Disaster recovery

The isolated production-backup restore drill validated critical schema/data integrity without restoring over production. Measured recovery RTO was 496s (~8m16s). Production remains deletion-protected with automated backups and PITR enabled. The backup-based drill did not directly demonstrate the <=15-minute PITR RPO objective; that remains continuing evidence rather than a current Foundation release blocker.

## Outbox stalled closure

The previous `OUTBOX_DELIVERY_STALLED` assessment was caused by 14 R29 verifier-owned events. Investigation proved they were verification residue rather than business events.

PR #157 added the verifier-owned post-proof drain path. Historical cleanup run `31935924301` delivered all 14 pre-classified verifier events without deleting business events or publishing externally. Post-fix R29 runtime run `31936043957` then created fresh verifier events and proved `matched=3`, `drained=3`, `delivered=3`, `pending=0`.

## Final Production Assessment

Final post-rollout assessment run `31936391315` measured:

- Core availability `1.000` against target `0.999` — MET;
- Scheduler success `1.000` against target `0.995` — MET;
- outbox pending/claimed/retryable `0`;
- oldest pending Outbox age `0s`;
- no Outbox rows above SLO;
- Audit Ledger integrity valid;
- PITR enabled;
- current backup and restore-drill evidence;
- alerts `[]`;
- canonical assessment `healthy=true`.

Evidence artifact:

- ID `9260785405`;
- SHA-256 `5c24698412a42b0badfb7cbc91fc06adad90dba0e83f731bd75f3e7e3ffd4374`.

## Exit state

The Foundation reliability path is **PRODUCTION_VERIFIED** for the verified runtime source. SLO, Transactional Outbox health, Foundation Daily Operations, alerting and recovery evidence are all closed for the current Foundation scope.
