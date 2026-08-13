# Infrastructure Control Plane

## Purpose

The TOCA MCP infrastructure control plane is the only approved path for infrastructure mutations that require permissions beyond the regular deployer/runtime boundaries. It is deliberately narrow, manual, auditable, and fail-closed.

The runtime and normal deployer must not receive project-wide Owner/Editor privileges, service-account key creation privileges, bucket deletion privileges, or arbitrary infrastructure administration.

## Identity boundary

The dedicated administrative identity is:

`toca-mcp-infra-admin@toca-mcp-production.iam.gserviceaccount.com`

GitHub authenticates to it through Workload Identity Federation. No long-lived service-account key is used.

The runtime identity remains:

`toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com`

The infrastructure administrator and runtime identities must remain separate.

## Approved operations

### Publication asset bucket

`reconcile-publication-assets-bucket`

It manages only the dedicated bucket:

`toca-mcp-publication-assets`

The operation may:

- create the bucket if it does not exist;
- enable Uniform Bucket-Level Access;
- configure a seven-day object lifecycle;
- grant the runtime `roles/storage.objectCreator` and `roles/storage.objectViewer` on that bucket;
- verify the resulting state.

The bucket must remain private. Public IAM bindings such as `allUsers` and `allAuthenticatedUsers` are forbidden. Media delivery to Meta uses short-lived object-specific signed URLs instead of public bucket access.

### TOCA-managed Instagram heartbeat

`reconcile-toca-managed-instagram-heartbeat`

This operation may reconcile exactly two named infrastructure resources in `southamerica-east1`:

- Cloud Run Job `toca-managed-instagram-publication-worker`;
- Cloud Scheduler Job `toca-managed-instagram-publication-heartbeat`.

The worker image must already exist in the official Artifact Registry repository and must be supplied by immutable digest using the form `southamerica-east1-docker.pkg.dev/toca-mcp-production/toca-mcp/server@sha256:<64 hex>`. The infrastructure administrator does not build or push application images.

Provisioning is deliberately fail-closed. The Cloud Run Job is deployed with `TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED=false`, `TOCA_MANAGED_INSTAGRAM_EXECUTOR_ENABLED=false`, `INSTAGRAM_PUBLICATION_WRITES_ENABLED=false` and `META_ENABLED=false`. The Cloud Scheduler heartbeat is reconciled to `*/5 * * * *` in `America/Bahia` and then left `PAUSED`.

The heartbeat contains only an authenticated POST request that wakes the named Cloud Run Job. It must not contain a content item ID, caption, media URL, approval hash, asset ID or publication timestamp. Individual publication timing remains exclusively in TOCA Postgres and is evaluated by `claimDue()`.

The runtime service account may receive `roles/run.invoker` only on the dedicated Cloud Run Job so Cloud Scheduler can invoke it. The infrastructure administrator may require a bootstrap `iam.serviceAccounts.actAs` grant scoped specifically to the runtime service account; this prerequisite must not be replaced by project-wide Service Account User/Token Creator access.

The infrastructure administrator permissions required to reconcile the heartbeat should be limited to Cloud Run Job create/get/update/getIamPolicy/setIamPolicy and Cloud Scheduler Job create/get/update/pause. Creation of service accounts, service-account keys, arbitrary project IAM mutation, scheduler resume and automatic executor activation are outside this operation.

A separate post-smoke activation milestone is required before the scheduler may be resumed or the TOCA-managed executor may be enabled. The infrastructure provisioning operation itself is permanently forbidden from doing either.

## Signed delivery

Publication staging creates a Google Cloud Storage V4 signed GET URL for the exact staged object. The runtime obtains its short-lived access token and service-account identity from the metadata service and uses the IAM Credentials `signBlob` API. No private service-account key is stored or distributed.

The current signed URL lifetime is six hours for the legacy controlled flow. The TOCA-managed executor generates a fresh short-lived URL at execution time rather than persisting an expiring delivery URL in the long-lived scheduled descriptor.

If the runtime lacks `iam.serviceAccounts.signBlob` on the signing identity, staging must fail closed. Any bootstrap grant for signing must be scoped to the runtime service account and must not grant project-wide administrative privileges.

## Policy envelope

`infra/control-plane/policy.json` is the authoritative machine-readable envelope. A manual workflow run must receive the expected SHA-256 of that file and must refuse execution when the supplied hash differs from the checked-out `main` policy.

The policy explicitly forbids:

- project Owner;
- project Editor;
- service-account key creation;
- bucket deletion;
- arbitrary `gcloud` execution outside typed operations;
- runtime privilege escalation;
- public IAM on the publication asset bucket;
- one Cloud Scheduler resource per content item.

## Workflow

The permanent workflow is:

`.github/workflows/infrastructure-control-plane.yml`

It runs only through `workflow_dispatch` and uses the `infrastructure-admin` GitHub Environment. It checks out `main`, verifies the policy hash and approved operation, authenticates as the infrastructure administrator, executes the typed reconciliation, and verifies the final state.

For heartbeat reconciliation it additionally verifies the immutable application image digest, deploys the worker disabled, reconciles the fixed scheduler target and leaves the scheduler paused. The workflow must never contain an executor-enable operation or `gcloud scheduler jobs resume`.

The workflow must never gain automatic `push` or `pull_request` triggers.

## Bootstrap

Creation of the infrastructure administrator service account, Workload Identity binding, and narrowly scoped custom roles is an exceptional bootstrap action. After bootstrap, operations covered by the policy envelope should be executed through the permanent control-plane workflow.

Any permission required for signed URL generation must be added separately and minimally. The preferred boundary is service-account-level `iam.serviceAccounts.signBlob` for `toca-mcp-runtime` on its own signing identity rather than project-wide Token Creator access.

For the heartbeat, any `iam.serviceAccounts.actAs` prerequisite must likewise be scoped to `toca-mcp-runtime` rather than granted project-wide. If the required Cloud Run/Scheduler administrative permissions are not yet present on the infrastructure administrator, reconciliation must fail closed until that bootstrap is completed.

## Publication safety

Infrastructure readiness does not enable Instagram publication writes. `INSTAGRAM_PUBLICATION_WRITES_ENABLED` remains independently fail-closed, and the manual controlled publication path continues to require an exact approved publication request SHA-256.

The TOCA-managed path uses per-job approved descriptor hashes instead of the manual global hash, but `TOCA_MANAGED_INSTAGRAM_EXECUTOR_ENABLED` remains independently fail-closed. Provisioning the heartbeat is not authorization to publish. Provider-backed smoke validation and an explicit activation milestone are required before scheduled jobs may execute automatically.
