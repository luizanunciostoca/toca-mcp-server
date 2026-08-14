# Infrastructure Control Plane

## Purpose

The TOCA MCP infrastructure control plane is the only approved path for infrastructure mutations that require permissions beyond regular deployer/runtime boundaries. It is deliberately narrow, manual, auditable and fail-closed.

The runtime and normal deployer must not receive project-wide Owner/Editor privileges, service-account key creation privileges, bucket deletion privileges or arbitrary infrastructure administration.

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

The original provider state was PostgreSQL 18, Enterprise Plus, regional HA, `db-perf-optimized-N-8`, 250 GiB PD-SSD. Run `31844320778` passed policy/authentication/preflight and completed the provider-managed storage shrink from 250 GiB to 156 GiB. Cloud SQL reported a provider minimum of 56 GiB; the approved target therefore preserved the 100 GiB operating buffer. The run then stopped before HA/edition/tier changes because the GA gcloud build on the runner did not recognize the auto-growth-limit flag even though the current Cloud SQL SDK documentation exposes it. No second shrink is permitted.

The active policy is therefore resumable from three exact intermediate states only:

- `STORAGE_SHRUNK`: Enterprise Plus, REGIONAL, `db-perf-optimized-N-8`, 156 GiB;
- `HA_DISABLED`: Enterprise Plus, ZONAL, `db-perf-optimized-N-8`, 156 GiB;
- `EDITION_TIER_DOWNGRADED`: Enterprise, ZONAL, `db-g1-small`, 156 GiB.

On resume, the operation:

- requires a successful backup no older than 36 hours;
- requires a standalone primary with no read replicas, no external-server configuration and no explicit `max_wal_size` override;
- verifies the already-completed 156 GiB shrink instead of attempting another storage decrease;
- keeps automatic storage increase enabled and caps automatic growth at 206 GiB using the Cloud SQL beta patch surface, which exposes `--storage-auto-increase-limit` on runner versions where the GA surface may lag;
- disables regional HA by moving the same instance to zonal availability if that step is still pending;
- changes the edition to Enterprise and the tier to `db-g1-small` if that step is still pending;
- reduces automated backup retention to 7 retained backups;
- reduces transaction-log retention to 7 days;
- preserves PostgreSQL version, deletion protection, automated backups, point-in-time recovery and PD-SSD;
- verifies final provider state and emits immutable workflow evidence.

Each step is idempotent inside the allowlisted intermediate-state envelope. Any provider state outside those exact stages fails closed. This makes the workflow safe to resume after a provider or CLI interruption without repeating an already-completed storage shrink.

The operation cannot create/delete/clone/restore instances, delete databases or backups, mutate users or SSL certificates, modify IAM, alter billing, perform a second storage shrink or execute an unguarded/hard-coded storage shrink.

`infra/control-plane/cloudsql-cost-optimizer-role.yaml` defines the least-privilege permission envelope needed by the infrastructure administrator. The role contains existing-instance read/update, provider storage-shrink permissions retained for audit/history, backup metadata read and required project/service-usage reads; it deliberately omits create/delete/restore/import/user/SSL/IAM/billing permissions.

## Active scheduler runtime

The production scheduler executor is **not** provisioned by the privileged infrastructure workflow. Its active topology is the private singleton Cloud Run service:

`toca-managed-instagram-daemon`

The dedicated deployment workflow builds an immutable image, deploys the daemon with one minimum instance, one maximum instance and concurrency 1, wires Cloud SQL/Secret Manager boundaries and verifies the resulting service configuration.

Individual schedule times live in PostgreSQL. Routine schedules are created through the protected `instagram.toca_schedule.*` MCP surface. Application deployment is not a scheduling API.

The daemon remains at `minInstances=1` because its current implementation performs background polling every 60 seconds. Changing it to scale-to-zero would change execution semantics and is outside the current "preserve architecture" cost-reduction operation. A future migration to Cloud Run Jobs/Scheduler may be assessed separately if a topology change is approved.

## Superseded heartbeat

The prior `Cloud Run Job + Cloud Scheduler Job` heartbeat topology is superseded and is no longer an allowed infrastructure operation. Active policy explicitly forbids recreating it.

Legacy heartbeat code/IAM/workflow artifacts are removed from the active control plane. Any already-existing provider resources must be treated as legacy infrastructure and decommissioned only through a separately reviewed operation after confirming they are no longer referenced.

## Signed delivery

The TOCA-managed executor generates a fresh short-lived GCS signed GET URL at execution time from a stable private object reference. Expiring delivery URLs are not stored in long-lived schedule descriptors.

Signing uses workload identity/metadata-service credentials and IAM Credentials `signBlob`; no private service-account key is stored or distributed.

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
- recreation of the superseded heartbeat;
- using deploy/redeploy as the routine scheduling transport.

The Cloud SQL operation adds its own stricter deny envelope for instance/database/backup deletion, user/SSL/IAM/billing mutation, a second storage shrink and any provider state outside the recorded resume stages.

## Workflow

The permanent privileged workflow is `.github/workflows/infrastructure-control-plane.yml`.

It runs only through `workflow_dispatch`, uses the `infrastructure-admin` GitHub Environment, checks out `main`, verifies the policy hash and approved operation, authenticates as the infrastructure administrator, performs only the selected allowlisted operation and verifies final state.

The workflow must never gain automatic `push` or `pull_request` triggers and must not provision the superseded heartbeat.

## Publication safety

Infrastructure readiness does not authorize publication. Scheduling, approval, provider execution and provider reconciliation remain separate application concerns.

The daemon publication path remains guarded by scheduler/executor configuration, immutable approved descriptor hashes, audit records, idempotency and provider-backed reconciliation. `PUBLISHING`, uncertain provider outcomes and stale local state must fail closed rather than trigger blind retry.
