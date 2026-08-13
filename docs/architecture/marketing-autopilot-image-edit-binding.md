# Marketing Autopilot source-image enhancement

Status: local-first implementation candidate. This pipeline exists to prevent the TOCA Marketing Autopilot from treating prompt-only generation as if it were an enhancement of the selected Drive photograph, while keeping the standard production path independent from Adobe and paid image-generation APIs.

## Canonical hierarchy

The standard path is deterministic and local:

`Drive source bytes -> LocalPhotoEnhancer -> Fidelity/Quality Gate -> persisted creative`

The OpenAI Image Edit provider remains available only as an explicit optional escalation with `--provider openai`. It is not an automatic fallback, is not required for standard treatment, and must not block the local path because of missing credentials, billing, quota, or provider availability.

## Source binding

The source is considered technically bound only when:

- `sourceAssetId` and `sourceDriveFileId` are present;
- the exact canonical Drive bytes were downloaded successfully;
- source bytes are non-empty and use an allowed image MIME type;
- the enhancer processes those bytes as the input image rather than creating a replacement scene;
- the output is a valid, non-empty image with independent SHA-256 evidence.

Local evidence uses `sourceImageBound=true`, `editMode=ENHANCE_EXISTING_IMAGE`, and `editorProvider=LOCAL_IMAGEMAGICK`.

This proves transport and transformation lineage, not visual approval. The TOCA OS Fidelity Gate and Brand/Quality Gate must still inspect source versus output before the asset can advance to REVIEW or APPROVED.

## Deterministic local treatment

`LocalPhotoEnhancer` currently performs a conservative source-faithful pipeline with ImageMagick:

- auto orientation;
- sRGB normalization;
- Lanczos upscale to 200% of the original width and height;
- conservative unsharp sharpening;
- JPEG output at quality 95.

It does not crop, recompose, replace people or objects, invent micro-details, reconstruct the scene, add text, or perform generative synthesis. The natural-language TOCA treatment prompt remains the creative quality target and policy boundary; the local pipeline implements only the deterministic enhancement operations that are compatible with strict source preservation.

Statements such as “8K” or “ProRes” in the creative prompt are quality intent only. The runtime must never record those as technical file properties unless the produced file actually has them.

## Optional OpenAI escalation

The explicit OpenAI route remains available for cases where a future policy authorizes semantic image editing and the local output is insufficient. It is invoked only with `--provider openai`, requires `OPENAI_API_KEY_ENV_KEY`, and sends the real image bytes to the image-edit endpoint. There is no automatic provider switch from local to OpenAI.

## Execution

The CLI is `src/marketing-autopilot-image-edit.ts`. It requires source path, output path, source asset ID, source Drive file ID and source MIME type. Provider defaults to `local`.

```text
pnpm dev:marketing-autopilot-image-edit -- \
  --source .autopilot/source.jpg \
  --output .autopilot/treated.jpg \
  --source-asset-id SUN-0087 \
  --source-drive-file-id <drive-file-id> \
  --content-type image/jpeg \
  --provider local
```

The local CLI prints machine-readable evidence including source/output SHA-256, `sourceImageBound=true`, `editMode=ENHANCE_EXISTING_IMAGE`, pipeline version, requested scale and output byte size.

## Runtime dependency

The production container includes ImageMagick. Missing local image runtime is classified as `CAPABILITY_UNAVAILABLE` and fails closed rather than switching to a generative provider.

## Fail-closed behavior

`SOURCE_IMAGE_FETCH_BLOCK`, `SOURCE_IMAGE_BINDING_FAILURE`, `NATIVE_IMAGE_EDIT_BINDING_FAILED`, `GENERATION_CONTEXT_DRIFT`, `FIDELITY_GATE_FAILED`, `OUTPUT_TECH_SPEC_MISMATCH`, and `QUALITY_GATE_FAILED` remain reserved treatment errors. A missing source, malformed output or provider failure must never be converted into a generated replacement image. No PREPARE or PUBLISH command is eligible until the treated asset passes the canonical gates and is written back to TOCA OS.
