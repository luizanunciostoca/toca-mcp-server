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

`VIDEO_SOURCE_RIGHTS` is mandatory for both routes. Rights are never inferred from Drive location, filename, prior publication or MARKETING_READY status. Accepted rights states are `OWNED`, `LICENSED`, `CLEARED` and `RIGHTS_CLEARED`.

For generative scene continuation when people are present, `likeness_consent_status=CONFIRMED` plus `people_consent_confirmed=TRUE` in the explicit exception is mandatory. Otherwise generation fails closed before the provider call.

## Generation pipeline

`CONTENT_ITEMS` → product/operation/output resolution → product policy → video standard → real venue master → rights/likeness → exact Drive download/hash → route execution → deterministic official hero-brand overlay → `GENERATED_REVIEW_REQUIRED`.

Route 1 provider: `LOCAL_FFMPEG`.  
Route 2 provider: `OPENAI_VIDEO_API`.

Provider output is never publishable by generation alone.

## Review/finalization

The exact generated branded MP4 is reviewed. Review evidence must bind to the exact output SHA-256 and include:

- Venue Fidelity PASS;
- Brand Integrity PASS;
- Quality PASS;
- Scene Continuation Fidelity PASS for Route 2;
- `NOT_APPLICABLE` for Scene Continuation Fidelity on Route 1.

`ControlledPhotoToVideoFinalizationService` re-resolves the canonical content/product/standard/source/rights/approval state immediately before finalization. Context drift, source hash drift, standard drift or approval drift fail closed.

Successful finalization writes an idempotent `VIDEO_OUTPUTS` evidence row and returns `VIDEO_CREATIVE_TRUTH_PASSED`, `exactAssetBinding=true`, `readyForPrepare=true`, `publicationAuthorized=false`.

## Publication boundary

PREPARE/PUBLISH must consume the exact MP4 whose SHA-256 was finalized. They may not regenerate, re-render or recompute the creative. Existing GCS exact-byte staging/delivery and Instagram Creative Truth binding remain the downstream boundary.

## Provider governance

OpenAI video generation is implemented as an internal runtime path but must not be promoted to `PRODUCTION_VALIDATED` until provider credentials/access, exact-source upload, provider job completion, output download, review/finalization and exact downstream asset smoke are evidenced on the exact release SHA.

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
- `PHOTO_TO_VIDEO_FINAL_ASSET_HASH_MISMATCH`
- `PHOTO_TO_VIDEO_REVIEW_ASSET_BINDING_MISMATCH`
- `SCENE_CONTINUATION_FIDELITY_REVIEW_REQUIRED`
- `PHOTO_TO_VIDEO_CANONICAL_CONTEXT_CHANGED`

No error automatically falls back from Route 2 to unrestricted generation or from either route to a different product/operation.
