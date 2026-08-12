# Instagram first publication readiness gate

## Goal

Validate the real production dependencies required for the first Instagram publication without performing any external Instagram write.

## Boundary

The readiness workflow is manual-only and fail-closed. It runs with:

- the real `toca-mcp-runtime` service account;
- the production Cloud SQL connection;
- the persisted Meta OAuth token from Secret Manager;
- the real Instagram business account `17841402033495654`;
- `INSTAGRAM_PUBLICATION_WRITES_ENABLED=false`;
- `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false`;
- `MCP_ENABLED=false`.

The workflow must not create an Instagram media container or call the publish endpoint.

## Workflow

`.github/workflows/instagram-first-publication-readiness.yml`

The gate builds the current repository head, deploys an ephemeral Cloud Run Job using the dedicated publication-readiness entrypoint, executes the real read-only preflight, and succeeds only if the Cloud Run Job execution completes successfully.

## Promotion rule

Do not proceed to the first real publication until this workflow is green on the exact commit intended for publication. After it is green, the next step is to prepare one explicit publication request, generate its approval manifest/SHA-256, stage its asset privately, and execute the controlled publication path with the approved request hash bound into runtime configuration.
