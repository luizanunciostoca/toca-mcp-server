# Photo-to-Video Routes V1

Parent policy: `TOCA_CREATIVE_TRUTH_POLICY_V1`  
Video policy: `TOCA_PHOTO_TO_VIDEO_POLICY_V1`

## Canonical parent policy gate

The repository child policy is not sufficient authority by itself. `GoogleSheetsPhotoToVideoParentPolicyGuard` re-reads the canonical Creative Truth `POLICY!A1:AC20` range from Google Drive/Sheets before both generation and finalization.

The guard requires exactly one `TOCA_CREATIVE_TRUTH_POLICY_V1` row with `status=ACTIVE_CANONICAL` and verifies the parent/child binding plus the safety invariants used by this runtime:

- `brand_scope=TOCA_DO_MORCEGO`;
- official logos only;
- Venue Fidelity, Brand Integrity and Quality gates enabled;
- `fail_closed=TRUE`;
- `photo_to_video_policy_id=TOCA_PHOTO_TO_VIDEO_POLICY_V1`;
- `full_synthetic_venue_video=UNSUPPORTED_V1`;
- `video_photo_motion=ACTIVE_V1` for `REAL_PHOTO_TO_MOTION_VIDEO`;
- `video_generative_exception=SOURCE_ANCHORED_SCENE_CONTINUATION_GOVERNED_V1` for `GENERATIVE_SCENE_CONTINUATION_VIDEO`.

Missing or ambiguous policy rows, schema drift, parent/child policy drift or route disablement fail closed before provider work.

## Routes

### `REAL_PHOTO_TO_MOTION_VIDEO`

Safe default for Stories/Reels from an approved real photograph. The exact MARKETING_READY master is downloaded from Drive and SHA-256 verified. `LocalPhotoMotionVideoComposer` creates deterministic camera motion with FFmpeg. No semantic generation, scene expansion, architectural invention or synthetic venue continuation is permitted.

### `GENERATIVE_SCENE_CONTINUATION_VIDEO`

Controlled image-to-video continuation from an approved real photograph. The exact MARKETING_READY master is bound to an explicit `VIDEO_GENERATIVE_EXCEPTIONS` approval, downloaded from Drive and SHA-256 verified before provider access.

The canonical V1 production provider is `GOOGLE_VERTEX_VEO`, using `veo-3.1-generate-001` in `us-central1`. The approved source bytes are supplied as the image anchor to Vertex AI `predictLongRunning`; the runtime polls `fetchPredictOperation`, accepts only output in the governed GCS bucket, downloads the exact MP4, hashes it and then applies the official brand deterministically.

The alternative `veo-3.1-fast-generate-001` is allowed by the repository policy but is not the provider-smoke model. The legacy OpenAI/Sora adapter remains in the codebase only as an explicit compatibility path; it is not the canonical production provider for this route.

This route is not full synthetic venue video. Full synthetic venue video without a canonical source photograph remains unsupported. The source image is always the factual anchor.

## Runtime identity

Production scene continuation uses `VIDEO_GOOGLE_AUTH_MODE=GCP_SERVICE_IDENTITY` and `VIDEO_SCENE_CONTINUATION_PROVIDER=GOOGLE_VERTEX_VEO`.

Two short-lived token paths are deliberately separated:

1. Vertex AI and GCS use the attached Cloud Run service identity through the Compute metadata token endpoint (`cloud-platform`). No provider API key is stored.
2. Drive and Sheets use `GoogleServiceIdentityOAuthResolver`. It obtains the attached service-account identity and a short-lived metadata token, asks IAM Credentials `signBlob` to sign a JWT assertion, then exchanges that assertion at the Google OAuth token endpoint for short-lived Workspace OAuth scopes (`drive.readonly` and `spreadsheets`). No service-account private key, client secret or refresh token is stored.

This reuses the existing production service identity and the same signing capability already required by governed GCS signed delivery URLs. Failure to obtain either class of token fails closed; the runtime does not fall back to guessed credentials.

## Product model

The runtime is registry-driven. `PRODUCT_VISUAL_POLICIES` and `VIDEO_CREATIVE_STANDARDS` define product/operation rules. Sunset and The Party are seeded initially; future products are onboarded by canonical registry rows and a content visual standard, without hardcoding a new product runtime branch.

The Party keeps its existing edition/environment/visual-family authority. `GoogleSheetsThePartyContentOrchestration` is re-read before generation/finalization. Hybrid Networks remains blocked without canonical environment resolution.

For The Party, the candidate itself binds `edition_id`, creative intent and canonical environment when applicable. Finalization compares those values against a fresh orchestration read, so a later edition/intent/environment change cannot silently approve bytes generated for another context.

## Rights and likeness

`VIDEO_SOURCE_RIGHTS` is mandatory for both routes. Rights are never inferred from Drive location, filename, prior publication or MARKETING_READY status. Accepted rights states are `OWNED`, `LICENSED`, `CLEARED` and `RIGHTS_CLEARED`, and an ACTIVE rights record must include durable `evidence_ref` plus `validated_at`.

For generative scene continuation when people are present, `likeness_consent_status=CONFIRMED` plus `people_consent_confirmed=TRUE` in the explicit exception is mandatory. Otherwise generation fails closed before the provider call.

## Trusted clock boundary

Generation validates its trusted clock before canonical/provider work. Each scene-continuation provider independently validates its own trusted clock before token/provider access. Finalization uses one trusted finalization timestamp and requires `candidate.createdAt <= review.reviewedAt <= finalizedAt`. Caller-supplied `now` values are not accepted by the production CLIs.

## Generation pipeline

`CONTENT_ITEMS` → canonical parent policy gate → product/operation/output resolution → product policy → video standard → real venue master → rights/likeness → exact Drive download/hash → route execution → deterministic official hero-brand overlay → durable exact candidate artifact → `GENERATED_REVIEW_REQUIRED`.

Route 1 provider: `LOCAL_FFMPEG`.  
Route 2 canonical provider: `GOOGLE_VERTEX_VEO`.

Provider output is never publishable by generation alone.

### Durable candidate artifact boundary

The branded candidate MP4 must be persisted before review state is written. `GcsPhotoToVideoArtifactStore` stages the exact bytes into the existing governed GCS publication-asset bucket, immediately performs full-byte readback, and rejects any SHA-256 divergence.

The immutable candidate manifest stores:

- `outputSha256`;
- `artifactRef` (`gcs://...`) and matching `artifactObjectName`;
- source/master SHA-256 and Drive identity;
- provider identity/job/model when applicable;
- route, standard, operation and product identity;
- official hero brand asset ID, Drive file ID and SHA-256;
- The Party edition/intent/environment binding when applicable;
- `publicationEligible=false`.

The schema rejects disagreement between `artifactRef` and `artifactObjectName`. `CONTENT_ITEMS` persists the same candidate identity in `video_candidate_sha256` and `video_candidate_artifact_ref`. If durable artifact persistence fails, the runtime must not write `GENERATED_REVIEW_REQUIRED`.

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

`ControlledPhotoToVideoFinalizationService` does not trust caller-supplied video bytes. Before accepting the output, it validates review chronology, re-runs the canonical parent policy gate, re-resolves content/product/standard/source/rights/approval and The Party context, downloads and re-hashes the canonical source and official hero brand, and loads the exact candidate from the durable `artifactRef`.

Policy drift, context drift, source bytes/hash drift, hero-brand drift, The Party context drift, standard drift, artifact drift, review chronology drift or approval drift fail closed.

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

- `POLICY`
- `PRODUCT_VISUAL_POLICIES`
- `VIDEO_CREATIVE_STANDARDS`
- `VIDEO_SOURCE_RIGHTS`
- `VIDEO_GENERATIVE_EXCEPTIONS`
- `VIDEO_OUTPUTS`

## Publication boundary

PREPARE/PUBLISH must consume the exact durable MP4 whose SHA-256 was finalized. They may not regenerate, re-render or recompute the creative. Existing GCS exact-byte staging/delivery and Instagram Creative Truth binding remain the downstream boundary.

Generation and finalization both return publication authority as false. Publication remains a separate governed side effect.

## Provider governance

The Vertex Veo adapter is source-anchored and approval-bound. It may not invent venue architecture, reconstruct logos or typography, or silently replace the approved source. It requests portrait 9:16, exact canonical 8-second duration and 720p for the current The Party standard. Any unsupported canonical size/duration fails closed rather than silently changing the creative contract.

The OpenAI video adapter remains available for explicit noncanonical compatibility tests and environments with separately configured credentials. Provider selection is explicit; there is no automatic cross-provider fallback.

A real provider smoke is necessary but not sufficient for `PRODUCTION_VALIDATED`. Provider completion, exact MP4 SHA readback, source-vs-output human QA and canonical finalization are separate gates.

## Architecture/tests

`pnpm architecture:check` includes `scripts/check-photo-to-video-contract.mjs`, which pins the canonical parent policy guard, governed route files, service-identity authentication, Vertex Veo adapter, durable artifact store, canonical writeback, trusted-clock, source/brand revalidation, The Party binding and negative tests.

Tests cover at least canonical policy drift/disablement, exact source/approval/hash binding, service-identity token minting without private keys, Veo request/poll/GCS output, durable artifact full-SHA readback, deterministic branding, The Party context drift, review chronology, and publication fail-closed behavior.

## Fail-closed errors

Representative errors include:

- `PHOTO_TO_VIDEO_PARENT_POLICY_NOT_RESOLVED`
- `PHOTO_TO_VIDEO_PARENT_POLICY_SCHEMA_INVALID`
- `PHOTO_TO_VIDEO_PARENT_POLICY_DRIFT`
- `PHOTO_TO_VIDEO_PARENT_POLICY_ROUTE_DISABLED`
- `PHOTO_TO_VIDEO_MARKETING_READY_SOURCE_REQUIRED`
- `VIDEO_SOURCE_RIGHTS_NOT_CLEARED`
- `VIDEO_SOURCE_USE_NOT_APPROVED`
- `VIDEO_LIKENESS_CONSENT_REQUIRED`
- `VIDEO_SCENE_CONTINUATION_APPROVAL_REQUIRED`
- `VIDEO_SCENE_CONTINUATION_APPROVAL_BINDING_MISMATCH`
- `VIDEO_SCENE_CONTINUATION_APPROVAL_EXPIRED`
- `PHOTO_TO_VIDEO_THE_PARTY_STANDARD_MISMATCH`
- `PHOTO_TO_VIDEO_THE_PARTY_CONTEXT_CHANGED`
- `PHOTO_TO_VIDEO_HERO_BRAND_CONTEXT_CHANGED`
- `PHOTO_TO_VIDEO_REVIEW_TIME_INVALID`
- `PHOTO_TO_VIDEO_ARTIFACT_REF_OBJECT_MISMATCH`
- `PHOTO_TO_VIDEO_ARTIFACT_INPUT_HASH_MISMATCH`
- `PHOTO_TO_VIDEO_ARTIFACT_STAGE_HASH_MISMATCH`
- `PHOTO_TO_VIDEO_ARTIFACT_READBACK_HASH_MISMATCH`
- `PHOTO_TO_VIDEO_ARTIFACT_REF_BUCKET_MISMATCH`
- `PHOTO_TO_VIDEO_FINAL_ASSET_HASH_MISMATCH`
- `PHOTO_TO_VIDEO_REVIEW_ASSET_BINDING_MISMATCH`
- `SCENE_CONTINUATION_FIDELITY_REVIEW_REQUIRED`
- `PHOTO_TO_VIDEO_CANONICAL_CONTEXT_CHANGED`
- `VERTEX_VEO_TRUSTED_CLOCK_INVALID`
- `VERTEX_VEO_SIZE_UNSUPPORTED`
- `GCP_SERVICE_IDENTITY_SIGN_BLOB_FAILED`
- `GCP_SERVICE_IDENTITY_OAUTH_EXCHANGE_FAILED`

No error automatically falls back from Route 2 to unrestricted generation or from either route to a different product, operation or provider.
