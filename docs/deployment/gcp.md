# Google Cloud production foundation

Target runtime: Cloud Run + Artifact Registry + Secret Manager + Cloud SQL for PostgreSQL for the TOCA OS services that still require Google Cloud infrastructure.

## Security model

- Cloud Run service is private by default.
- GitHub deploys authorized GCP workloads using Workload Identity Federation; no long-lived Google service-account key belongs in GitHub.
- Runtime identity receives only Cloud SQL Client and Secret Manager Secret Accessor for explicitly required secrets.
- Meta secrets are injected by Cloud Run and resolved through `EnvironmentSecretResolver`; raw values are never committed.
- Staging and production use separate Cloud Run services, databases and secret versions.

## Required external bootstrap

1. Create/select the Google Cloud project and billing account.
2. Enable Cloud Run, Artifact Registry, Cloud SQL Admin, Secret Manager and IAM Credentials APIs.
3. Create Artifact Registry repository `toca-mcp`.
4. Create PostgreSQL Cloud SQL instances/databases for staging and production where a surviving runtime requires them.
5. Create runtime and deploy service accounts with least privilege.
6. Configure GitHub Workload Identity Federation and repository environment variables/secrets for authorized GCP workloads.
7. Create Secret Manager resources `toca-database-url`, `toca-meta-app-secret`, and the canonical OAuth token resource `toca-meta-oauth-token` without pasting values into GitHub or chat. The runtime environment variable `TOCA_SECRET_META_ACCESS_TOKEN` binds to `toca-meta-oauth-token`; do not create or reference the deprecated/nonexistent `toca-meta-access-token` resource.
8. Run migrations against each database before promoting traffic when required by that runtime.

## Instagram publication transport — retired on GCP

Google Cloud is no longer an authorized transport for Instagram publication scheduling or publication execution.

The former publication workflows are historical, inert retirement stubs:

- `.github/workflows/deploy-instagram-publication-worker-gcp.yml`;
- `.github/workflows/deploy-toca-managed-instagram-daemon-gcp.yml`.

They must not authenticate to Google Cloud, run `gcloud`, deploy a publication worker/daemon, create a publication scheduler, arm `INSTAGRAM_PUBLICATION_WRITES_ENABLED`, or call the Meta publication provider.

The canonical Instagram publication control plane is `.github/workflows/github-native-instagram-publisher.yml`, with GitHub-native publication assets/state, approval binding, idempotency, provider reconciliation and readback gates.

### Engagement runtime is a separate authority domain

The physical Cloud Run service `toca-managed-instagram-daemon` and its minute tick may still be used by governed Instagram **engagement** workflows. That surviving infrastructure does not carry publication authority.

Any engagement workflow that deploys, refreshes, probes or routes this service must preserve the publication boundary:

- `INSTAGRAM_PUBLICATION_WRITES_ENABLED=false` whenever publication-write configuration is present;
- no engagement rollout may enable Instagram publication writes;
- engagement writes remain governed by their own SHADOW/CANARY/LIMITED controls and authorization contracts;
- publication scheduling and publication provider writes remain exclusively under the GitHub-native publication control plane.

A shared physical service name therefore does not imply shared authority: engagement deployment/execution can remain authorized while publication execution through that GCP runtime is forbidden.

## Promotion rule

Infrastructure being deployable does not make Meta capabilities connected or authorized. Each capability is promoted only through its own provider evidence, authorization, idempotency and rollout gates.

For Instagram publication specifically, GCP deployment is not a promotion path. Publication can advance only through the GitHub-native publication lane and its explicit SHADOW/CANARY/LIMITED/GENERAL gates.
