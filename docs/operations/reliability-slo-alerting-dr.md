# Foundation v1 — Telemetry, Alerting, SLO and Disaster Recovery

Status: **IMPLEMENTED POLICY + CODE-BACKED EVALUATION; PROVIDER DR DRILL STILL REQUIRES REAL EVIDENCE**

Baseline: `main@b0d067e9cc6b469fdb1421ab7a25a25a3b0f1f47`.

This document closes the missing operational contract around the telemetry and immutable observability already delivered by M-FOUND-08. It does not claim that a Cloud SQL restore has been executed successfully when no such provider evidence exists.

## Existing telemetry and evidence surfaces

Foundation v1 already has:

- structured JSON logging;
- in-process `RuntimeTelemetry` counters/observations;
- Prometheus rendering;
- `/metrics` and `/healthz` on the private TOCA-managed Instagram daemon;
- immutable Audit Ledger with integrity verification;
- append-only `operational_signals` persisted transactionally with governed audit transitions;
- durable Workflow, Approval, Transactional Outbox and EventRecord persistence;
- Cloud SQL automated backups, PITR and deletion protection preserved by the infrastructure control plane;
- provider read-back requirements for governed external side effects.

The missing layer was a canonical interpretation of these signals into objectives and incident severity. `src/core/reliability.ts` now provides that deterministic evaluation contract.

## Foundation v1 SLOs

These are operational objectives, not retroactive claims about historical performance.

| SLI                                |               Target |                        Window | Source                                        |
| ---------------------------------- | -------------------: | ----------------------------: | --------------------------------------------- |
| Core governed request availability |             >= 99.9% |  rolling 30d; 1h burn windows | HTTP/Core execution outcome telemetry + audit |
| Managed scheduler tick success     |             >= 99.5% |  rolling 30d; 1h burn windows | `daemon.tick.started/succeeded/failed`        |
| Verified terminal external writes  |       100% invariant |                   every write | provider read-back + Audit Ledger             |
| Oldest pending Outbox age          |              <= 300s |                    continuous | Transactional Outbox store                    |
| Audit Ledger integrity             | 100% valid invariant | continuous/daily verification | ledger verifier                               |
| Latest successful Cloud SQL backup |           <= 36h old |        continuous/daily check | Cloud SQL backup metadata                     |
| Cloud SQL PITR                     |              enabled |        continuous/daily check | Cloud SQL instance metadata                   |
| Restore drill evidence             |           <= 90d old |                     quarterly | DR evidence bundle                            |

External provider outages do not relax the verification invariant. A provider timeout/ambiguous outcome may reduce availability, but it must never be converted into an unverified success.

## Alert severity

### P0 — correctness, integrity or uncontrolled side-effect risk

Trigger immediately when any of the following is observed:

- Audit Ledger integrity verification fails;
- a terminal external-write success exists without matching provider read-back verification;
- PITR is disabled unexpectedly;
- high burn rate consumes >= 10x the permitted SLO error budget in the evaluated window;
- provider reconciliation proves a local success claim targeted the wrong resource/account;
- cross-tenant or approval-binding invariant violation is detected.

Response: stop affected writes/fail closed, preserve evidence, identify blast radius, reconcile provider truth, and do not auto-retry ambiguous external writes.

### P1 — service degradation or recovery-risk threshold exceeded

Trigger when:

- a SLO is below target without the P0 burn-rate threshold;
- oldest pending Outbox event exceeds 300 seconds;
- latest successful backup is older than 36 hours or backup evidence is missing;
- scheduler/process failures threaten routine execution;
- provider read-back/reconciliation backlog is accumulating.

Response: restore healthy delivery/read path, bound backlog, and block escalation to provider writes when evidence is incomplete.

### P2 — maintenance/reliability debt

Trigger when:

- the last recorded restore drill is missing or older than 90 days;
- non-critical telemetry coverage is incomplete;
- a provider READ integration is degraded without affecting governed write correctness.

P2 does not authorize ignoring a recovery-control gap indefinitely; it must enter the operational backlog with an owner/date.

## Error-budget interpretation

For a ratio SLO with target `T`:

`permitted failure ratio = 1 - T`

`error budget fraction consumed = observed failure ratio / permitted failure ratio`

A value of `1` means the full budget for that evaluated window has been consumed. A value >= `10` is treated as a P0 high-burn event by the Foundation v1 evaluator.

No-traffic windows return `met = null`; the system must not report an invented green availability result when there was no traffic.

## Required telemetry dimensions

Operational metrics and signals must remain low-cardinality. Allowed dimensions include:

- capability ID;
- risk class;
- lifecycle state;
- provider name;
- result class (`success`, `denied`, `failed`, `ambiguous`);
- tenant identifier only when the metric backend and access model are approved for tenant-scoped operational data.

Never use raw payloads, access tokens, personal data, captions/messages, email addresses, phone numbers or unbounded external resource IDs as metric labels.

Correlation/execution/resource identifiers belong in structured logs/audit evidence, not Prometheus label cardinality.

## Alert delivery target

Production alert transport should use the existing GCP operations plane rather than creating an application-specific alert daemon. Cloud Monitoring/Logging alert policies should route P0/P1 notifications to the approved operator notification channel.

Repository code owns the deterministic alert classification; GCP owns notification delivery and infrastructure health signals. If Cloud Monitoring configuration is unavailable, the application must still preserve the source telemetry/evidence so the control can be reconciled later.

No repository secret should contain a raw webhook when a managed notification channel can be used.

## Disaster recovery objectives

Foundation v1 targets:

- **RPO objective: <= 15 minutes** for PostgreSQL-governed state, backed by Cloud SQL PITR and automated backup controls;
- **RTO objective: <= 60 minutes** for restoring the database/service execution boundary to a controlled, fail-closed operational state;
- provider reconciliation may continue after service recovery and is not considered complete until external side effects have been verified against provider truth.

These are objectives. They become validated claims only after a timed restore drill records evidence.

## Recovery priority

Restore in this order:

1. repository/current approved release identity;
2. Cloud SQL data to the selected recovery point;
3. migrations/schema compatibility;
4. Audit Ledger integrity verification;
5. Approval, Workflow and Transactional Outbox state;
6. EventRecord/CRM state;
7. private Core/MCP service in fail-closed mode;
8. scheduler/timers without provider write enablement;
9. provider READ/reconciliation;
10. provider WRITE capability-by-capability only after read-back readiness is re-established.

Do not turn writes back on merely because the application process responds to health checks.

## Restore drill procedure

A quarterly drill must use a temporary isolated recovery target and must never overwrite the production primary.

Required evidence:

1. exact source `main` SHA and deployed image digest;
2. selected Cloud SQL backup/PITR timestamp;
3. creation of an isolated restore target using the infrastructure-admin identity;
4. measured restore start/end timestamps;
5. migrations/schema compatibility check;
6. Audit Ledger integrity verification on restored data;
7. Workflow/Approval/Outbox consistency checks;
8. EventRecord/CRM tenant-scope checks;
9. application boot against the isolated database with provider writes disabled;
10. deterministic recovery scenario demonstrating no duplicate provider mutation;
11. deletion of the isolated drill target after evidence capture;
12. recorded RPO/RTO results and any remediation.

The current infrastructure control-plane intentionally forbids arbitrary instance creation/restore/delete. A real drill therefore requires a separately reviewed, tightly allowlisted DR operation before execution. That safety boundary must not be weakened simply to mark the drill complete.

## Incident mode for ambiguous provider writes

After restart, timeout or partial failure:

- do not blindly retry the external mutation;
- use the persisted idempotency/execution/approval descriptor and provider correlation/resource identifiers;
- perform provider read-back/reconciliation first;
- if provider state proves the side effect happened, repair local durable state/audit through the approved reconciliation path;
- if provider state proves it did not happen and the approval/idempotency contract still permits execution, start the bounded governed retry;
- if truth remains ambiguous, keep the execution non-terminal and escalate for review.

## Daily operational checks

The production operating loop must inspect at least:

- Core health/availability;
- scheduler tick success and last successful tick;
- Outbox pending count/oldest age;
- Audit Ledger integrity status;
- pending/reserved/executing approvals beyond expected duration;
- ambiguous provider read-back/reconciliation backlog;
- latest Cloud SQL backup age and PITR enabled state;
- provider credential/scope/account-binding readiness for capabilities intended to run that day.

These checks should feed the same alert severity contract rather than creating per-domain ad-hoc severity systems.

## Exit conditions

Telemetry/alert/SLO design is considered code-complete when:

- the deterministic evaluator is merged with tests;
- production telemetry sources are mapped to the evaluator/Cloud Monitoring;
- alert delivery for P0/P1 is configured and tested;
- daily reliability checks are operational;
- a real DR restore drill has demonstrated the RPO/RTO objectives or produced remediation.

Until the final two provider/infrastructure validations are executed, Foundation v1 should say **DR designed and guarded, restore drill pending**, not `PRODUCTION_VALIDATED` DR.
