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

## Approved privileged operation

### Publication asset bucket

`reconcile-publication-assets-bucket`

It manages only `toca-mcp-publication-assets` and may:

- create the bucket if absent;
- enable Uniform Bucket-Level Access;
- configure a seven-day object lifecycle;
- grant runtime `roles/storage.objectCreator` and `roles/storage.objectViewer` on that bucket;
- verify resulting state.

The bucket remains private. `allUsers` and `allAuthenticatedUsers` are forbidden. Media delivery uses short-lived object-specific signed URLs.

## Active scheduler runtime

The production scheduler executor is **not** provisioned by the privileged infrastructure workflow. Its active topology is the private singleton Cloud Run service:

`toca-managed-instagram-daemon`

The dedicated deployment workflow builds an immutable image, deploys the daemon with one minimum instance, one maximum instance and concurrency 1, wires Cloud SQL/Secret Manager boundaries and verifies the resulting service configuration.

Individual schedule times live in PostgreSQL. Routine schedules are created through the protected `instagram.toca_schedule.*` MCP surface. Application deployment is not a scheduling API.

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

## Workflow

The permanent privileged workflow is `.github/workflows/infrastructure-control-plane.yml`.

It runs only through `workflow_dispatch`, uses the `infrastructure-admin` GitHub Environment, checks out `main`, verifies the policy hash and approved operation, authenticates as the infrastructure administrator, performs the bucket reconciliation and verifies final state.

The workflow must never gain automatic `push` or `pull_request` triggers and must not provision the superseded heartbeat.

## Publication safety

Infrastructure readiness does not authorize publication. Scheduling, approval, provider execution and provider reconciliation remain separate application concerns.

The daemon publication path remains guarded by scheduler/executor configuration, immutable approved descriptor hashes, audit records, idempotency and provider-backed reconciliation. `PUBLISHING`, uncertain provider outcomes and stale local state must fail closed rather than trigger blind retry.
