# GitHub-native Instagram publication

## Objective

Replace the publication scheduler/runtime dependency on Google Cloud with a GitHub-native control plane while preserving TOCA OS approval, Creative Truth, exact asset binding, idempotency, provider readback, evidence, and fail-closed behavior.

This lane does **not** use Cloud Scheduler, Cloud Run, Cloud SQL, GCS, Workload Identity Federation, Google Secret Manager, or the TOCA_POSTGRES publication daemon.

The canonical editorial/approval source remains TOCA OS. `control/github-native-publication-queue.json` is a controlled execution mirror containing only already-produced and already-approved items.

## Runtime architecture

1. TOCA OS approves the content item and its final asset.
2. The approved JPEG is staged to branch `publication-assets` with `.github/workflows/github-native-instagram-stage-asset.yml`.
3. The stager validates the JPEG magic bytes and exact SHA-256 before committing it as `publication-assets/<sha256>.jpg`.
4. The controlled queue references the resulting `raw.githubusercontent.com` URL and the same SHA-256 recorded by Creative Truth.
5. `.github/workflows/github-native-instagram-publisher.yml` wakes every five minutes at minute `2/5` in `America/Bahia`, avoiding the top-of-hour GitHub Actions hotspot.
6. The runtime selects only items within a maximum ±5 minute window. Missed slots outside that window are not backfilled.
7. The runtime re-downloads the exact public asset, validates JPEG bytes, SHA-256, and Creative Truth output hash, and rejects Google Cloud asset hosts.
8. Before a write, it checks the durable publication ledger and provider reconciliation path.
9. Meta publication uses the existing TOCA OS container → processing status → `media_publish` implementation.
10. A publication is accepted only after an independent provider readback returns the external media ID. Permalink is preserved when returned.
11. State transitions are written to branch `publication-state`; immutable run evidence is uploaded as a GitHub Actions artifact.

## Required GitHub configuration

The GitHub connector cannot create or read repository secrets. Configure the following in **Repository Settings → Secrets and variables → Actions** before CANARY:

### Secret

- `META_ACCESS_TOKEN`: valid Meta access token for the target Instagram professional/business account, with the permissions required by the existing Instagram content publishing integration. Never put this token in the queue, source code, issue, PR, artifact, or asset manifest.

### Variables

- `INSTAGRAM_BUSINESS_ACCOUNT_ID=17841402033495654`
- `META_GRAPH_API_VERSION=v24.0` unless the production Meta integration has been intentionally upgraded and acceptance-tested.
- `TOCA_GITHUB_NATIVE_PUBLICATION_MODE=SHADOW` initially.
- `TOCA_GITHUB_NATIVE_PUBLICATION_WRITES_ENABLED=false` initially.
- `TOCA_GITHUB_NATIVE_CANARY_CONTENT_ITEM_ID` unset until a real canary item is explicitly authorized.
- `ALLOW_LEGACY_GCP_MARKETING_PUBLISH_NOW` must remain unset/false. Setting it to `true` re-enables the legacy GCP publish-now lane and is outside the GitHub-native operating mode.

## Queue contract

`control/github-native-publication-queue.json` is fail-closed. Each item must include:

- canonical `contentItemId`;
- `scheduledAt` and optional `expiresAt`;
- operation (`SUNSET` or `THE_PARTY`);
- `contentStatus=PRODUCED`;
- `approvalStatus=APPROVED`;
- `publicationIntent=SCHEDULED`;
- `channel=INSTAGRAM`;
- `mediaType=IMAGE` or `STORY` for this first controlled lane;
- exact Instagram account ID;
- public content-addressed JPEG URL;
- exact SHA-256;
- stable `correlationId` and `idempotencyKey`;
- full `creativeTruthBinding` with all gates passed and `exactAssetBinding=true`;
- optional source registry coordinates for audit traceability.

The initial queue is intentionally empty. An empty queue performs no provider write.

## Rollout

### OFF / pre-merge

No scheduled GitHub-native workflow exists on `main`; no provider impact.

### SHADOW

After merge, keep:

- `TOCA_GITHUB_NATIVE_PUBLICATION_MODE=SHADOW`
- `TOCA_GITHUB_NATIVE_PUBLICATION_WRITES_ENABLED=false`

Populate one future approved item and stage its exact asset. The workflow must produce `SHADOW_WOULD_PUBLISH` evidence without requiring the Meta write secret.

### CANARY

Only after SHADOW evidence is correct:

- set `TOCA_GITHUB_NATIVE_PUBLICATION_MODE=CANARY`;
- set `TOCA_GITHUB_NATIVE_PUBLICATION_WRITES_ENABLED=true`;
- set `TOCA_GITHUB_NATIVE_CANARY_CONTENT_ITEM_ID` to exactly one explicitly authorized future content item;
- ensure `META_ACCESS_TOKEN` is configured.

Success requires:

- exactly one provider write for the canary item;
- durable ledger transition to `PUBLISHED`;
- external media ID;
- independent provider readback;
- no duplicate on the next scheduler cycle;
- immutable workflow evidence.

If provider state is uncertain, do not retry blindly. The existing executor leaves a fail-closed state requiring reconciliation.

### LIMITED

After successful CANARY, move to `LIMITED` with a small set of approved future items. Continue comparing TOCA OS registry state, GitHub ledger, and provider readback.

### GENERAL

Promote to `GENERAL` only after multiple LIMITED publications have confirmed correct timing, no duplicate writes, correct assets/captions, and stable provider readback.

## Legacy GCP lane

`.github/workflows/marketing-publish-now.yml` is preserved for forensic/rollback purposes but its production job is gated by:

`vars.ALLOW_LEGACY_GCP_MARKETING_PUBLISH_NOW == 'true'`

The variable must stay absent/false during normal GitHub-native operation. There is no automatic fallback from the GitHub-native runtime to the legacy workflow.

## Incident behavior

The system intentionally prefers missed publication over duplicate or unverified publication. It blocks instead of writing when:

- the item is outside the ±5 minute window;
- asset URL is not HTTPS;
- asset URL is not content-addressed by the approved SHA;
- asset resolves to denied Google Cloud publication infrastructure;
- downloaded JPEG hash differs from Creative Truth;
- account ID differs from configured production account;
- write mode is not explicitly enabled;
- CANARY item ID differs from the approved canary;
- manual workflow dispatch lacks explicit write confirmation;
- local ledger indicates `PUBLISHING`, uncertain write state, canceled, or already published;
- provider readback cannot confirm the published media.

Never clear or edit `publication-state` merely to force a retry. Reconcile provider state first.
