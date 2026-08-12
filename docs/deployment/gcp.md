# Google Cloud production foundation

Target runtime: Cloud Run + Artifact Registry + Secret Manager + Cloud SQL for PostgreSQL.

## Security model

- Cloud Run service is private by default.
- GitHub deploys using Workload Identity Federation; no long-lived Google service-account key belongs in GitHub.
- Runtime identity receives only Cloud SQL Client and Secret Manager Secret Accessor for explicitly required secrets.
- Meta secrets are injected by Cloud Run and resolved through `EnvironmentSecretResolver`; raw values are never committed.
- Staging and production use separate Cloud Run services, databases and secret versions.

## Required external bootstrap

1. Create/select the Google Cloud project and billing account.
2. Enable Cloud Run, Artifact Registry, Cloud SQL Admin, Secret Manager and IAM Credentials APIs.
3. Create Artifact Registry repository `toca-mcp`.
4. Create PostgreSQL Cloud SQL instances/databases for staging and production.
5. Create runtime and deploy service accounts with least privilege.
6. Configure GitHub Workload Identity Federation and repository environment variables/secrets.
7. Create Secret Manager resources `toca-database-url`, `toca-meta-app-secret`, and `toca-meta-access-token` without pasting values into GitHub or chat.
8. Run migrations against each database before promoting traffic.

## Promotion rule

Infrastructure being deployable does not make Meta capabilities connected. Instagram/Ads tools remain absent from the MCP registry until real Meta OAuth, provider evidence and ChatGPT-to-MCP validation are completed.
