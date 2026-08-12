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

## Approved operation

The current approved operation is:

`reconcile-publication-assets-bucket`

It manages only the dedicated bucket:

`toca-mcp-publication-assets`

The operation may:

- create the bucket if it does not exist;
- enable Uniform Bucket-Level Access;
- configure a seven-day object lifecycle;
- grant the runtime `roles/storage.objectCreator` on that bucket;
- verify the resulting state.

The bucket must remain private. Public IAM bindings such as `allUsers` and `allAuthenticatedUsers` are forbidden. Media delivery to Meta uses short-lived object-specific signed URLs instead of public bucket access.

## Signed delivery

Publication staging creates a Google Cloud Storage V4 signed GET URL for the exact staged object. The runtime obtains its short-lived access token and service-account identity from the metadata service and uses the IAM Credentials `signBlob` API. No private service-account key is stored or distributed.

The current signed URL lifetime is six hours. The application validates that the signed URL can be fetched externally and resolves to an image before it can be used in a publication request.

If the runtime lacks `iam.serviceAccounts.signBlob` on the signing identity, staging must fail closed. Any bootstrap grant for signing must be scoped to the runtime service account and must not grant project-wide administrative privileges.

## Policy envelope

`infra/control-plane/policy.json` is the authoritative machine-readable envelope. A manual workflow run must receive the expected SHA-256 of that file and must refuse execution when the supplied hash differs from the checked-out `main` policy.

The policy explicitly forbids:

- project Owner;
- project Editor;
- service-account key creation;
- bucket deletion;
- arbitrary `gcloud` execution outside the typed operation;
- runtime privilege escalation;
- public IAM on the publication asset bucket.

## Workflow

The permanent workflow is:

`.github/workflows/infrastructure-control-plane.yml`

It runs only through `workflow_dispatch` and uses the `infrastructure-admin` GitHub Environment. It checks out `main`, verifies the policy hash and approved operation, authenticates as the infrastructure administrator, executes the typed reconciliation, and verifies the final state.

The workflow must never gain automatic `push` or `pull_request` triggers.

## Bootstrap

Creation of the infrastructure administrator service account, Workload Identity binding, and custom role is an exceptional bootstrap action. After bootstrap, operations covered by the policy envelope should be executed through the permanent control-plane workflow.

Any permission required for signed URL generation must be added separately and minimally. The preferred boundary is service-account-level `iam.serviceAccounts.signBlob` for `toca-mcp-runtime` on its own signing identity rather than project-wide Token Creator access.

## Publication safety

Infrastructure readiness does not enable Instagram publication writes. `INSTAGRAM_PUBLICATION_WRITES_ENABLED` remains independently fail-closed, and an exact approved publication request SHA-256 is still required before the controlled publication entrypoint can write to Meta.
