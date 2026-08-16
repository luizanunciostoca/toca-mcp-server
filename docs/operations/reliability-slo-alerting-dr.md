# Foundation v1 — Telemetry, Alerting, SLO and Disaster Recovery

Status: **CODE/RUNTIME + BACKUP-RESTORE RTO VALIDATED; MANAGED ALERT DELIVERY AND PITR-RPO DRILL STILL OPEN**

Current baseline: `main@ce70c66c129b1c629f78e776b023a7fe9cf63569`.

Current provider evidence: `docs/operations/controlled-test-readiness-2026-08-16.md` and `docs/operations/foundation-reliability-provider-evidence.md`.

## Existing telemetry and evidence surfaces

Foundation v1 has:

- structured JSON logging;
- in-process `RuntimeTelemetry` counters/observations;
- Prometheus rendering;
- immutable Audit Ledger with integrity verification;
- append-only `operational_signals` persisted with governed audit transitions;
- durable Workflow, Approval, Transactional Outbox and EventRecord persistence;
- Cloud SQL automated backups, PITR and deletion protection;
- provider read-back requirements for governed external side effects;
- daily reliability control and deterministic incident/SLO evaluation.

## Foundation v1 SLOs

- Core governed request availability: target >=99.9%, rolling 30d with 1h burn windows, sourced from HTTP/Core execution outcome telemetry + audit.
- Managed scheduler tick success: target >=99.5%, rolling 30d with 1h burn windows, sourced from daemon tick telemetry.
- Verified terminal external writes: 100% invariant for every write, sourced from provider read-back + Audit Ledger.
- Oldest pending Outbox age: <=300s continuously, sourced from the Transactional Outbox store.
- Audit Ledger integrity: 100% valid invariant, continuous/daily verification by the ledger verifier.
- Latest successful Cloud SQL backup: <=36h old, checked continuously/daily from Cloud SQL backup metadata.
- Cloud SQL PITR: enabled, checked continuously/daily from Cloud SQL instance metadata.
- Restore drill evidence: <=90d old, verified quarterly from the DR evidence bundle.

An external provider timeout/ambiguous outcome may reduce availability but must never become an unverified success.

## Alert severity

### P0

Immediate correctness/integrity or uncontrolled-side-effect risk, including:

- Audit Ledger integrity failure;
- external-write success without required provider read-back;
- PITR unexpectedly disabled;
- high error-budget burn rate;
- wrong provider target/account readback;
- cross-tenant/approval-binding invariant failure.

Response: fail closed, preserve evidence, identify blast radius and reconcile provider truth before any ambiguous retry.

### P1

Service degradation or recovery-risk threshold exceeded, including:

- SLO below target without P0 burn threshold;
- Outbox oldest pending work >300s;
- backup age >36h or missing backup evidence;
- stale scheduler/process work;
- provider readback/reconciliation backlog.

### P2

Maintenance/reliability debt, including stale restore-drill evidence or non-critical telemetry/provider-read degradation.

## Error budget

For ratio SLO target `T`:

`permitted failure ratio = 1 - T`

`error budget fraction consumed = observed failure ratio / permitted failure ratio`

No-traffic windows return no invented green result.

## Alert delivery architecture

Application code owns deterministic classification and source evidence. Cloud Monitoring/Logging owns managed incident/notification delivery. Do not create a parallel alert daemon.

Existing source signals are sufficient for the first managed policies:

- P0 Audit Ledger integrity failure;
- P1 stalled Outbox;
- P1 stale scheduler jobs;
- P1 Foundation daily-control failure.

Fresh provider evidence shows Monitoring alert-policy/channel IAM is now available. A first real log-based policy create was rejected only because `logging.notificationRules.create` is missing. The required predefined role is `roles/logging.configWriter` for the approved infrastructure-admin identity.

There are currently zero managed notification channels. A real operator destination must be explicitly approved; do not invent an email/webhook merely to report PASS.

## Disaster recovery objectives

Foundation objectives remain:

- **RPO <=15 minutes** for PostgreSQL-governed state when PITR is used;
- **RTO <=60 minutes** to restore the database/service execution boundary to a controlled fail-closed state.

## Executed backup restore drill

A real isolated restore was executed on 2026-08-16. Production was never replaced.

Recovery target:

`toca-mcp-dr-final-31932660953`

Backup end:

`2026-08-16T04:27:19.186Z`

Restore start:

`2026-08-16T06:57:43Z`

Observed backup-based RPO:

**9,024s (~2h30m)**.

Restored-data validation run `31932980178` used the exact deployed application image and proved:

- schema recovered to migration count 16;
- 21 critical tables readable;
- critical foreign keys validated;
- append-only triggers enabled;
- Audit Ledger verifier completed without an integrity failure;
- production unchanged;
- validation job cleaned up.

Measured restore-start-to-validated-data RTO:

**496s (~8m16s)**.

Therefore the tested **RTO objective passes**.

The backup-based drill does **not** validate <=15-minute RPO because the selected backup was older than that objective. PITR remains enabled in production. A PITR-specific drill is required before claiming measured <=15-minute RPO.

## Recovery priority

Recovery order remains:

1. approved repository/release identity;
2. Cloud SQL recovery point;
3. migrations/schema compatibility;
4. Audit Ledger integrity;
5. Approval/Workflow/Outbox consistency;
6. EventRecord/CRM state;
7. private Core/MCP fail-closed runtime;
8. scheduler/timers without provider write enablement;
9. provider READ/reconciliation;
10. provider WRITE capability-by-capability only after read-back readiness is restored.

## DR safety boundaries

- never restore over the production primary during a drill;
- never disable production deletion protection merely for testing;
- never grant DR mutation permissions to the normal runtime identity;
- isolate temporary restore targets;
- prove production readback before/after;
- delete drill targets after evidence capture.

The current validated target inherited deletion protection. The deployer has `cloudsql.instances.delete` but lacks `cloudsql.instances.update`. Therefore the final cleanup requires an administrator to disable deletion protection **only** on `toca-mcp-dr-final-31932660953`; after that, existing automation can delete/read back the target.

## Incident mode for ambiguous provider writes

After restart, timeout or partial failure:

- do not blindly retry an external mutation;
- use durable idempotency/execution/approval descriptors and provider identifiers;
- perform provider read-back/reconciliation first;
- repair local state only through the approved reconciliation path;
- if provider state proves no mutation happened and approval/idempotency still permit execution, use the bounded governed retry;
- otherwise preserve ambiguity and escalate.

## Daily checks

The operating loop should continue to inspect:

- Core health/availability;
- scheduler tick success/last success;
- Outbox pending count/oldest age;
- Audit Ledger integrity;
- approvals/workflows exceeding expected duration;
- ambiguous provider readback/reconciliation backlog;
- backup age and PITR state;
- provider credential/scope/account-binding readiness only for capabilities intended to run that day.

## Current exit state

PASS:

- deterministic SLO evaluator;
- runtime source telemetry;
- Foundation daily control;
- real backup restore;
- recovered schema/critical-data validation;
- measured RTO <=60m.

Open external hardening:

- grant `roles/logging.configWriter` for log-based policies;
- approve/configure a real operator notification channel and prove delivery;
- remove deletion protection on the exact temporary DR target and delete it;
- execute a future PITR-specific drill before claiming measured <=15m RPO.

WhatsApp, Email and Google Ads are intentionally deferred by the owner (#153) and are outside this reliability exit gate.

Current release classification: **ready for controlled real-system tests in the approved current scope; not yet 100% provider-hardened until the external items above are closed.**
