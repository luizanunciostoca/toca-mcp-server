# AG-01 Production Runtime — Staging Contract — 2026-08-20

## Status

`IMPLEMENTED_NOT_PRODUCTION_VERIFIED`

This document prepares the AG-01 runtime for Cloud Run. It does **not** declare production readiness. Promotion requires a real staging deployment, successful `/readyz`, governed E2E evidence through Core, and provider readback for every exercised side effect.

## Runtime boundary

The executable path is:

`USER -> AG-01 -> TOCA_OS -> ROUTE_ID -> AGENT -> SOP/TEMPLATE -> QUALITY -> POLICY -> APPROVAL -> CORE -> PROVIDER -> READBACK -> AUDIT`

AG-01 owns orchestration state only. It does not write directly to domain tables and does not call providers. All executable capabilities are resolved through the existing Core runtime bindings. Formal approvals are bound to the runtime tenant/workspace/organization scope.

## Entrypoint

Development:

```bash
pnpm dev:orchestrator
```

Built runtime:

```bash
pnpm build
pnpm start:orchestrator
```

Dedicated image:

```text
Dockerfile.orchestrator
```

The container listens on `PORT` and defaults to `0.0.0.0` in production.

## HTTP surface

- `GET /healthz`: process liveness only.
- `GET /readyz`: PostgreSQL, model configuration, renewable Google OAuth, TOCA_OS registry parity, and Core runtime capability readiness.
- `POST /v1/orchestrator/execute`: starts or continues a governed request.
- `POST /v1/orchestrator/resume`: resumes a persisted checkpoint or approval wait.

The execute endpoint does not accept caller-provided identity or tenant fields. Deployment identity and capability/account allowlists are server-side configuration.

## Required configuration

Non-secret environment variables:

```text
NODE_ENV=production
PORT=8080
AG01_OPENAI_MODEL=<approved-model-id>
AG01_TOCA_OS_ROUTING_SPREADSHEET_ID=1vnSliJe2duw278DPPdiTylXUooOdzYtVa0nXD24LEtU
AG01_TOCA_OS_CANONICAL_RESOURCES_SPREADSHEET_ID=1Pc1tyx0dd9GvJBM_8mewh21tfXayfaOhajbmX-uACsY
AG01_OPENAI_API_KEY_ENV_KEY=OPENAI_API_KEY
AG01_GOOGLE_OAUTH_CLIENT_ID_ENV_KEY=GOOGLE_OAUTH_CLIENT_ID
AG01_GOOGLE_OAUTH_CLIENT_SECRET_ENV_KEY=GOOGLE_OAUTH_CLIENT_SECRET
AG01_GOOGLE_OAUTH_REFRESH_TOKEN_ENV_KEY=GOOGLE_OAUTH_REFRESH_TOKEN
AG01_AUTHORIZATION_ROLES=READER
AG01_ALLOWED_ROUTE_IDS=
AG01_ALLOWED_CAPABILITY_IDS=
AG01_ALLOWED_TARGET_ACCOUNTS=
TOCA_DEFAULT_TENANT_ID=toca
TOCA_DEFAULT_WORKSPACE_ID=toca
TOCA_DEFAULT_ORGANIZATION_ID=toca
```

`AG01_ALLOWED_CAPABILITY_IDS` is intentionally empty by default. An empty list means the model can classify and route, but it cannot propose an executable Core capability. Write roles, capabilities, and target accounts must be enabled explicitly and together.

Secrets must be injected through Cloud Run Secret Manager bindings or an equivalent deployment secret mechanism:

```text
DATABASE_URL
OPENAI_API_KEY
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_OAUTH_REFRESH_TOKEN
```

The Google OAuth refresh token must have read access to the canonical TOCA_OS spreadsheets. The runtime exchanges it for short-lived access tokens and caches them only in memory.

Provider-specific Core secrets remain governed by the existing server configuration and are not duplicated in AG-01.

## Cloud Run staging contract

Use a dedicated staging service, authenticated ingress, and the orchestrator Dockerfile. A representative deploy shape is:

```bash
gcloud run deploy toca-ag01-orchestrator-staging \
  --image "$IMAGE" \
  --region "$REGION" \
  --no-allow-unauthenticated \
  --env-vars-file ag01-staging.env.yaml \
  --set-secrets OPENAI_API_KEY=OPENAI_API_KEY:latest,GOOGLE_OAUTH_CLIENT_ID=GOOGLE_OAUTH_CLIENT_ID:latest,GOOGLE_OAUTH_CLIENT_SECRET=GOOGLE_OAUTH_CLIENT_SECRET:latest,GOOGLE_OAUTH_REFRESH_TOKEN=GOOGLE_OAUTH_REFRESH_TOKEN:latest,DATABASE_URL=DATABASE_URL:latest \
  --startup-probe httpGet.path=/readyz,httpGet.port=8080,initialDelaySeconds=1,failureThreshold=12,timeoutSeconds=5,periodSeconds=5 \
  --liveness-probe httpGet.path=/healthz,httpGet.port=8080,initialDelaySeconds=5,failureThreshold=3,timeoutSeconds=2,periodSeconds=15 \
  --readiness-probe httpGet.path=/readyz,httpGet.port=8080,successThreshold=1,failureThreshold=3,timeoutSeconds=5,periodSeconds=10
```

Do not use `--allow-unauthenticated` for this service. Cloud Run IAM is the external authentication boundary; AG-01 still applies its fixed execution identity and Core authorization internally.

## Promotion gates

Before changing status to `PRODUCTION_VERIFIED`, capture evidence for all of the following:

1. Repository Quality Gate, PostgreSQL E2E, and Security Supply Chain are green on the exact PR head.
2. Database migrations, including `026_ag01_orchestrator_runtime.sql`, are applied to staging.
3. The staging revision becomes healthy with `/readyz = 200`.
4. A valid route produces the expected `routeId`, canonical agent, SOP/template evidence, and structured decision.
5. Invalid route and missing artifact fail closed without Core execution.
6. Approval-required work stops at `WAITING_APPROVAL`; revoked/denied approval becomes `HUMAN_REQUIRED` without provider execution.
7. Model timeout, malformed output, provider unavailable, retry, restart, duplicate, and cross-tenant tests pass.
8. A mocked-Core E2E is green in CI.
9. Any real side-effect staging test goes through Core and records provider readback evidence and audit correlation.
10. No secret value, free-form provider call, or direct domain database write is present in AG-01 logs or code paths.

Until these gates have real evidence, the correct status remains `IMPLEMENTED_NOT_PRODUCTION_VERIFIED`.
