# TOCA OS Next — Disaster Recovery Runbook

Status: **IMPLEMENTED CONTRACT / CONTROLLED DRILLS REQUIRED FOR NEW RELEASE**

Route: `R26 BACKUP_RESTORE_DISASTER_RECOVERY`.

This runbook extends the V1 Cloud SQL backup/PITR evidence. It preserves the production database, existing scheduler/outbox/idempotency/audit semantics and historical V1 artifacts. No destructive restore is required merely to prove this contract.

## Recovery inventory

The recovery set must cover the following canonical state, with no parallel substitute database:

- tenant, workspace, organization, tenant configuration and provider/credential binding records;
- scoped ApprovalStore records and approval history;
- CRM records and relationships;
- Conversation and Message durable records;
- Privacy/LGPD ledger events and suppression/consent state derived from the canonical privacy domain;
- AG-01 conversations, message records and runtime circuit state;
- Email dispatch/provider-event ledgers;
- WhatsApp dispatch/provider-event ledgers;
- Attribution records and source identifiers;
- creative registry plus provider/mirror references;
- private assets and immutable manifests/descriptors;
- scheduler jobs, workflow instances/steps, Transactional Outbox and dead-letter state;
- configuration required to reconstruct the private MCP/Core service and the controlled public webhook service;
- WIF, deploy identity and separate MCP/webhook runtime service-account references;
- Secret Manager resource references and pinned version identifiers, never raw secret values;
- provider enablement/verification state for Email, WhatsApp, Google Ads, Meta/Instagram and the AG-01 model provider;
- Audit Ledger and EventRecord evidence needed to prove sequence/integrity.

## Recovery principles

1. Prefer isolated restore targets. Never restore over production solely for testing.
2. Preserve idempotency keys, execution IDs, correlation IDs, approval descriptors and provider external IDs.
3. Restore durable local truth before resuming workers.
4. Keep external mutation workers paused and `TOCA_PLATFORM_KILL_SWITCH=true` until database integrity and provider reconciliation prerequisites pass.
5. Ambiguous external writes require provider readback before retry.
6. Restore the private MCP/Core and public webhook services as separate Cloud Run services with their intended identities and authentication boundaries.
7. Re-enable work in bounded stages and verify Workflow, Outbox and dead-letter state after each stage.
8. Providers default to disabled/unverified after recovery until credential/config references and provider readback are revalidated.
9. Cleanup of isolated drill resources is required evidence; production state must be independently rechecked after a drill.

## Recovery order

1. prove target project, Cloud SQL, database secret, WIF, deploy identity and two runtime identities belong to the intended recovery environment;
2. reconstruct configuration and Secret Manager references without exporting secret plaintext;
3. PostgreSQL isolated restore/PITR and schema/migration integrity verification;
4. Audit Ledger/EventRecord integrity;
5. tenant/configuration bindings, ApprovalStore and Privacy ledger;
6. CRM plus Conversation/Message;
7. AG-01 durable state and circuit state;
8. Attribution, creative registry/mirrors and asset/manifest references;
9. scheduler/workflow/Outbox/dead-letter state;
10. Email and WhatsApp durable dispatch/provider-event reconciliation;
11. provider READ/readback reconciliation for Email, WhatsApp, Google Ads and Meta/Instagram;
12. deploy/read back private MCP/Core and controlled webhook revisions by immutable image digest;
13. clear the mutation kill switch only after readiness and provider gates pass;
14. bounded worker/provider resume;
15. end-to-end readback and observability recovery.

Raw secrets are not restored from repository/database backups. Runtime must resolve the existing Secret Manager references through its authorized identity. Secret rotation after a recovery is allowed, but the selected version reference and provider revalidation evidence must be recorded.

## Cloud SQL backup and PITR prerequisites

Before any release-level DR claim, read back from the selected Cloud SQL instance:

- automated backup enabled;
- PITR enabled;
- transaction-log retention of at least seven days;
- retained backups of at least seven;
- newest successful backup timestamp and resulting backup age.

Production deployment may create a pre-migration on-demand backup, but a restore drill must use staging or another isolated target. The drill target must not share the production database, database secret or runtime service identities.

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

### isolated restore / PITR

Restore the selected backup or PITR timestamp into an isolated staging/drill target. Apply no production traffic. Prove all repository migrations and required Next tables, Audit integrity, ApprovalStore, CRM, Privacy, AG-01, Workflow, Outbox, Email/WhatsApp runtime ledgers and tenant-scoped configuration are readable before any worker resume.

## Drill evidence minimum

For each scenario record:

- exact commit SHA, immutable image digest and environment;
- MCP/Core and webhook Cloud Run revisions;
- backup identifier or PITR timestamp and isolated restore target;
- scenario and injection method;
- correlation/execution/idempotency identity;
- migration list and required-table/schema verification;
- pre-state and post-state;
- AG-01, Workflow and Outbox recovery state;
- Outbox/dead-letter transitions;
- provider enablement state before and after recovery;
- provider readback/revalidation when required;
- duplicate external write count (must be zero);
- Audit Ledger verification result;
- measured recovery start/end timestamps and derived RPO/RTO;
- cleanup result;
- production-unchanged readback when provider/infrastructure resources were involved.

## RPO/RTO

The existing V1 Cloud SQL objectives remain the baseline until superseded by approved evidence:

- PITR RPO `<=15m`;
- PostgreSQL recovery RTO `<=60m`;
- successful backup age `<=36h`;
- restore-drill evidence age `<=90d`.

A drill passes only when the measured recovery point and elapsed recovery time meet the applicable objective. A new release may reuse valid V1 provider capability evidence, but it must not claim a new release-level `PRODUCTION_VERIFIED` DR state without exact-release evidence where the changed surface affects recovery.

## Provider revalidation after recovery

Recovery of database rows or Secret Manager references does not make a provider verified. For every provider that will be enabled after recovery, revalidate credential/config resolution and a safe provider READ/readback against the intended account/binding. Only then may the provider-specific readiness gate be enabled. Never activate a campaign, send a new message or create another external write solely to obtain DR evidence.

## Failure/abort criteria

Abort/resume later if any of the following occurs: target-environment isolation cannot be proven, backup/PITR state is unknown, schema/integrity mismatch, Audit Ledger invalid, lost idempotency identity, AG-01/Workflow/Outbox state is inconsistent, uncontrolled provider mutation risk, unresolved partial write, provider revalidation fails, cleanup is uncertain, or evidence shows that production changed unexpectedly.
