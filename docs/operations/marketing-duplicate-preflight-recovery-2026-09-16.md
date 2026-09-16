# Marketing duplicate preflight recovery — 2026-09-16

## Incident

The production Marketing Publish Now run `35100914297` stopped before provider write while deploying the scheduler-only duplicate preflight Cloud Run Job. The Cloud Run deployment rejected the runtime command/args override. Evidence showed the hardened lane had reached `IMAGES_BOUND` and had not reached `deploy_execute_job`, so no Instagram write was attempted.

## Fix

The duplicate preflight now uses a dedicated immutable image derived from the already-bound application image. The derived image embeds:

`CMD ["node", "dist/src/instagram-provider-duplicate-preflight.js"]`

The Cloud Run Job is deployed without command/args overrides. The job readback verifies the immutable image reference, verifies that no Cloud Run command/args overrides exist, and verifies `INSTAGRAM_PUBLICATION_WRITES_ENABLED=false` before execution.

## Safety state

The expired one-shot publication command is reset to `NOOP` in the same change. A later canary retry requires a new, separately authorized and time-bounded publication envelope after this fix is merged and certified.
