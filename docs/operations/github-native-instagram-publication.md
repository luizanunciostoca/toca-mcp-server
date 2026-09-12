# GitHub-native Instagram publication

## Objective

Replace the publication scheduler/runtime dependency on Google Cloud with a GitHub-native control plane while preserving TOCA OS approval, Creative Truth, exact asset binding, idempotency, provider readback, evidence, and fail-closed behavior.

This lane does **not** use Cloud Scheduler, Cloud Run, Cloud SQL, GCS, Workload Identity Federation, Google Secret Manager, or the TOCA_POSTGRES publication daemon.

The canonical editorial/approval source remains TOCA OS. `control/github-native-publication-queue.json` is a controlled execution mirror containing only already-produced and already-approved items.

## Runtime architecture

1. TOCA OS approves the content item and its final asset.
2. A controlled `repository_dispatch` event of type `github-native-instagram-stage-asset` executes only the workflow committed on the protected default branch.
3. The approved JPEG is staged to branch `publication-assets` with `.github/workflows/github-native-instagram-stage-asset.yml`.
4. The stager validates the initial and effective HTTPS source hosts, JPEG magic bytes, and exact SHA-256 before committing it as `publication-assets/<sha256>.jpg`.
5. The controlled queue references the resulting `raw.githubusercontent.com` URL and the same SHA-256 recorded by Creative Truth.
6. `.github/workflows/github-native-instagram-publisher.yml` wakes every five minutes at minute `2/5` in `America/Bahia`, avoiding the top-of-hour GitHub Actions hotspot.
7. The runtime selects only items within a maximum ±5 minute window. Missed slots outside that window are not backfilled. Timestamps must include `Z` or an explicit numeric offset.
8. The runtime re-downloads only the content-addressed `raw.githubusercontent.com/.../publication-assets/.../<sha256>.jpg` URL, refuses redirects, validates JPEG bytes, SHA-256, and Creative Truth output hash, and rechecks expiry immediately before side effects.
9. Before a write, it validates the durable request fingerprint. IMAGE reconciliation checks `/media`; STORY reconciliation checks the dedicated `/stories` edge. A provider candidate near the target slot is never auto-adopted when exact asset identity cannot be proven; the cycle blocks instead.
10. Meta publication uses the existing TOCA OS container → processing status → `media_publish` implementation.
11. A publication is accepted only after an independent provider readback returns the same external media ID. A locally `PUBLISHED` record also requires a fresh provider readback on the next cycle.
12. State transitions are written to branch `publication-state`; immutable run evidence includes the approved asset SHA, Creative Truth output SHA, correlation ID, idempotency key, request fingerprint, external media ID/permalink when available, and is uploaded as a GitHub Actions artifact.

## Required GitHub configuration

The GitHub connector used by ChatGPT cannot create or read repository secrets/variables. Configure these under **Repository Settings → Secrets and variables → Actions** before CANARY.

### Secret

- `META_ACCESS_TOKEN`: valid Meta access token for the target Instagram professional/business account, with the permissions required by the existing Instagram content publishing integration. Never put this token in the queue, source code, issue, PR, artifact, asset manifest, or chat.

The secret is injected only into the provider-execution step; install/build/setup steps do not receive it.

### Variables

- `INSTAGRAM_BUSINESS_ACCOUNT_ID=17841402033495654`
- `META_GRAPH_API_VERSION=v24.0` unless the production Meta integration has been intentionally upgraded and acceptance-tested.
- `TOCA_GITHUB_NATIVE_PUBLICATION_MODE=SHADOW` initially.
- `TOCA_GITHUB_NATIVE_PUBLICATION_WRITES_ENABLED=false` initially.
- `TOCA_GITHUB_NATIVE_CANARY_CONTENT_ITEM_ID` unset until a real canary item is explicitly authorized.
- `ALLOW_LEGACY_GCP_MARKETING_PUBLISH_NOW` must remain unset/false. Setting it to `true` re-enables the legacy GCP publish-now lane and is outside the GitHub-native operating mode.

There is deliberately **no fallback Instagram account ID**. If `INSTAGRAM_BUSINESS_ACCOUNT_ID` is absent or differs from the queue item, writes fail closed.

## Controlled dispatches

Write-capable workflows do not expose `workflow_dispatch`. This prevents a user-selected feature branch from executing modified controller code with `contents: write` or the Meta token.

After merge, controlled operators may create repository dispatch events against the repository. GitHub executes the workflow from the default branch.

### Stage an approved asset

Event type:

`github-native-instagram-stage-asset`

Client payload:

```json
{
  "source_url": "https://approved-non-gcp-source.example/asset.jpg",
  "expected_sha256": "<64-hex-approved-sha256>",
  "content_item_id": "<canonical-content-item-id>"
}
```

The stager blocks Google Cloud Storage hosts including virtual-hosted bucket subdomains, blocks `run.app`, validates the final effective URL after HTTPS redirects, and then commits only the hash-addressed JPEG and sanitized manifest.

### Controlled publication cycle

Event type:

`github-native-instagram-publish-controlled`

Client payload example for CANARY:

```json
{
  "mode": "CANARY",
  "writes_enabled": "true",
  "canary_content_item_id": "<exact-authorized-content-item-id>"
}
```

Use the literal string `"true"` for `writes_enabled`. Scheduled cycles continue to use repository variables.

## Queue contract

`control/github-native-publication-queue.json` is fail-closed. Each item must include:

- canonical `contentItemId`;
- `scheduledAt` and optional `expiresAt`, always with `Z` or an explicit numeric UTC offset;
- `expiresAt`, when present, strictly after `scheduledAt`;
- operation (`SUNSET` or `THE_PARTY`);
- `contentStatus=PRODUCED`;
- `approvalStatus=APPROVED`;
- `publicationIntent=SCHEDULED`;
- `channel=INSTAGRAM`;
- `mediaType=IMAGE` or `STORY` for this controlled lane;
- exact Instagram account ID;
- content-addressed JPEG URL on the `publication-assets` branch;
- exact SHA-256;
- stable `correlationId` and `idempotencyKey`;
- full `creativeTruthBinding` with all gates passed and `exactAssetBinding=true`;
- optional source registry coordinates for audit traceability.

A durable state record includes a canonical request fingerprint. Reusing the same idempotency key with changed account, media URL, caption, asset hash, correlation, or Creative Truth binding is rejected.

The initial queue is intentionally empty. An empty queue performs no provider write.

## Rollout

### OFF / pre-merge

No scheduled GitHub-native workflow exists on `main`; no provider impact.

### SHADOW

After merge, keep:

- `TOCA_GITHUB_NATIVE_PUBLICATION_MODE=SHADOW`
- `TOCA_GITHUB_NATIVE_PUBLICATION_WRITES_ENABLED=false`

Populate one future approved item and stage its exact asset. The workflow must produce `SHADOW_WOULD_PUBLISH` evidence without constructing the Meta provider client or requiring the Meta write secret.

### CANARY

Only after SHADOW evidence is correct:

- configure `META_ACCESS_TOKEN`;
- configure the exact `INSTAGRAM_BUSINESS_ACCOUNT_ID`;
- set `TOCA_GITHUB_NATIVE_PUBLICATION_MODE=CANARY`;
- set `TOCA_GITHUB_NATIVE_PUBLICATION_WRITES_ENABLED=true`;
- set `TOCA_GITHUB_NATIVE_CANARY_CONTENT_ITEM_ID` to exactly one explicitly authorized future content item.

Success requires:

- exactly one provider write for the canary item;
- durable ledger transition to `PUBLISHED`;
- external media ID;
- independent provider readback with the same ID;
- fresh provider readback on the next scheduler cycle rather than a blind local-state acceptance;
- no duplicate write;
- immutable evidence containing the exact approved binding.

If provider state is uncertain or a nearby provider item cannot be proven to be the exact approved asset, do not retry or auto-adopt it. The lane blocks for reconciliation.

### LIMITED

After successful CANARY, move to `LIMITED` with a small set of approved future items. Continue comparing TOCA OS registry state, GitHub ledger, and provider readback.

### GENERAL

Promote to `GENERAL` only after multiple LIMITED publications have confirmed correct timing, no duplicate writes, correct assets/captions, and stable provider readback.

## Legacy GCP lane

`.github/workflows/marketing-publish-now.yml` is preserved for forensic/rollback purposes but its production job is gated by:

`vars.ALLOW_LEGACY_GCP_MARKETING_PUBLISH_NOW == 'true'`

The variable must stay absent/false during normal GitHub-native operation. There is no automatic fallback from the GitHub-native runtime to the legacy workflow.

## Incident behavior

The system intentionally prefers a missed publication over a duplicate or unverified publication. It blocks instead of writing when:

- the item is outside the ±5 minute window;
- the item expires before side effects complete;
- a timestamp lacks an explicit timezone offset;
- asset URL is not the exact content-addressed GitHub publication asset;
- the asset endpoint redirects;
- downloaded JPEG hash differs from Creative Truth;
- a durable idempotency key is reused with a changed canonical request fingerprint;
- account ID is absent or differs from the queue item;
- write mode is not explicitly enabled;
- CANARY item ID differs from the approved canary;
- a controlled repository dispatch lacks explicit write confirmation;
- local ledger indicates canceled or uncertain write state;
- provider reconciliation finds a nearby publication whose exact asset identity cannot be proven;
- provider readback cannot confirm the external media ID.

Never clear or edit `publication-state` merely to force a retry. Reconcile provider state first.
