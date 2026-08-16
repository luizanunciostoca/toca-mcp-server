# Foundation v1 — Telemetry, Alerting, SLO and Disaster Recovery

Status: **CURRENT RELEASE TELEMETRY/ALERTING + BACKUP/PITR DR OPERATIONALLY VALIDATED**

Production application source: `ce70c66c129b1c629f78e776b023a7fe9cf63569`.

Current provider evidence: `docs/operations/controlled-test-readiness-2026-08-16.md`, `docs/operations/foundation-reliability-provider-evidence.md` and `docs/operations/cloud-sql-pitr-rpo-drill-2026-08-16.md`.

## Telemetry and SLO source plane

Foundation v1 includes:

- structured JSON logging;
- RuntimeTelemetry/Prometheus;
- immutable Audit Ledger verification;
- append-only `operational_signals`;
- durable Workflow, Approval, Transactional Outbox and EventRecord persistence;
- Foundation daily control;
- deterministic SLO/error-budget evaluation;
- canonical P0/P1/P2 severity classification.

## Foundation objectives

Operational objectives remain:

- Core governed request availability >=99.9%;
- managed scheduler tick success >=99.5%;
- verified terminal external writes = 100% invariant;
- oldest pending Outbox age <=300s;
- Audit Ledger integrity = 100% valid invariant;
- latest successful Cloud SQL backup <=36h old;
- Cloud SQL PITR enabled;
- restore-drill evidence <=90d old;
- PostgreSQL recovery RTO <=60m;
- PostgreSQL PITR RPO objective <=15m.

No ambiguous provider write may be converted into an unverified success.

## Managed alerting — operationally configured

The previous Monitoring/Logging IAM blockers are closed.

Operational channels:

- primary `adm@tocadomorcego.com`;
- secondary `luizidebook@gmail.com`.

Permanent enabled/valid policies:

- P0 Audit Ledger integrity failure;
- P1 Foundation daily-control failure;
- P1 stale scheduler jobs;
- P1 stalled Outbox.

All four policies have both channels attached.

Controlled provider-path proof run `31934254574` created a temporary log-based policy, emitted a matching structured Cloud Run log, read back ingestion, allowed a notification-processing window, deleted the temporary policy and then re-read all permanent policies as enabled/valid with both channels.

Evidence:

- `DELIVERY_PROOF_LOG=PASS`;
- `DELIVERY_PROOF_PROVIDER_PATH=PASS`;
- artifact `9260213391`;
- SHA-256 `af9803d8c9bbb43a8338bbd47ba64a6f61eedbe03922db2bb0479e388ee50575`.

Independent mailbox-level receipt was not visible through the connected Gmail during the immediate observation window, so it is not claimed as evidence. The managed provider configuration and firing path are proven.

## Disaster recovery objectives and evidence

### Isolated backup restore — PASS

A real isolated backup restore was executed without restoring over production.

Recovery target used:

`toca-mcp-dr-final-31932660953`

Observed backup-based RPO:

**9,024s (~2h30m)**.

Restored-data validation proved:

- current migration count 16;
- 21 critical tables readable;
- critical foreign keys validated;
- append-only triggers enabled;
- Audit Ledger verifier completed without an integrity failure on the selected recovery point;
- production unchanged.

Measured restore-start-to-validated-data RTO:

**496s (~8m16s)**.

Therefore the tested backup recovery path satisfies the <=60m RTO objective.

### Isolated PITR drill — PASS

Run `31936171307`, attempt 2, executed a separate PostgreSQL PITR restore target:

`toca-mcp-pitr-31936171307`

Provider recovery-window readback showed latest recoverable data lag of **128s (2m08s)**.

The drill selected recovery timestamp:

`2026-08-16T08:26:12.648Z`

against reference time:

`2026-08-16T08:34:46Z`.

Measured PITR RPO:

**514s (8m34s)**.

The <=15m PITR RPO objective therefore passes.

Temporal-boundary proof used existing append-only production evidence without inserting a synthetic database marker:

- `operational_signals/c24795ae-14f1-4952-80af-314187c1ff78` at `08:26:10.648Z` was present in the restored target;
- `audit_ledger_events/49fff740-196b-4a0b-a5f1-d68a14e02ad3` at `08:29:42.328Z` was absent.

Restored-data validation proved:

- migration count 16;
- 22 critical tables readable;
- critical foreign keys validated;
- required append-only triggers enabled;
- intended before/after PITR boundary reproduced.

Restore-to-`RUNNABLE` time:

**549s (9m09s)**.

Restore-start-to-validated-data RTO:

**584s (9m44s)**.

The <=60m RTO objective passes for the PITR path as well.

Successful PITR evidence artifact:

- ID `9261022842`;
- SHA-256 `6524043e56f2eacef34b129fa7eb2c7130711ce43e3071f67476573527dd5140`.

Canonical evidence: `docs/operations/cloud-sql-pitr-rpo-drill-2026-08-16.md`.

## DR cleanup — PASS

Backup-restore cleanup run `31933900598` deleted its isolated recovery target after deletion protection was disabled only for that target.

The PITR drill also disabled deletion protection only on `toca-mcp-pitr-31936171307`, deleted its probe/validation jobs and deleted the PITR target.

Final PITR readback proved:

- temporary PITR target absent;
- production still `RUNNABLE`;
- production deletion protection enabled;
- automated backups enabled;
- PITR enabled;
- normalized production settings unchanged from the pre-drill snapshot.

No temporary DR instance remains from either drill.

## PITR RPO objective — PASS

The prior RPO caveat is closed by the real timestamp-based PITR drill. Measured PITR RPO is **514s (8m34s)** against the <=900s objective.

This evidence is distinct from the older backup-age RPO of ~2h30m: backup restore and PITR are separate recovery modes, and the <=15m objective is now directly demonstrated on the PITR path.

## Incident mode for ambiguous provider writes

After restart, timeout or partial failure:

- do not blindly retry external mutations;
- use durable idempotency/execution/approval descriptors;
- reconcile provider truth first;
- repair local state only through approved reconciliation paths;
- execute bounded governed retry only when provider truth proves the mutation did not happen and approval/idempotency still permit it;
- otherwise preserve ambiguity and escalate.

## Current exit state

Current release reliability path is operationally closed for controlled real-system tests:

- telemetry source plane PASS;
- SLO evaluator PASS;
- Monitoring/Logging IAM PASS;
- managed notification channels PASS;
- four permanent Foundation policies PASS;
- controlled alert provider-path firing proof PASS;
- real isolated backup restore PASS;
- real isolated PITR restore PASS;
- restored-data validation PASS;
- RTO <=60m PASS on both tested recovery paths;
- PITR RPO <=15m PASS;
- DR cleanup PASS;
- production unchanged readback PASS.

WhatsApp, Email sending/provider integration and Google Ads remain intentionally deferred in #153. Optional mailbox-level alert receipt recheck remains continuing operational validation and does not alter the DR proof.