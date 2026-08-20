# TOCA OS Next — Disaster Recovery Runbook

Status: **IMPLEMENTED CONTRACT / NEXT SCHEMA RESTORE DRILL REQUIRED**

Route: `R26 BACKUP_RESTORE_DISASTER_RECOVERY`.

This runbook extends the V1 Cloud SQL backup/PITR evidence. It preserves the production database, existing scheduler/outbox/idempotency/audit semantics and historical V1 artifacts. No destructive restore over production is permitted merely to prove this contract.

## Recovery objectives

- PITR RPO `<=15m`;
- PostgreSQL recovery RTO `<=60m`;
- successful automated/on-demand backup age `<=36h`;
- restore-drill evidence age `<=90d`;
- restore drills must target an isolated Cloud SQL instance/project boundary, never the active production instance;
- every release that changes recovery-critical schema must perform a new isolated restore drill before claiming release-level `PRODUCTION_VERIFIED` DR.

The Next schema is recovery-critical because it includes tenant scope, Approval Store scope, CRM/Conversation/Message, Audit, Outbox, AG-01 orchestration state and provider runtime ledgers. Therefore a new restore drill is mandatory after the complete Next migration set has been merged and frozen for release.

## Recovery inventory

The recovery set must cover the following canonical state, with no parallel substitute database:

- tenant registry/configuration, credential/provider bindings and workspace/organization scope;
- Approval Store records/history and tenant scope;
- CRM records and relationships;
- Conversation and Message durable records;
- AG-01 orchestration conversations, message journal and runtime circuits;
- Attribution records and source identifiers;
- creative registry plus provider/mirror references;
- private assets and immutable manifests/descriptors;
- scheduler jobs, workflow state, Transactional Outbox and dead-letter state;
- WhatsApp/Email execution ledgers and provider event evidence already persisted locally;
- configuration required to reconstruct runtime topology;
- Secret Manager resource references and version identifiers, never raw secret values;
- Audit Ledger and EventRecord evidence needed to prove sequence/integrity.

## Production preconditions

Before a governed production rollout:

1. Cloud SQL automated backups must be enabled;
2. PostgreSQL PITR must be enabled;
3. the current release must have a known last successful backup;
4. the production deploy workflow creates and waits for a new pre-migration backup before applying repository migrations;
5. production `DATABASE_URL` must reference a pinned Secret Manager version for revision reproducibility;
6. the release SHA and exact migration set must be recorded;
7. provider mutations that are not `PROVIDER_VERIFIED` remain disabled.

If backup/PITR state cannot be read back, deployment aborts before migration or traffic promotion.

## Staging fail-closed preconditions

Staging is an independent safety boundary, not a production deployment with different labels. A staging workflow must abort before Google Cloud authentication, Secret Manager access, Cloud SQL access or `pnpm migrate` unless `scripts/validate-gcp-deploy-environment.mjs` proves all required coordinates are explicit and isolated.

The GitHub `staging` Environment must define all of the following without fallback:

- `GCP_PROJECT_ID` and `GCP_PROJECT_NUMBER` for staging;
- `GCP_REGION` and `GCP_ARTIFACT_REPOSITORY`;
- `GCP_CLOUD_SQL_INSTANCE`;
- `GCP_CLOUD_RUN_SERVICE`;
- `GCP_WORKLOAD_IDENTITY_PROVIDER` owned by the staging project number;
- `GCP_DEPLOY_SERVICE_ACCOUNT` and `GCP_RUNTIME_SERVICE_ACCOUNT` owned by the staging project;
- `GCP_DATABASE_URL_SECRET` as a project-local Secret Manager ID and an explicit `GCP_DATABASE_URL_SECRET_VERSION`;
- `STAGING_DATABASE_ISOLATION_MODE=DEDICATED_CLOUD_SQL`, or `EXPLICITLY_APPROVED` together with `STAGING_DATABASE_ISOLATION_APPROVAL_REF`;
- explicit project-local secret IDs for every provider that is enabled in staging.

The same Environment must expose read-only production references used only for collision assertions:

- `PRODUCTION_GCP_PROJECT_ID` and `PRODUCTION_GCP_PROJECT_NUMBER`;
- `PRODUCTION_GCP_REGION`;
- `PRODUCTION_GCP_CLOUD_SQL_INSTANCE`;
- `PRODUCTION_GCP_CLOUD_RUN_SERVICE`;
- `PRODUCTION_GCP_DATABASE_URL_SECRET`;
- `PRODUCTION_GCP_WORKLOAD_IDENTITY_PROVIDER`;
- `PRODUCTION_GCP_DEPLOY_SERVICE_ACCOUNT`;
- `PRODUCTION_GCP_RUNTIME_SERVICE_ACCOUNT`.

The validator compares canonical resource identities, not only leaf names. Staging must differ from production for project ID, project number, Cloud SQL resource, Cloud Run resource, database secret resource, WIF provider, deploy identity and runtime identity. Service accounts must belong to the staging project, the WIF provider path must contain the staging project number and provider secret names must be project-local IDs so a fully qualified cross-project secret cannot be injected.

No staging migration or provider mutation is authorized merely because the workflow exists. Until the staging Environment values and isolation evidence are read back and recorded, staging remains **BLOCKED FOR MUTABLE DEPLOY**.

## Recovery principles

1. Prefer isolated restore targets. Never restore over production solely for testing.
2. Preserve idempotency keys, execution IDs, correlation IDs, approval descriptors and provider external IDs.
3. Restore durable local truth before resuming workers.
4. Keep external mutation workers/providers paused until database integrity and provider reconciliation prerequisites pass.
5. Ambiguous external writes require provider readback before retry.
6. Re-enable work in bounded stages and verify Outbox/dead-letter state after each stage.
7. Cleanup of isolated drill resources is required evidence; production state must be independently rechecked after a drill.
8. A database restore does not restore raw secrets. Runtime resolves existing Secret Manager references through the authorized runtime identity.
9. Schema rollback is not assumed. Application rollback is allowed only when the previous revision is backward-compatible with the migrated database; otherwise stop traffic promotion and execute the release-specific recovery decision.

## Rollback and emergency mutation stop

`deploy-gcp.yml` exposes explicit control operations. They never run repository migrations.

### Application rollback

Rollback requires both an explicit existing Cloud Run revision and `rollback_compatibility_ref` evidence that the target revision is compatible with the currently migrated database schema. The workflow verifies that the named revision belongs to the selected service before routing 100% traffic to it. A rollback must never be used as an implicit schema rollback.

### Mutation kill switch

`kill_switch` creates a new Cloud Run revision with `TOCA_PLATFORM_KILL_SWITCH=true` and explicitly routes traffic to that latest revision. The canonical Policy/Core gate denies every capability with `sideEffects=true` before provider execution while read-only capabilities, `/healthz` and dependency `/readyz` remain available for inspection and recovery.

`clear_kill_switch` is a separate explicit operation. Normal deploy and rollback refuse to continue when the currently serving service has the mutation kill switch active, preventing an unrelated release operation from silently clearing the emergency stop.

After either kill-switch operation, read back the latest revision, traffic target and configured switch value. After activation, prove a controlled side-effect capability is denied without calling a provider; do not perform a real business-provider mutation as the validation method.

## Backup and PITR operational procedure

### Read back protection state

Before a production migration, inspect the Cloud SQL instance and require both:

- `settings.backupConfiguration.enabled=true`;
- `settings.backupConfiguration.pointInTimeRecoveryEnabled=true`.

The deployment workflow performs this readback automatically.

### Pre-migration backup

Production deploy creates an on-demand backup with the release SHA in its description and waits for completion before `pnpm migrate`. Do not use an asynchronous fire-and-forget backup as the pre-migration gate.

Evidence must record:

- instance/project;
- backup identifier;
- creation/start/end timestamps;
- successful status;
- release SHA;
- migration start timestamp after backup completion.

### PITR source selection

For a recovery event, identify the restore timestamp from durable incident evidence and choose the latest safe point before corruption or incompatible mutation. The selected point must satisfy the RPO objective and preserve enough audit/outbox state to reconcile external truth.

Do not guess the point solely from application logs. Correlate Cloud SQL timeline, Audit Ledger, Outbox/EventRecord, deployment SHA/revision and provider readback.

## Recovery order

1. infrastructure/configuration references and network/service identity readiness;
2. PostgreSQL isolated backup restore or PITR;
3. migration/schema completeness verification against the exact release repository;
4. `/readyz` dependency checks against the isolated environment with external providers disabled unless separately verified;
5. Audit Ledger/EventRecord integrity;
6. tenant, Approval Store, CRM plus Conversation/Message;
7. AG-01 orchestration persistence;
8. Attribution;
9. creative registry/mirrors and asset/manifests references;
10. scheduler/workflow/Outbox/dead-letter state;
11. provider READ/readback reconciliation where permitted;
12. bounded worker resume;
13. end-to-end readback and observability recovery.

## Next schema isolated restore drill

Run this drill only after the complete Next migration set has been integrated and the release candidate SHA is frozen.

### Phase A — freeze evidence

Record:

- candidate SHA;
- current migration file list and highest migration;
- source Cloud SQL instance/database version;
- backup/PITR status and retention;
- current `/healthz` and `/readyz` results;
- row/count fingerprints for recovery-critical tables where safe;
- current Audit Ledger verification result;
- current Outbox pending/retry/dead-letter summary.

### Phase B — create isolated target

Create a new isolated Cloud SQL target for the drill using either:

- a selected successful backup; or
- PITR to a chosen timestamp.

The target must use a distinct instance identity and must not receive production application traffic. Provider mutation flags remain disabled.

### Phase C — restore and schema validation

After restore:

1. connect only through the drill environment identity;
2. verify `schema_migrations` contains every migration in the exact candidate repository;
3. verify all mandatory readiness relations exist, including tenant/config/provider binding, Approval, Audit, Outbox, CRM, AG-01, WhatsApp and Email runtime tables;
4. run the same runtime readiness contract against the drill database;
5. verify `/healthz=200` and `/readyz=200` only after all mandatory local dependencies are healthy;
6. prove an intentionally unavailable mandatory dependency forces `/readyz=503` while `/healthz` remains live.

### Phase D — integrity and replay safety

Verify:

- Audit Ledger head/latest-event consistency and the canonical full-chain verifier;
- Approval Store tenant/workspace/organization scope;
- CRM Conversation/Message referential integrity;
- AG-01 checkpoint/journal persistence;
- Outbox oldest pending age, retry/dead-letter state and idempotency identities;
- provider execution ledgers retain external IDs and uncertainty state;
- no external business-provider mutation is emitted during the drill.

### Phase E — RPO/RTO calculation

RPO is measured from the selected restore point to the last durable source event that should have been recoverable. RTO is measured from recovery authorization/start through restored service reaching the required readiness and integrity gates.

A drill passes only when measured:

- `RPO <=15m`;
- `RTO <=60m`.

Record actual measured values; do not infer success from configured retention alone.

### Phase F — cleanup and production readback

After evidence capture:

1. destroy only the isolated drill resources according to the approved infrastructure path;
2. verify the production Cloud SQL instance was not restored/reconfigured by the drill;
3. verify production backup/PITR remain enabled;
4. verify permanent Secret Manager references and provider flags are unchanged;
5. verify production Audit/Outbox/provider state is unchanged except for normal concurrent business activity;
6. retain the drill artifact/evidence record according to operational retention policy.

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
- source/target Cloud SQL identities when applicable;
- selected backup or PITR timestamp;
- backup/PITR provider readback;
- correlation/execution/idempotency identity;
- pre-state and post-state;
- migration/schema verification;
- `/healthz` and `/readyz` results;
- measured RPO and RTO for restore drills;
- Outbox/dead-letter transitions;
- provider readback when required;
- duplicate external write count (must be zero);
- Audit Ledger verification result;
- cleanup result;
- production-unchanged readback when provider/infrastructure resources were involved.

## Failure/abort criteria

Abort/resume later if any of the following occurs: staging isolation is unproven, a staging coordinate is absent, a staging resource collides with production, WIF/service identity ownership is ambiguous, provider secret ownership is ambiguous, backup/PITR state is unknown, pre-migration backup is incomplete, schema/migration mismatch exists, readiness fails, Audit Ledger is invalid, idempotency identity is lost, tenant scope is violated, uncontrolled provider mutation risk exists, a partial write remains unresolved, rollback compatibility is unproven, RPO/RTO is breached, cleanup is uncertain, or production changed unexpectedly.
