# Meta OAuth staging bootstrap checkpoint

## Validated

- GitHub Actions authenticates to Google Cloud through Workload Identity Federation without JSON keys.
- `toca-mcp-staging` deploys the OAuth-capable runtime privately.
- Secret Manager secret `toca-meta-app-secret:1` mounts successfully as `META_APP_SECRET` while `META_ENABLED=false`; the secret value is never printed by CI.
- OAuth HTTP routes are implemented behind `META_ENABLED`:
  - `GET /oauth/meta/start`
  - `GET /oauth/meta/callback`
- `MCP_ENABLED=false` prevents the public OAuth boundary from serving `/mcp`.
- Quality Gate passes format, architecture, lint, typecheck, tests and build.

## Public OAuth boundary

Service `toca-meta-oauth-staging` has been created with `META_ENABLED=false` and `MCP_ENABLED=false`.

The first public-access smoke attempt proved the container deploys, but the deployer cannot change the Cloud Run invoker policy. The Google Cloud operation reported that setting IAM policy failed. The dedicated OAuth boundary therefore remains non-public until the deployer receives the required Cloud Run IAM-policy permission.

The workflow `.github/workflows/gcp-meta-oauth-boundary-smoke.yml` is manual-only and prepared to use `--no-invoker-iam-check`, the preferred public-access mode for this boundary once IAM permits it.

## Next external gate

Grant the dedicated deployment identity the minimum Cloud Run permission set required to update service public-access policy (not the runtime identity). Then run the OAuth-boundary smoke and require:

1. unauthenticated `/healthz` returns 200;
2. unauthenticated `POST /mcp` returns 404;
3. Meta remains disabled until current official scopes, endpoints, Graph API version and redirect URI configuration are confirmed;
4. no Instagram/Meta write capability becomes runtime-exposed before external validation.
