# Instagram engagement persistence production gate

Status: CODE COMPLETE / PRODUCTION ACTIVATION BLOCKED BY ONE-TIME CLOUD SQL ADMIN BOOTSTRAP

## Proven external boundary

A real post-publication Instagram comment and a real Direct message reached the Cloud Run webhook boundary and were normalized respectively as `COMMENT` and `DIRECT`. Webhook authentication, Meta subscriptions and OAuth permissions are therefore externally proven.

## Implemented safety controls

- Persistent idempotency schema keyed by deterministic `event_id`.
- PostgreSQL event store uses `ON CONFLICT (event_id) DO NOTHING`.
- Audit and idempotency insertions are transactional.
- Audit payload stores channel/timestamp/provider state only; message/comment text and sender identity are not persisted by this layer.
- `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED` defaults to `false`.
- Low-risk verified interactions remain `SUGGEST_ONLY` unless writes are explicitly enabled.
- Write tools remain absent from the runtime-visible MCP registry.

## Existing GCP state

- Cloud SQL instance: `toca-mcp-db`.
- Database: `toca_mcp`.
- Current database user inventory contains only the built-in `postgres` user.
- Expected Secret Manager secret `toca-database-url` is not yet provisioned.
- The GitHub deployer identity intentionally cannot create Cloud SQL users; an attempted bootstrap returned HTTP 403. Do not widen the deployer role just to bypass this guardrail.

## Required one-time administrative bootstrap

Use a human/admin identity with Cloud SQL user administration and Secret Manager administration to:

1. Create a dedicated built-in PostgreSQL user named `toca_mcp_app` with a randomly generated high-entropy password.
2. Grant that user only the privileges required by the `toca_mcp` schema/migrations.
3. Store the connection string in Secret Manager as `toca-database-url`; do not place the password in GitHub Actions secrets, repository files, PR comments or logs.
4. Grant `roles/secretmanager.secretAccessor` on that secret only to `toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com`.
5. Ensure the runtime service account retains Cloud SQL Client access to `toca-mcp-production:southamerica-east1:toca-mcp-db`.

Connection shape expected by the current Cloud Run template:

`postgresql://toca_mcp_app:<URL_ENCODED_PASSWORD>@localhost/toca_mcp?host=/cloudsql/toca-mcp-production:southamerica-east1:toca-mcp-db`

## Activation sequence after bootstrap

1. Run all migrations through a Cloud Run Job using the runtime identity and `toca-database-url`.
2. Validate `meta_webhook_events` and `audit_events` writes with a controlled DB smoke.
3. Run the same deterministic event ID twice and prove the first is accepted and the second is classified as a duplicate without a second audit side effect.
4. Deploy the webhook boundary with `META_WEBHOOK_PERSISTENCE_ENABLED=true` and `DATABASE_URL` from Secret Manager.
5. Keep `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false`.
6. Repeat one controlled real webhook event and verify persistence/audit.
7. Only after these gates are green proceed to the first controlled reply/write validation.
