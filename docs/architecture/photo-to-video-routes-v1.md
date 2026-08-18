# Photo-to-Video Routes V1

Parent policy: `TOCA_CREATIVE_TRUTH_POLICY_V1`  
Video policy: `TOCA_PHOTO_TO_VIDEO_POLICY_V1`

## Routes

### `REAL_PHOTO_TO_MOTION_VIDEO`

Safe default for Stories/Reels from an approved real photograph. The exact MARKETING_READY master is downloaded from Drive and SHA-256 verified. `LocalPhotoMotionVideoComposer` creates deterministic camera motion with FFmpeg. No semantic generation, scene expansion, architectural invention or synthetic venue continuation is permitted.

### `GENERATIVE_SCENE_CONTINUATION_VIDEO`

Controlled image-to-video continuation from an approved real photograph. The exact MARKETING_READY master is bound to an explicit `VIDEO_GENERATIVE_EXCEPTIONS` approval and sent as `input_reference` to the OpenAI Video API. The provider adapter supports `sora-2` and `sora-2-pro`, polls the provider job to completion and downloads the exact MP4 result.

This route is not full synthetic venue video. Full synthetic venue video without a canonical source photograph remains unsupported. The source image is always the factual anchor.

## Product model

The runtime is registry-driven. `PRODUCT_VISUAL_POLICIES` and `VIDEO_CREATIVE_STANDARDS` define product/operation rules. Sunset and The Party are seeded initially; future products are onboarded by canonical registry rows and a content visual standard, without hardcoding a new runtime branch.

The Party keeps its existing edition/environment/visual-family authority. `GoogleSheetsThePartyContentOrchestration` is re-read before generation/finalization. Hybrid Networks remains blocked without canonical environment resolution.

## Rights and likeness

`VIDEO_SOURCE_RIGHTS` is mandatory for both routes. Rights are never inferred from Drive location, filename, prior publication or MARKETING_READY status. Accepted rights states are `OWNED`, `LICENSED`, `CLEARED` and `RIGHTS_CLEARED`, and an ACTIVE rights record must include durable `evidence_ref` plus `validated_at`.

For generative scene continuation when people are present, `likeness_consent_status=CONFIRMED` plus `people_consent_confirmed=TRUE` in the explicit exception is mandatory. Otherwise generation fails closed before the provider call.

## Generation pipeline

`CONTENT_ITEMS` → product/operation/output resolution → product policy → video standard → real venue master → rights/likeness → exact Drive download/hash → route execution → deterministic official hero-brand overlay → durable exact candidate artifact → `GENERATED_REVIEW_REQUIRED`.

Route 1 provider: `LOCAL_FFMPEG`.  
Route 2 provider: `OPENAI_VIDEO_API`.

Provider output is never publishable by generation alone.

### Durable candidate artifact boundary

The branded candidate MP4 must be persisted before review state is written. `GcsPhotoToVideoArtifactStore` stages the exact bytes into the existing governed GCS publication-asset bucket, immediately performs full-byte readback, and rejects any SHA-256 divergence.

The immutable candidate manifest stores:

- `outputSha256`;
- `artifactRef` (`gcs://...`);
- `artifactObjectName`;
- source/master SHA-256;
- provider identity/job when applicable;
- route, standard, operation and product identity;
- `publicationEligible=false`.

`CONTENT_ITEMS` persists the same identity in `video_candidate_sha256` and `video_candidate_artifact_ref`. If durable artifact persistence fails, the runtime must not write `GENERATED_REVIEW_REQUIRED`.

## Review/finalization

The exact durable generated branded MP4 is reviewed. Review evidence must bind to the exact output SHA-256 and include:

- durable `evidenceRef`;
- `reviewMethod=HUMAN|MULTIMODAL_PLUS_HUMAN`;
- `sourceImageCompared=true`;
- `architectureDriftDetected=false`;
- `environmentDriftDetected=false`;
- `aiLogoReconstructionDetected=false`;
- Venue Fidelity PASS;
- Brand Integrity PASS;
- Quality PASS;
- Scene Continuation Fidelity PASS for Route 2;
- `NOT_APPLICABLE` for Scene Continuation Fidelity on Route 1.

`ControlledPhotoToVideoFinalizationService` does not trust caller-supplied video bytes. It loads the candidate from `artifactRef` through `PhotoToVideoArtifactStore.loadExact`, re-hashes the complete MP4, then re-resolves the canonical content/product/standard/source/rights/approval state immediately before finalization. Context drift, source hash drift, standard drift, artifact drift or approval drift fail closed.

Successful finalization writes an idempotent `VIDEO_OUTPUTS` evidence row and writes back `video_final_asset_sha256`, `video_final_artifact_ref`, `video_review_status=VIDEO_CREATIVE_TRUTH_PASSED` and `video_output_evidence_id` to `CONTENT_ITEMS`. The final manifest returns `VIDEO_CREATIVE_TRUTH_PASSED`, `exactAssetBinding=true`, `readyForPrepare=true`, `publicationAuthorized=false`.

The candidate and final artifact ref are intentionally identical in V1 because finalization does not re-render the video. It validates the exact reviewed bytes and their current canonical context.

## Canonical Sheets fields

`CONTENT_ITEMS` machine-actionable video fields:

- `video_product_id`
- `video_route_type`
- `video_standard_id`
- `video_candidate_sha256`
- `video_provider_job_id`
- `video_final_asset_sha256`
- `video_review_status`
- `video_output_evidence_id`
- `video_candidate_artifact_ref`
- `video_final_artifact_ref`

Creative Truth registry tabs used by this contract:

- `PRODUCT_VISUAL_POLICIES`
- `VIDEO_CREATIVE_STANDARDS`
- `VIDEO_SOURCE_RIGHTS`
- `VIDEO_GENERATIVE_EXCEPTIONS`
- `VIDEO_OUTPUTS`

## Publication boundary

PREPARE/PUBLISH must consume the exact durable MP4 whose SHA-256 was finalized. They may not regenerate, re-render or recompute the creative. Existing GCS exact-byte staging/delivery and Instagram Creative Truth binding remain the downstream boundary.

Generation and finalization both return publication authority as false. Publication remains a separate governed side effect.

## Provider governance

The OpenAI video contract used by the adapter is the official `/v1/videos` job API: multipart create with optional `input_reference`, `seconds`, `size` and supported `sora-2` / `sora-2-pro`, followed by job retrieval and `/content` download.

OpenAI video generation is implemented as an internal runtime path but must not be promoted to `PRODUCTION_VALIDATED` until provider credentials/access, exact-source upload, provider job completion, output download, durable artifact readback, review/finalization and exact downstream asset smoke are evidenced on the exact release SHA.

The canonical Drive registry currently keeps video source rights blocked/unverified and has no approved `VIDEO_GENERATIVE_EXCEPTIONS` rows. This intentionally prevents real provider execution until explicit rights/likeness and approval evidence exists; the runtime must not invent or auto-promote those business facts.

## Architecture/tests

`pnpm architecture:check` includes `scripts/check-photo-to-video-contract.mjs`, which pins the governed route files, durable artifact store, canonical writeback, provider boundary and negative tests.

Tests cover at least:

- durable artifact persistence before review-state writeback;
- no writeback when artifact persistence fails;
- exact artifact readback before finalization;
- candidate/final artifact binding in `CONTENT_ITEMS`;
- required source-to-output review evidence;
- explicit approval/source SHA binding before OpenAI provider access;
- deterministic real-photo motion path.

## Fail-closed errors

Representative errors include:

- `PHOTO_TO_VIDEO_MARKETING_READY_SOURCE_REQUIRED`
- `VIDEO_SOURCE_RIGHTS_NOT_CLEARED`
- `VIDEO_SOURCE_USE_NOT_APPROVED`
- `VIDEO_LIKENESS_CONSENT_REQUIRED`
- `VIDEO_SCENE_CONTINUATION_APPROVAL_REQUIRED`
- `VIDEO_SCENE_CONTINUATION_APPROVAL_BINDING_MISMATCH`
- `VIDEO_SCENE_CONTINUATION_APPROVAL_EXPIRED`
- `PHOTO_TO_VIDEO_THE_PARTY_STANDARD_MISMATCH`
- `PHOTO_TO_VIDEO_ARTIFACT_INPUT_HASH_MISMATCH`
- `PHOTO_TO_VIDEO_ARTIFACT_STAGE_HASH_MISMATCH`
- `PHOTO_TO_VIDEO_ARTIFACT_READBACK_HASH_MISMATCH`
- `PHOTO_TO_VIDEO_FINAL_ASSET_HASH_MISMATCH`
- `PHOTO_TO_VIDEO_REVIEW_ASSET_BINDING_MISMATCH`
- `SCENE_CONTINUATION_FIDELITY_REVIEW_REQUIRED`
- `PHOTO_TO_VIDEO_CANONICAL_CONTEXT_CHANGED`

No error automatically falls back from Route 2 to unrestricted generation or from either route to a different product/operation.
