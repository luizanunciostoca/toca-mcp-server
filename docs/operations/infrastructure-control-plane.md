# Infrastructure Control Plane

## Purpose

The TOCA MCP infrastructure control plane is the only approved path for infrastructure mutations that require permissions beyond regular deployer/runtime boundaries. It is deliberately narrow, manual, auditable and fail-closed.

The runtime and normal deployer must not receive project-wide Owner/Editor privileges, service-account key creation privileges, bucket deletion privileges or arbitrary infrastructure administration.

The production cost objective is the lowest recurring infrastructure cost compatible with correct operation. Cost reduction must never remove idempotency, approval boundaries, persistence, deletion protection, backup/PITR safeguards or provider verification.

## Identity boundary

Infrastructure administrator:

`toca-mcp-infra-admin@toca-mcp-production.iam.gserviceaccount.com`

Runtime identity:

`toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com`

GitHub authenticates through Workload Identity Federation. Long-lived service-account keys are forbidden. Infrastructure administrator and runtime identities remain separate.

## Approved privileged operations

### Publication asset bucket

`reconcile-publication-assets-bucket`

It manages only `toca-mcp-publication-assets` and may:

- create the bucket if absent;
- enable Uniform Bucket-Level Access;
- configure a seven-day object lifecycle;
- grant runtime `roles/storage.objectCreator` and `roles/storage.objectViewer` on that bucket;
- verify resulting state.

The bucket remains private. `allUsers` and `allAuthenticatedUsers` are forbidden. Media delivery uses short-lived object-specific signed URLs.

### Cloud SQL cost optimization

`optimize-cloud-sql-cost`

It manages only the existing `toca-mcp-db` Cloud SQL instance and is constrained to the approved cost-reduction transition.

The original provider state was PostgreSQL 18, Enterprise Plus, regional HA, `db-perf-optimized-N-8`, 250 GiB PD-SSD. Run `31844320778` passed policy/authentication/preflight and completed the provider-managed storage shrink from 250 GiB to 156 GiB. Cloud SQL reported a provider minimum of 56 GiB; the approved target therefore preserves the 100 GiB operating buffer recommended for operations such as reindexing. No second shrink is permitted by the active transition policy.

The operation is resumable from three exact intermediate states only:

- `STORAGE_SHRUNK`: Enterprise Plus, REGIONAL, `db-perf-optimized-N-8`, 156 GiB;
- `HA_DISABLED`: Enterprise Plus, ZONAL, `db-perf-optimized-N-8`, 156 GiB;
- `EDITION_TIER_DOWNGRADED`: Enterprise, ZONAL, `db-g1-small`, 156 GiB.

On resume, the operation:

- requires a successful backup no older than 36 hours;
- requires a standalone primary with no read replicas, no external-server configuration and no explicit `max_wal_size` override;
- verifies the already-completed 156 GiB shrink instead of attempting another storage decrease;
- keeps automatic storage increase enabled and caps automatic growth at 206 GiB using the Cloud SQL beta patch surface;
- disables regional HA by moving the same instance to zonal availability if that step is still pending;
- changes the edition to Enterprise and the tier to `db-g1-small` if that step is still pending;
- reduces automated backup retention to 7 retained backups;
- reduces transaction-log retention to 7 days;
- preserves PostgreSQL version, deletion protection, automated backups, point-in-time recovery and PD-SSD;
- verifies final provider state and emits immutable workflow evidence.

`db-g1-small` is the approved production cost floor for the current PostgreSQL architecture. `db-f1-micro` is cheaper but leaves materially less memory headroom and is not adopted as the production baseline without utilization evidence and a separate validation cycle. Shared-core instances do not carry the normal Cloud SQL SLA; this trade-off is explicitly accepted for the current low-volume workload, while backup/PITR and deletion protection remain enabled.

Each step is idempotent inside the allowlisted intermediate-state envelope. Any provider state outside those exact stages fails closed. This makes the workflow safe to resume after a provider or CLI interruption without repeating an already-completed storage shrink.

The operation cannot create/delete/clone/restore instances, delete databases or backups, mutate users or SSL certificates, modify IAM, alter billing, perform a second storage shrink or execute an unguarded/hard-coded storage shrink.

`infra/control-plane/cloudsql-cost-optimizer-role.yaml` defines the least-privilege permission envelope needed by the infrastructure administrator. The role contains existing-instance read/update, provider storage-shrink permissions retained for audit/history, backup metadata read and required project/service-usage reads; it deliberately omits create/delete/restore/import/user/SSL/IAM/billing permissions.

## Minimum-cost scheduler runtime

The TOCA-managed Instagram executor no longer needs an always-on CPU merely to poll PostgreSQL every minute.

The approved production topology is:

`Cloud Scheduler (single global minute tick) -> authenticated private Cloud Run /tick -> PostgreSQL scheduler/worker -> provider`

The Cloud Scheduler job is exactly:

`toca-managed-instagram-tick`

with:

- schedule `* * * * *`;
- timezone `America/Bahia`;
- HTTP `POST` to `/tick`;
- OIDC authentication using `toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com`;
- zero immediate retries; the next minute is the natural retry cadence.

The private Cloud Run executor `toca-managed-instagram-daemon` is configured with:

- `minInstances=0`;
- `maxInstances=1`;
- concurrency `1`;
- CPU throttling enabled;
- request-based execution semantics;
- 1 vCPU and 512 MiB only while requests are active.

The service contains no `setInterval` background poll. `/tick` executes the same deterministic worker batch previously invoked by the 60-second timer. Therefore schedule semantics remain one-minute resolution while idle compute cost is removed.

Individual schedule times remain in PostgreSQL. Routine schedules continue to be created through the protected `instagram.toca_schedule.*` MCP surface. The single global timer contains no content payload and is not a per-content scheduling resource.

The MCP production service is also explicitly configured for scale-to-zero with one maximum instance and CPU throttling. Staging/OAuth surfaces remain scale-to-zero. Cloud Run Jobs used for explicit worker/smoke activity have no idle-instance cost.

## Superseded heartbeat

The prior `Cloud Run Job + Cloud Scheduler Job` legacy heartbeat remains superseded and must not be recreated. The approved `toca-managed-instagram-tick` is different: it is one global authenticated wake-up signal for the private request-driven executor and contains no content-specific schedule or payload.

Per-content Cloud Scheduler jobs remain forbidden. Any legacy provider resources must be decommissioned only after confirming they are no longer referenced.

## Signed delivery

The TOCA-managed executor generates a fresh short-lived GCS signed GET URL at execution time from a stable private object reference. Expiring delivery URLs are not stored in long-lived schedule descriptors.

Signing uses workload identity/metadata-service credentials and IAM Credentials `signBlob`; no private service-account key is stored or distributed.

## Cost floor principles

The machine-readable policy fixes the following floor until measured production evidence justifies another change:

- Cloud SQL: Enterprise, ZONAL, `db-g1-small`;
- database disk: 156 GiB PD-SSD, derived from provider minimum 56 GiB + 100 GiB operational buffer;
- automatic disk growth cap: 206 GiB;
- automated backups: 7 retained backups;
- transaction logs/PITR retention: 7 days;
- TOCA managed executor: scale-to-zero, max 1 instance;
- MCP production surface: scale-to-zero, max 1 instance;
- one global Cloud Scheduler minute trigger only;
- no always-on polling solely for scheduling;
- no unbounded Cloud Run scaling.

Additional reductions may be promoted only after evidence shows they do not weaken correct operation. In particular, reducing Cloud SQL below `db-g1-small`, shrinking below the provider-recommended storage buffer, or removing backup/PITR protection requires a separate capacity/recovery validation.

## Policy envelope

`infra/control-plane/policy.json` is the authoritative machine-readable envelope. The manual privileged workflow receives the expected SHA-256 and refuses execution when it differs from checked-out `main`.

The policy explicitly forbids:

- project Owner/Editor;
- service-account key creation;
- bucket deletion;
- arbitrary `gcloud` outside typed operations;
- runtime privilege escalation;
- public bucket IAM;
- per-content scheduler resources;
- recreation of the superseded legacy heartbeat;
- always-on scheduler polling;
- unbounded Cloud Run scaling;
- using deploy/redeploy as the routine content scheduling transport.

The Cloud SQL operation adds its own stricter deny envelope for instance/database/backup deletion, user/SSL/IAM/billing mutation, a second storage shrink and any provider state outside the recorded resume stages.

## Workflow

The permanent privileged workflow is `.github/workflows/infrastructure-control-plane.yml`.

It runs only through `workflow_dispatch`, uses the `infrastructure-admin` GitHub Environment, checks out `main`, verifies the policy hash and approved operation, authenticates as the infrastructure administrator, performs only the selected allowlisted operation and verifies final state.

The runtime deployment workflow is allowed to reconcile exactly one global authenticated Scheduler job (`toca-managed-instagram-tick`) because it is part of the application runtime topology. It must create/update that trigger before changing the executor to scale-to-zero, so a permission failure leaves the previous always-on executor intact rather than causing missed schedules.

## Publication safety

Infrastructure readiness does not authorize publication. Scheduling, approval, provider execution and provider reconciliation remain separate application concerns.

The publication path remains guarded by scheduler/executor configuration, immutable approved descriptor hashes, audit records, idempotency and provider-backed reconciliation. `PUBLISHING`, uncertain provider outcomes and stale local state must fail closed rather than trigger blind retry.
