# Video Generative MCP Surface V1

## Purpose

Expose the already-governed TOCA photo-to-video runtime through the MCP server without weakening the canonical `TOCA_PHOTO_TO_VIDEO_POLICY_V1` boundary.

The surface adds four tools:

- `video.generate_scene_continuation`
- `video.finalize_scene_continuation`
- `video.postprocess.overlay_static_graphics`
- `video.postprocess.trim`

The generation tool is **not** a bypass around the existing route. It always invokes `ControlledPhotoToVideoGenerationService` with `GENERATIVE_SCENE_CONTINUATION_VIDEO`, so canonical parent policy, product policy, video standard, exact source binding, `VIDEO_SOURCE_RIGHTS`, likeness consent, `VIDEO_GENERATIVE_EXCEPTIONS`, official hero-brand binding, GCS durable artifact persistence and candidate writeback remain mandatory.

## Runtime configuration

The lazy MCP runtime supports two Google authentication modes.

### Short-lived access-token mode

- `GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY` and the referenced token value;
- optional `GOOGLE_DRIVE_ACCESS_TOKEN_ENV_KEY` (falls back to the Sheets token key).

### Renewable OAuth mode

Preferred for long-running Cloud Run runtimes. It reuses the AG-01 renewable OAuth contract when available:

- `VIDEO_GOOGLE_OAUTH_CLIENT_ID_ENV_KEY` or `AG01_GOOGLE_OAUTH_CLIENT_ID_ENV_KEY`;
- `VIDEO_GOOGLE_OAUTH_CLIENT_SECRET_ENV_KEY` or `AG01_GOOGLE_OAUTH_CLIENT_SECRET_ENV_KEY`;
- `VIDEO_GOOGLE_OAUTH_REFRESH_TOKEN_ENV_KEY` or `AG01_GOOGLE_OAUTH_REFRESH_TOKEN_ENV_KEY`;
- optional `VIDEO_GOOGLE_OAUTH_TOKEN_ENDPOINT` or `AG01_GOOGLE_OAUTH_TOKEN_ENDPOINT`.

The referenced OAuth credentials are resolved from environment-backed secret references, exchanged for short-lived Google access tokens and cached only in memory by `GoogleOAuthRefreshSecretResolver`. The refresh token must have sufficient read/write access for the canonical TOCA_OS Sheets used by the photo-to-video registry and read access to the exact Drive source/brand files. Insufficient provider scope fails closed at provider access time.

OpenAI credentials are resolved in this order:

1. `OPENAI_API_KEY_ENV_KEY`;
2. `AG01_OPENAI_API_KEY_ENV_KEY`;
3. `AG01_MODEL_API_KEY_ENV_KEY` only when `AG01_MODEL_PROVIDER=openai`;
4. direct `OPENAI_API_KEY`.

Additional required configuration:

- `GCP_PROJECT_ID`;
- `INSTAGRAM_PUBLICATION_ASSET_BUCKET`;
- optional `OPENAI_VIDEO_MODEL=sora-2|sora-2-pro`.

The runtime is constructed lazily on first tool invocation. Missing or incomplete credentials do not prevent MCP server startup; invocation fails closed with `VIDEO_GENERATIVE_RUNTIME_NOT_CONFIGURED` or the relevant provider/auth error.

## Generation

`video.generate_scene_continuation` accepts:

- `contentItemId`;
- `creativeDirection`;
- optional `returnBase64`.

The tool does not allow the caller to choose a different route or disable policy gates. The exact canonical content binding determines product, operation, output type, source asset, standard, duration and size.

The tool returns the immutable candidate manifest, exact output SHA-256, durable `artifactRef`, provider/job identity and optionally the exact generated branded MP4 as base64. `publicationEligible` is always false at generation time.

## Finalization

`video.finalize_scene_continuation` accepts the exact candidate manifest plus `photoToVideoReviewEvidenceSchema` evidence. The existing finalization service revalidates policy, canonical context, The Party context, source bytes/hash, official hero-brand bytes/hash, generative approval and durable artifact bytes before writing `VIDEO_CREATIVE_TRUTH_PASSED` evidence.

Publication authority remains false.

## Poster-safe generative workflow

Dense promotional posters should not rely on a generative model to redraw typography, information panels or sponsor logos.

Recommended flow:

1. bind the approved source scene to a governed CONTENT_ITEM;
2. generate the scene continuation with `video.generate_scene_continuation`;
3. use a transparent PNG containing the original static graphic layer;
4. call `video.postprocess.overlay_static_graphics` to deterministically restore exact typography/logos over the generated scene;
5. if a 5-second deliverable is required while the canonical generation standard is 8 seconds, call `video.postprocess.trim` to create a 5.0-second derivative;
6. review source vs generated output and only then call finalization for the canonical candidate.

The local post-processing tools do not change the canonical candidate or grant publication authority. They return derived MP4 bytes and SHA-256 for approval/editing workflows.

## 5-second The Party motion use case

Current canonical The Party scene-continuation standards are 8 seconds. The runtime intentionally does not mutate that standard for a one-off 5-second request. Generate the canonical 8-second candidate, then create a deterministic 5-second approval derivative.

## Container runtime

The primary MCP container installs `ffmpeg`, which is required by the deterministic overlay and trim capabilities. The OpenAI provider remains network-based and continues to use the existing `/v1/videos` adapter.

## Capability lifecycle

The four MCP capabilities are registered as `IMPLEMENTED`, not `PRODUCTION_VALIDATED`. Production validation still requires provider credentials/access, a real approved source and exception row, successful OpenAI Video API job completion, exact candidate artifact readback, human review/finalization and downstream exact-asset smoke evidence on the release SHA.
