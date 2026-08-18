# Controlled static image generation — Creative Truth V1

Status: implementation candidate on PR #197. This document describes the executable `GENERATIVE_EXCEPTION` boundary for full **static-image** creation. It does not enable full synthetic video.

## Purpose

The normal TOCA creative path remains `REAL_COMPOSITE` / `REAL_PLUS_ENHANCEMENT`. Full static generation exists only for an explicitly approved exception and must preserve venue/brand truth.

The executable path is:

`content_item + prompt -> canonical approval -> canonical reference set -> authenticated Drive byte download -> canonical source SHA verification -> OpenAI image generation -> candidate SHA -> post-generation review -> Venue Fidelity -> deterministic composition -> Brand Integrity -> Quality -> approval/publication`

Generation stops at the candidate boundary. The generator never returns publication eligibility.

## Runtime components

- `ControlledStaticImageGenerationService`: orchestration and fail-closed approval/reference resolution.
- `GoogleSheetsCreativeTruthRegistry`: canonical `GENERATIVE_EXCEPTIONS`, `VENUE_REFERENCE_SET`, `VENUE_VISUALS` and `POLICY` reads.
- `GoogleDriveCreativeTruthReferenceLoader`: authenticated metadata + byte download from the exact canonical Drive file IDs.
- `CreativeTruthOpenAiImageGenerator`: OpenAI Responses image-generation call after canonical revalidation and byte/hash binding.
- `marketing-autopilot-image-generate.ts`: operator CLI that writes a candidate JPEG and a non-publishable evidence manifest.

## Approval boundary

For the exact `contentItemId`, the registry must resolve exactly one `APPROVED` row. Zero or multiple approved rows fail closed. The canonical approval must:

- use `TOCA_VENUE_REFERENCE_SET_V1`;
- require at least 3 references;
- set `allowArchitecturalInvention=false`;
- set `allowEnvironmentDrift=false`;
- set `allowAiLogoGeneration=false`;
- be unexpired when an expiry exists.

The low-level generator independently re-reads the canonical approval and requires exact identity against the supplied approval object. This deliberate duplication prevents a higher-level caller from forging or weakening approval context.

## Reference boundary

`ControlledStaticImageGenerationService` selects only canonical references that are `ACTIVE`, `VENUE_VERIFIED` and `requiredForGenerativeException=true`. Duplicate source asset IDs or insufficient coverage fail closed. References are loaded in deterministic `referenceId` order.

`GoogleDriveCreativeTruthReferenceLoader` then:

1. fetches file metadata from Drive v3 using the canonical `driveFileId`;
2. requires the metadata ID to equal the requested ID;
3. requires JPEG, PNG or WebP;
4. requires `capabilities.canDownload=true`;
5. downloads the blob with `alt=media`;
6. validates the downloaded file signature.

After download, `CreativeTruthOpenAiImageGenerator` re-resolves the same source from canonical `VENUE_VISUALS` and requires:

- unique `sourceAssetId` identity;
- exact canonical Drive file ID;
- `venueVerified=true`;
- `generativeReferenceAllowed=true`;
- non-revoked status;
- non-empty canonical `sourceSha256`;
- SHA-256 of actual downloaded bytes equal to canonical `sourceSha256`.

A Drive metadata error, unauthorized/forbidden download, source identity ambiguity, substituted bytes or hash mismatch stops generation before the OpenAI request.

## OpenAI binding

The executable provider follows the current Responses image-generation contract:

- mainline Responses model: `gpt-5.6` by default;
- tool: `image_generation` with `action=generate`;
- GPT Image model selection is managed by the Responses image-generation tool rather than asserted by TOCA OS;
- no `input_fidelity` override is sent by TOCA OS; current GPT Image 2 processing of image inputs is high-fidelity automatically;
- `quality=high`;
- `size=1024x1536`;
- JPEG output with compression `100`.

This distinction is deliberate. `GPT-5.6 Sol` is the product/model tier name presented by OpenAI, while the current API request identifier used by the official examples is `gpt-5.6`. TOCA OS therefore persists the exact mainline API model ID and records image-tool model selection as `RESPONSES_TOOL_MANAGED` instead of pretending that the Responses tool exposed a guaranteed underlying GPT Image model identity.

The prompt sent at developer priority is generated from canonical registry metadata. Caller-provided descriptive reference fields are not trusted as spatial truth. It explicitly prohibits architectural invention, venue redesign, synthetic logos, marketing text, CTA, price and fabricated signage. Official branding remains deterministic post-generation composition.

The only model override exposed by this path is `OPENAI_CREATIVE_RESPONSE_MODEL`. There is no automatic fallback to an older mainline model, no caller-controlled GPT Image tool override, and no prompt-only generation path.

## CLI

Development entrypoint:

```text
pnpm dev:marketing-autopilot-image-generate -- \
  --content-item-id <CONTENT_ITEM_ID> \
  --prompt-file .autopilot/prompt.txt \
  --output .autopilot/candidate.jpg \
  --manifest .autopilot/candidate.manifest.json
```

Exactly one of `--prompt` or `--prompt-file` is required.

Secret references:

- `GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY` — environment-variable name containing the Sheets OAuth token;
- `GOOGLE_DRIVE_ACCESS_TOKEN_ENV_KEY` — optional environment-variable name containing a Drive OAuth token; when omitted, the Sheets token reference is reused and must therefore also have Drive download scope;
- `OPENAI_API_KEY_ENV_KEY` — environment-variable name containing the OpenAI API key.

The CLI writes the generated candidate and a manifest with `status=GENERATED_REVIEW_REQUIRED`, exact `candidateSha256`, approval/reference lineage, the mainline Responses model ID, `imageToolModelSelection=RESPONSES_TOOL_MANAGED`, `readyForFinalComposition=false` and `publicationEligible=false`.

## What this does not do

This command does not:

- create or infer an exception approval;
- generate a logo;
- approve the generated pixels;
- run or fabricate a Venue Fidelity review;
- mark Brand Integrity or Quality as passed;
- publish to Instagram;
- create or activate Meta Ads;
- enable full generative video.

The next legitimate state after successful generation is **review required**, never published/approved by implication.

## Release gate

The implementation must pass the repository `architecture:check`, lint, typecheck, tests and build on the exact PR head. Provider-backed smoke should run only after trusted code validation and with a real canonical approval/reference set. No readiness claim is valid from a provider response alone.
