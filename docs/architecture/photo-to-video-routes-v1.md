# Photo-to-Video Routes V1

Parent policy: `TOCA_CREATIVE_TRUTH_POLICY_V1`  
Video policy: `TOCA_PHOTO_TO_VIDEO_POLICY_V1`

## Canonical parent policy gate

The repository child policy is not sufficient authority by itself. `GoogleSheetsPhotoToVideoParentPolicyGuard` re-reads the canonical Creative Truth `POLICY!A1:AC20` range from Google Drive/Sheets before generation and finalization.

The guard requires exactly one `TOCA_CREATIVE_TRUTH_POLICY_V1` row with `status=ACTIVE_CANONICAL` and verifies:

- `brand_scope=TOCA_DO_MORCEGO`;
- official logos only;
- Venue Fidelity, Brand Integrity and Quality gates enabled;
- `fail_closed=TRUE`;
- `photo_to_video_policy_id=TOCA_PHOTO_TO_VIDEO_POLICY_V1`;
- `full_synthetic_venue_video=UNSUPPORTED_V1`;
- `video_photo_motion=ACTIVE_V1` for `REAL_PHOTO_TO_MOTION_VIDEO`;
- `video_generative_exception=SOURCE_ANCHORED_SCENE_CONTINUATION_GOVERNED_V1` for `GENERATIVE_SCENE_CONTINUATION_VIDEO`.

Missing/ambiguous rows, policy drift or route disablement fail closed before provider work.

## Routes

### `REAL_PHOTO_TO_MOTION_VIDEO`

Safe deterministic route from an approved real photograph. The exact MARKETING_READY master is downloaded and SHA-256 verified. `LocalPhotoMotionVideoComposer` creates camera motion with FFmpeg. No semantic generation, architectural invention or scene expansion is permitted.

Provider: `LOCAL_FFMPEG`.

### `GENERATIVE_SCENE_CONTINUATION_VIDEO`

Controlled source-anchored image-to-video continuation. The exact MARKETING_READY master is bound to an explicit `VIDEO_GENERATIVE_EXCEPTIONS` approval, downloaded from Drive and SHA-256 verified before any provider call.

This is not full-synthetic venue video. The source remains the factual anchor. Full synthetic venue video without a canonical source is unsupported.

## Governed provider plan

Canonical production preference:

1. `GOOGLE_VERTEX_VEO` — primary;
2. `OPENAI_VIDEO_API` — optional secondary when runtime credentials are configured and validated.

The provider order can be configured with `VIDEO_SCENE_CONTINUATION_PROVIDER_ORDER=GOOGLE_VERTEX_VEO,OPENAI_VIDEO_API`, or by the backward-compatible primary/fallback pair `VIDEO_SCENE_CONTINUATION_PROVIDER` + `VIDEO_SCENE_CONTINUATION_FALLBACK_PROVIDER`.

The historical default remains single-provider OpenAI when no provider configuration is supplied, to avoid an implicit production configuration change. Production deployments should explicitly configure the canonical plan.

### Failover boundary

`FailoverSceneContinuationVideoProvider` may call a secondary provider only when the prior provider throws an `ExecutionError` that is:

- `retryable=true`; and
- code `PROVIDER_UNAVAILABLE` or `PROVIDER_RATE_LIMITED`.

Failover is forbidden for policy, approval, rights/likeness, source/hash binding, state conflict, fidelity, quality, standard or technical-spec failures. The provider layer can never convert a governance hard fail into a retry on a different model.

A successful candidate may carry `providerAttemptChain` and `providerFallbackUsed`. The manifest requires the final provider to equal the final entry in the attempt chain, and the fallback flag must agree with the chain length.

## Provider implementations

### Vertex Veo

The canonical primary adapter is `GOOGLE_VERTEX_VEO`, with allowed models `veo-3.1-generate-001` and `veo-3.1-fast-generate-001`. It uses Vertex AI `predictLongRunning`, source image anchoring, governed GCS output and source/approval binding. Current runtime identity uses `GCP_SERVICE_IDENTITY`, normally in `us-central1`.

### OpenAI Video API

The secondary adapter supports `sora-2` and `sora-2-pro`. It uses the same canonical source bytes, approval, operation/product/standard context and post-generation review boundary. It is not live redundancy merely because the adapter exists; runtime credential and real provider-call evidence remain separate readiness gates.

### Runway

Runway is not part of this runtime provider plan. It remains unavailable as a governed fallback until an eligible video model is exposed in the connected workspace and an explicit TOCA adapter passes the same policy, rights, binding, review and exact-output contracts.

## Runtime identity

Production Veo uses `VIDEO_GOOGLE_AUTH_MODE=GCP_SERVICE_IDENTITY`. Vertex/GCS use the attached service identity with cloud-platform access. Drive/Sheets use `GoogleServiceIdentityOAuthResolver` with short-lived Workspace scopes, without storing a service-account private key.

OpenAI credentials resolve through the existing environment-secret chain. Missing provider credentials make the selected provider plan not configured; they do not authorize fallback to an ungoverned route.

## Product model

The runtime is registry-driven. `PRODUCT_VISUAL_POLICIES` and `VIDEO_CREATIVE_STANDARDS` define product/operation rules. The Party retains its edition/environment/visual-family authority via `GoogleSheetsThePartyContentOrchestration`.

For The Party the candidate binds edition, creative intent and canonical environment when applicable. Finalization compares those values against a fresh read.

## Source library / coverage

A provider cannot compensate for an empty footage library. The operational source layer uses:

- `VIDEO_SHOTS` as the structured shot catalog;
- `VIDEO_SOURCE_INTAKE` for files not yet canonical;
- `02_VIDEOS/00_INTAKE` for physical intake;
- `02_VIDEOS/01_CANONICAL_SOURCES` for source-bound footage;
- story-function metadata to cover HOOK, PLACE_PROOF, HUMAN, DJ, DETAIL, CROWD, CLIMAX, TRACK_NATIONAL, TRACK_INTERNATIONAL, CIRCULATION and CTA background use cases.

Missing essential coverage should be represented as `VIDEO_COVERAGE_GAP`, not filled with generic or full-synthetic venue footage.

## Rights and likeness

`VIDEO_SOURCE_RIGHTS` is mandatory. Rights are never inferred from Drive location, filename, prior publication, upload provenance or MARKETING_READY status.

Accepted rights states remain `OWNED`, `LICENSED`, `CLEARED` and `RIGHTS_CLEARED`. An eligible ACTIVE record requires durable `evidence_ref`, `validated_at` and a route-specific approved use.

For generative scene continuation with people, `likeness_consent_status=CONFIRMED` plus `people_consent_confirmed=TRUE` in the explicit exception are mandatory.

The registry schema can additionally carry rights record ID, evidence type/Drive ID/SHA, validity metadata, territories, channels, paid-media allowance, generative-derivation allowance, review due date and validation version. These fields improve evidence quality but do not weaken the minimum runtime gate.

`VIDEO_RIGHTS_QUEUE` is an operational materialized blocker queue. A row in that queue must not be interpreted as release-ready.

## Generation pipeline

`CONTENT_ITEMS` → canonical parent policy gate → product/operation/output resolution → standard → source library/coverage → real source/master → rights/likeness → exact Drive download/hash → route/provider plan → deterministic official hero-brand overlay → durable candidate artifact → `GENERATED_REVIEW_REQUIRED`.

Provider output is never publishable by generation alone.

## Durable candidate boundary

`GcsPhotoToVideoArtifactStore` persists and re-reads exact bytes before candidate state is written. The manifest binds:

- source and output SHA-256;
- `artifactRef` / `artifactObjectName`;
- route/standard/product/operation;
- provider/job/model;
- provider attempt chain/fallback flag when applicable;
- official hero brand asset ID, Drive ID and SHA;
- The Party edition/intent/environment when applicable;
- `publicationEligible=false`.

## Review/finalization

Review evidence binds to the exact candidate SHA and must include durable evidence, source comparison, no architecture/environment/logo drift and PASS for Venue Fidelity, Brand Integrity, Quality and Scene Continuation Fidelity when applicable.

`ControlledPhotoToVideoFinalizationService` re-runs policy/context/source/brand/approval/artifact validation. It does not trust caller-supplied final video bytes.

Successful finalization records `VIDEO_CREATIVE_TRUTH_PASSED`, exact asset SHA/ref and `publicationAuthorized=false`.

## Publication boundary

PREPARE/PUBLISH consume the exact finalized asset. They may not regenerate or rebuild the creative. Generation/finalization do not grant publication authority.

## Architecture/tests

`pnpm architecture:check` runs both `check-photo-to-video-contract.mjs` and `check-video-provider-failover-contract.mjs`. Tests pin the canonical parent policy gate, provider adapters, failover semantics, source/approval/hash binding, durable artifact readback, branding, The Party context, review chronology and publication fail-closed behavior.

## Fail-closed principle

No error automatically degrades from source-anchored video to full-synthetic venue generation. No fallback provider may bypass a canonical hard gate. If eligible providers are exhausted, the operation remains blocked/retryable at the provider layer with the same source and governance context intact.
