# Marketing Autopilot source-image binding

Status: implementation candidate. This bridge exists to prevent the TOCA Marketing Autopilot from treating a prompt-only image generation as if it were an edit of the selected Drive photograph.

## Boundary

The bridge accepts bytes that were already resolved from the canonical Drive asset, sends those exact bytes as the multipart `image` field to the OpenAI Image Edit endpoint, and returns edited JPEG bytes plus SHA-256 evidence for source and output. It does not publish, schedule, approve, or mutate Instagram state.

The source is considered technically bound only when all of these are true:

- `sourceAssetId` and `sourceDriveFileId` are present;
- source bytes are non-empty and use an allowed image MIME type;
- the request is sent to `/v1/images/edits` with an actual multipart `image` part;
- `input_fidelity=high`;
- an edited image payload is returned successfully.

This proves transport/binding, not visual fidelity. The TOCA OS Fidelity Gate and Brand/Quality Gate must still compare source and output before the asset can advance to REVIEW or APPROVED.

## Canonical treatment

The provider embeds the TOCA canonical treatment prompt verbatim. The execution requests `quality=high`, `size=auto`, `output_format=jpeg` and maximum JPEG compression quality. References to 8K or ProRes in the creative prompt remain intent only; the runtime must never claim those technical properties unless the produced file actually has them.

## Execution

The CLI is `src/marketing-autopilot-image-edit.ts`. It requires source path, output path, source asset ID, source Drive file ID and source MIME type. The OpenAI API key is resolved indirectly from the environment variable named by `OPENAI_API_KEY_ENV_KEY`; no key may be committed to the repository.

Example shape:

```text
pnpm dev:marketing-autopilot-image-edit -- \
  --source .autopilot/source.jpg \
  --output .autopilot/treated.jpg \
  --source-asset-id SUN-0087 \
  --source-drive-file-id <drive-file-id> \
  --content-type image/jpeg
```

The CLI prints machine-readable evidence including source/output SHA-256, `sourceImageBound=true`, `editMode=EDIT_EXISTING_IMAGE`, provider, requested fidelity/quality and output byte size.

## Fail-closed behavior

`SOURCE_IMAGE_FETCH_BLOCK`, `SOURCE_IMAGE_BINDING_FAILURE`, `NATIVE_IMAGE_EDIT_BINDING_FAILED`, `GENERATION_CONTEXT_DRIFT`, `FIDELITY_GATE_FAILED`, `OUTPUT_TECH_SPEC_MISMATCH`, and `QUALITY_GATE_FAILED` are reserved treatment errors. A missing source, malformed response, or provider failure must never be converted into a generated replacement image. No PREPARE or PUBLISH command is eligible until the treated asset passes the canonical gates and is written back to TOCA OS.
