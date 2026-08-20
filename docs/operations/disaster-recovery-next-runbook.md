# TOCA OS Next — Disaster Recovery Runbook

Status: **IMPLEMENTED CONTRACT / CONTROLLED DRILLS REQUIRED FOR NEW RELEASE**

Route: `R26 BACKUP_RESTORE_DISASTER_RECOVERY`.

This runbook extends the V1 Cloud SQL backup/PITR evidence. It preserves the production database, existing scheduler/outbox/idempotency/audit semantics and historical V1 artifacts. No destructive restore is required merely to prove this contract.

## Recovery inventory

The recovery set must cover the following canonical state, with no parallel substitute database:

- CRM records and relationships;
- Conversation and Message durable records;
- Attribution records and source identifiers;
- creative registry plus provider/mirror references;
- private assets and immutable manifests/descriptors;
- scheduler jobs, workflow state, Transactional Outbox and dead-letter state;
- configuration required to reconstruct runtime topology;
- Secret Manager resource references and version identifiers, never raw secret values;
- Audit Ledger and EventRecord evidence needed to prove sequence/integrity.

## Recovery principles

1. Prefer isolated restore targets. Never restore over production solely for testing.
2. Preserve idempotency keys, execution IDs, correlation IDs, approval descriptors and provider external IDs.
3. Restore durable local truth before resuming workers.
4. Keep external mutation workers paused until database integrity and provider reconciliation prerequisites pass.
5. Ambiguous external writes require provider readback before retry.
6. Re-enable work in bounded stages and verify Outbox/dead-letter state after each stage.
7. Cleanup of isolated drill resources is required evidence; production state must be independently rechecked after a drill.

## Recovery order

1. infrastructure/configuration references and network/service identity readiness;
2. PostgreSQL isolated restore/PITR and schema integrity verification;
3. Audit Ledger/EventRecord integrity;
4. CRM plus Conversation/Message;
5. Attribution;
6. creative registry/mirrors and asset/manifests references;
7. scheduler/workflow/Outbox/dead-letter state;
8. provider READ/readback reconciliation;
9. bounded worker resume;
10. end-to-end readback and observability recovery.

Raw secrets are not restored from repository/database backups. Runtime must resolve the existing Secret Manager references through its authorized identity.

## Controlled drill catalog

The executable invariant catalog is `src/core/resilience-drills.ts`. Every drill forbids destructive provider mutation and must preserve Audit, Outbox and idempotency evidence.

### restart

Restart the application/worker process against controlled test state. Prove durable workflow state and idempotency survive and pending work does not produce a duplicate side effect.

### worker crash

Inject a crash after durable claim in a controlled environment. Prove claim expiry/bounded retry or dead-letter behavior and no duplicate external mutation.

### duplicate webhook

Replay the same synthetic/test webhook identity. Prove the existing webhook idempotency path accepts only one durable business transition and records duplicate receipt evidence.

### delayed callback

Delay a controlled provider callback/readback result. Prove local terminal success is not guessed and late truth reconciles to the original execution/correlation identity.

### provider outage

Use a controlled provider stub/failure boundary or a non-mutating unavailable endpoint. Prove failure classification, bounded retry and preserved approval/idempotency.

### partial provider write

Simulate an ambiguous provider result without issuing a new real mutation. Prove provider readback is mandatory before any retry and duplicate mutation remains forbidden.

### ambiguous status

Return a controlled unknown/ambiguous status. Prove it cannot be promoted to verified success and remains reconcilable/escalatable.

### expired token

Use an intentionally invalid/non-production test credential reference or controlled auth stub. Prove there is no alternate-credential bypass and recovery requires credential rotation/readback through the managed secret path.

### quota exceeded

Inject a controlled quota/rate-limit response. Prove bounded/retry-after behavior, durable replayability and absence of tight-loop retry.

## Drill evidence minimum

For each scenario record:

- exact commit SHA and environment;
- scenario and injection method;
- correlation/execution/idempotency identity;
- pre-state and post-state;
- Outbox/dead-letter transitions;
- provider readback when required;
- duplicate external write count (must be zero);
- Audit Ledger verification result;
- cleanup result;
- production-unchanged readback when provider/infrastructure resources were involved.

## RPO/RTO

The existing V1 Cloud SQL objectives remain the baseline until superseded by approved evidence:

- PITR RPO `<=15m`;
- PostgreSQL recovery RTO `<=60m`;
- successful backup age `<=36h`;
- restore-drill evidence age `<=90d`.

A new release may reuse valid V1 provider capability evidence, but it must not claim a new release-level `PRODUCTION_VERIFIED` DR state without exact-release evidence where the changed surface affects recovery.

## Failure/abort criteria

Abort/resume later if any of the following occurs: backup/PITR state unknown, schema/integrity mismatch, Audit Ledger invalid, lost idempotency identity, uncontrolled provider mutation risk, unresolved partial write, cleanup uncertainty, or evidence that production changed unexpectedly.
