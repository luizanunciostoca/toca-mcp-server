# Foundation v1 — Telemetry, Alerting, SLO and Disaster Recovery

Status: **CURRENT RELEASE TELEMETRY/ALERTING + BACKUP-RESTORE RTO OPERATIONALLY VALIDATED**

Production application source: `ce70c66c129b1c629f78e776b023a7fe9cf63569`.

Current provider evidence: `docs/operations/controlled-test-readiness-2026-08-16.md` and `docs/operations/foundation-reliability-provider-evidence.md`.

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

## DR cleanup — PASS

Run `31933900598` deleted the isolated target after deletion protection was disabled only for that target.

Readback proved:

- temporary target absent;
- production still `RUNNABLE`;
- production deletion protection enabled;
- automated backups enabled;
- PITR enabled.

No temporary DR instance remains.

## RPO caveat

The backup-based drill does not demonstrate the <=15-minute RPO objective because it did not restore to a PITR timestamp. Production PITR is enabled and verified. A future PITR-specific drill should measure the <=15m objective directly; that is continuing reliability validation rather than a current release blocker.

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
- restored-data validation PASS;
- RTO <=60m PASS;
- DR cleanup PASS.

WhatsApp, Email sending/provider integration and Google Ads remain intentionally deferred in #153. A future PITR-specific RPO drill and optional mailbox-level receipt recheck are continuing operational validation, not current release blockers.
