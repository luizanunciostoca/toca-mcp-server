# Meta OAuth staging bootstrap checkpoint

## Validated

- GitHub Actions authenticates to Google Cloud through Workload Identity Federation without JSON keys.
- `toca-mcp-staging` deploys the OAuth-capable runtime privately.
- Secret Manager secret `toca-meta-app-secret:1` mounts successfully as `META_APP_SECRET` while `META_ENABLED=false`; the secret value is never printed by CI.
- OAuth HTTP routes are implemented behind `META_ENABLED`:
  - `GET /oauth/meta/start`
  - `GET /oauth/meta/callback`
- `MCP_ENABLED=false` prevents the OAuth boundary runtime from serving `/mcp`.
- Quality Gate passes format, architecture, lint, typecheck, tests and build.

## Public OAuth boundary

Service `toca-meta-oauth-staging` exists with `META_ENABLED=false` and `MCP_ENABLED=false`.

Cloud Run accepts deployments with all intended public-boundary service settings:

- ingress is `all`;
- the default `run.app` URL is enabled;
- the Invoker IAM check is disabled with `--no-invoker-iam-check`;
- the OAuth service remains isolated from MCP by `MCP_ENABLED=false`.

The public boundary contract has been validated successfully against the deployed Cloud Run service:

1. unauthenticated `GET /health` returns HTTP 200 with the application health payload;
2. unauthenticated `POST /mcp` returns HTTP 404 with the application payload `{ "error": "not_found" }`;
3. the request therefore reaches the application while MCP remains disabled.

The validated deployment image is:

`southamerica-east1-docker.pkg.dev/toca-mcp-production/toca-mcp/server:smoke-23c08d26ee7a28d479801c855e8f93baf05d6b89`

## Cloud Run `/healthz` finding

The earlier Google-managed HTML `404` was not an IAM, VPC Service Controls, container, or application-startup failure.

Diagnostics proved:

- `run.allowedIngress` effectively allows all ingress values;
- `run.managed.requireInvokerIam` does not force Invoker IAM;
- no `run.googleapis.com/HttpIngress` VPC Service Controls denial was present for the failed requests;
- the deployed revision was ready, receiving 100% of traffic, listening on `0.0.0.0:8080`, and passing its startup TCP probe;
- no Cloud Run request log existed for the `/healthz` probes, confirming that those requests were intercepted before the container.

Cloud Run documents a known issue/reserved-path limitation for some URL paths ending in `z` and recommends avoiding paths ending in `z`. The runtime therefore now exposes `/health` as the Cloud Run-safe public health endpoint while preserving `/healthz` for internal/backward compatibility.

## Organization policy finding

`constraints/iam.allowedPolicyMemberDomains` is restricted to customer ID `C01unw207`. This explains why the alternative `allUsers -> roles/run.invoker` binding was rejected.

The production boundary does not require that binding because `--no-invoker-iam-check` is supported and has now been validated end-to-end.

## Workflow state

`.github/workflows/gcp-meta-oauth-boundary-smoke.yml` is manual-only after validation. It deploys the isolated OAuth boundary and requires the public contract above to pass.

## Next gate: real Meta OAuth

The infrastructure/public-boundary gate is complete.

Before setting `META_ENABLED=true`, validate current official Meta requirements and configure the real OAuth integration:

1. current authorization/token endpoints and Graph API version;
2. exact Instagram permissions/scopes required for the intended read/write capabilities;
3. the production/staging redirect URI matching `GET /oauth/meta/callback`;
4. Meta App ID and existing Secret Manager-backed App Secret configuration;
5. token exchange, granted scopes, expiration/refresh behavior, and failure handling;
6. a real authorization smoke while `MCP_ENABLED=false`;
7. no Instagram/Meta write capability becomes MCP-exposed until the OAuth connection is validated separately.
