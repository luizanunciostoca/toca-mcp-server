# Meta connection — Phase 1

## Purpose

Phase 1 establishes a verifiable read-only connection boundary between TOCA MCP and Meta. It does not publish Instagram content, mutate advertising resources, expose Page access tokens, or advertise write tools.

## Runtime configuration

The integration is opt-in through `META_ENABLED=true`. When enabled, runtime validation requires:

- `META_APP_ID`
- `META_APP_SECRET_PROVIDER`
- `META_APP_SECRET_KEY`
- `META_AUTHORIZATION_ENDPOINT`
- `META_TOKEN_ENDPOINT`
- `META_REDIRECT_URI`
- `META_REQUESTED_SCOPES`
- `META_GRAPH_BASE_URL`
- `META_GRAPH_API_VERSION`

The app secret value itself must live in an external secret store. The repository stores only the provider/key reference.

## MCP transport

Local development remains available through stdio. A separate Node.js remote runtime exposes Streamable HTTP at `/mcp` plus a minimal `/healthz` endpoint. This remote transport exists because ChatGPT connects to remote MCP servers rather than directly spawning the local stdio process.

For the first private validation, bind to localhost and use a supported secure MCP tunnel rather than exposing an unauthenticated public endpoint. Production authentication for the MCP endpoint is a separate concern from Meta OAuth and must be finalized before public deployment.

## Current flow

1. Build an OAuth authorization URL with a cryptographically random, expiring `state`.
2. Consume `state` once at callback time to prevent replay.
3. Exchange the authorization code behind `MetaOAuthTransport`.
4. Persist access-token values behind `SecretStore`; operational state carries only a `SecretReference`.
5. Validate the token through Meta token inspection and verify app ownership/scopes.
6. Persist the connection as `CONNECTED` or `DEGRADED`.
7. Discover managed Pages and linked Instagram professional account IDs using read-only fields.
8. Promote capabilities only from positive provider evidence; documentation or requested scopes alone are insufficient.

## Security invariants

- No raw Meta app secret or access token in Git, TOCA_OS, tool output, logs, or audit payloads.
- No arbitrary HTTP MCP tool.
- No Instagram/Meta Ads write capability in Phase 1.
- No Page access token requested during managed asset discovery.
- OAuth state is expiring and single-use.
- Provider/API version is runtime configuration and must be validated before real-account testing.
- Secret values are persistable/revocable behind a dedicated `SecretStore` boundary.

## Automated checkpoint

The final code-complete Phase 1 checkpoint is head `7308679e2a0e3fd8c215af7341bfb31ce4e8d48e`, validated by Quality Gate run `31291004408`. Frozen install, formatting, architecture checks, lint, typecheck, tests and build all passed.

The checkpoint includes remote Streamable HTTP support, HTTP routing tests, Meta configuration guards, OAuth state/replay protection, token inspection, managed asset discovery, secret persistence boundaries and an Architecture Check-enforced real-validation gate.

This proves code-level behavior under controlled transports; it does not prove a production Meta connection.

## Real-account validation gate

The canonical checklist is `docs/integrations/phase-1-real-validation.md`.

Phase 1 is not connected or production-ready until a real Meta App and authorized owned/test account, plus a real ChatGPT MCP scan, prove the required provider and client evidence. Until then `META_ENABLED` should remain `false` in production and no provider capability should be promoted to `CONNECTED` or `PRODUCTION_VALIDATED`.
