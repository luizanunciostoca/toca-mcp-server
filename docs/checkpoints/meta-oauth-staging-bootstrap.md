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

Cloud Run accepts deployments with all of the intended public-boundary service settings:

- ingress is `all`;
- the default `run.app` URL is enabled;
- the Invoker IAM check is disabled with `--no-invoker-iam-check`;
- the OAuth service remains isolated from MCP by `MCP_ENABLED=false`.

Despite those settings, both Cloud Run service URLs currently return the Google-managed HTML `404` for `/healthz` before the request reaches the application container. The application image itself contains the `/healthz` route, so this is an external Cloud Run edge/policy gate rather than an application-route failure.

An alternative public-access attempt using `allUsers -> roles/run.invoker` was also tested. Cloud Run deployed the revision, but setting the IAM policy was rejected and the service policy remained without an `allUsers` binding.

## Policy diagnostics

The diagnostic smoke follows the Cloud Run troubleshooting path for pre-container `404` responses and attempts to read Cloud Audit policy events for `run.googleapis.com/HttpIngress` plus the effective organization policies relevant to Cloud Run ingress/public access.

The deployment identity currently cannot complete those read-only diagnostics:

- Cloud Logging policy query: `PERMISSION_DENIED` for log views;
- effective organization policy query: missing `getEffectiveOrgPolicy` permission.

The workflow `.github/workflows/gcp-meta-oauth-boundary-smoke.yml` has been returned to manual-only mode after the diagnostic runs.

## Next external gate

Grant the dedicated deployment/diagnostic identity `toca-mcp-deployer@toca-mcp-production.iam.gserviceaccount.com` the minimum read-only permissions required for the remaining diagnosis:

1. `roles/logging.viewer` (Logs Viewer) on project `toca-mcp-production`;
2. `roles/orgpolicy.policyViewer` (Organization Policy Viewer) at a scope where the effective policies for `toca-mcp-production` can be read.

Then rerun the manual OAuth-boundary smoke and determine whether `run.googleapis.com/HttpIngress` is being denied by VPC Service Controls or an effective organization policy.

No Meta/Instagram write capability becomes runtime-exposed before this external gate and the subsequent real Meta OAuth validation are complete.
