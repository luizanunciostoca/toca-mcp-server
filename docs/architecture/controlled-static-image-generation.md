# Controlled static image generation — Creative Truth V1

Status: implementation candidate on PR #197. This document describes the executable `GENERATIVE_EXCEPTION` boundary for full **static-image** creation. It does not enable full synthetic venue video.

## Purpose

The normal TOCA creative path remains `REAL_COMPOSITE` / `REAL_PLUS_ENHANCEMENT`. Full static generation exists only for an explicitly approved exception and must preserve venue/brand truth.

The canonical executable path is:

`content_item -> canonical operation -> canonical approval -> operation-scoped reference set -> authenticated Drive byte download -> source SHA verification -> OpenAI image generation -> candidate SHA -> post-generation review -> Venue Fidelity -> deterministic composition -> Brand Integrity -> Quality -> exact output binding -> approval/publication`

Generation stops at the candidate boundary. The generator never returns publication eligibility.

## Operation-scoped truth

The legacy global reference set `TOCA_VENUE_REFERENCE_SET_V1` is **DEPRECATED** and is not eligible for new production execution.

Active reference sets are:

- `SUNSET -> TOCA_VENUE_REFERENCE_SET_SUNSET_V1`;
- `THE_PARTY -> TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1`.

`CONTENT_ITEMS.operation` is resolved from the canonical Marketing Autopilot registry before the approval is trusted. The approval row also carries an explicit `OPERATION` column. Runtime requires all three identities to agree:

`content operation == approval.operation == operation(reference_set_id)`.

Missing canonical content operation, unsupported operation, approval/reference-set mismatch, cross-operation reference reuse or a deprecated reference set fails closed **before** provider access.

## Runtime components

- `ControlledOperationScopedStaticImageGenerationService`: top-level fail-closed orchestration.
- `GoogleSheetsOperationScopedGenerativeRegistry`: canonical operation, scoped policy, approval and reference topology reads.
- `GoogleSheetsCreativeTruthRegistry`: shared Brand/Venue/Creative Truth primitives and base policy validation.
- `GoogleDriveCreativeTruthReferenceLoader`: authenticated metadata + byte download from exact canonical Drive file IDs.
- `CreativeTruthOperationScopedImageGenerator`: provider call only after independent canonical approval/operation/reference revalidation.
- `marketing-autopilot-image-generate.ts`: operator CLI that writes a candidate JPEG and a non-publishable evidence manifest.

## Canonical Drive policy boundary

`TOCA_OS — CREATIVE_TRUTH_REGISTRY_v1.0` is authoritative.

The operation-scoped runtime validates `POLICY!A2:Z20`, including:

- `GENERATIVE_REFERENCE_STRATEGY=OPERATION_SCOPED_ONLY_V1`;
- legacy set ID `TOCA_VENUE_REFERENCE_SET_V1`;
- legacy status `DEPRECATED`;
- active Sunset reference set ID;
- active The Party reference set ID;
- `CROSS_OPERATION_REFERENCE_REUSE=FORBIDDEN`;
- `REFERENCE_SET_OPERATION_MATCH=REQUIRED`;
- `LEGACY_REFERENCE_SET_EXECUTION=DENY`.

It also validates `VENUE_REFERENCE_SET!A2:K1000`:

- legacy rows must be `DEPRECATED` with `OPERATION_SCOPE=LEGACY_DEPRECATED`;
- Sunset rows must declare `OPERATION_SCOPE=SUNSET`;
- The Party rows must declare `OPERATION_SCOPE=THE_PARTY`;
- each active operation-scoped set must retain at least three active reference rows.

Policy drift is a hard failure rather than a reason to silently use older behavior.

## Content operation boundary

The runtime reads the exact `content_item_id` from the canonical Marketing Autopilot content registry and resolves its operation from `CONTENT_ITEMS`.

Accepted operations for this V1 path are only:

- `SUNSET`;
- `THE_PARTY`.

Zero matches fail closed as `FAILED_GENERATIVE_CONTENT_OPERATION_MISSING`. Duplicate identity fails closed as `FAILED_GENERATIVE_CONTENT_OPERATION_AMBIGUOUS`. Any other operation fails closed as `FAILED_GENERATIVE_CONTENT_OPERATION_UNSUPPORTED`.

The higher-level service verifies this operation before loading approval/references. The low-level OpenAI adapter verifies it again immediately before provider access. This deliberate duplication prevents a direct low-level call from bypassing content-operation truth.

## Approval boundary

For the exact `contentItemId`, `GENERATIVE_EXCEPTIONS!A2:O1000` must resolve exactly one `APPROVED` row. Zero or multiple approved rows do not authorize generation.

The canonical approval must:

- carry `operation=SUNSET|THE_PARTY`;
- use the exact active reference set compatible with that operation;
- require at least 3 references;
- set `allowArchitecturalInvention=false`;
- set `allowEnvironmentDrift=false`;
- set `allowAiLogoGeneration=false`;
- be unexpired when an expiry exists.

The approval schema itself rejects operation/reference-set mismatch. The low-level generator independently re-reads the canonical approval and requires exact identity—including `operation`—against the supplied approval object.

## Reference boundary

`ControlledOperationScopedStaticImageGenerationService` selects only canonical references that are:

- from the approved operation-scoped reference set;
- `ACTIVE`;
- `VENUE_VERIFIED`;
- `requiredForGenerativeException=true`.

Duplicate source asset IDs or insufficient coverage fail closed. References are loaded in deterministic `referenceId` order.

`GoogleDriveCreativeTruthReferenceLoader` then:

1. fetches file metadata from Drive v3 using the canonical `driveFileId`;
2. requires metadata ID equality;
3. requires JPEG, PNG or WebP;
4. requires download permission;
5. downloads exact bytes with `alt=media`;
6. validates file signature.

After download, `CreativeTruthOperationScopedImageGenerator` re-resolves each source from canonical `VENUE_VISUALS` and requires:

- unique `sourceAssetId` identity;
- exact canonical Drive file ID;
- `venue.operation == canonical content/approval operation`;
- `venueVerified=true`;
- `generativeReferenceAllowed=true`;
- non-revoked status;
- non-empty canonical `sourceSha256`;
- SHA-256 of actual downloaded bytes equal to canonical `sourceSha256`.

A Drive metadata error, unauthorized download, source ambiguity, cross-operation venue row, substituted bytes or hash mismatch stops generation before the OpenAI request.

## The Party-specific rule

A The Party exception can only use `TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1`. Sunset references never define The Party venue truth.

Operation-scoped reference truth does **not** replace The Party visual governance. A final The Party creative still requires the resolved The Party visual family, official hero brand, edition/environment context when Hybrid Networks applies, post-generation human/multimodal review, Venue Fidelity, Brand Integrity, Quality and exact output binding.

## Sunset-specific rule

A Sunset exception can only use `TOCA_VENUE_REFERENCE_SET_SUNSET_V1`. The Party references never define Sunset venue truth.

The same post-generation Creative Truth and exact-output boundaries apply.

## OpenAI binding

The executable provider follows the current Responses image-generation contract:

- mainline Responses model: `gpt-5.6` by default;
- tool: `image_generation` with `action=generate`;
- image-tool model selection managed by the Responses tool;
- no caller-controlled `input_fidelity` override;
- `quality=high`;
- `size=1024x1536`;
- JPEG output with compression `100`.

The developer-priority policy is generated from canonical operation/reference metadata. It prohibits cross-operation venue facts, architectural invention, venue redesign, synthetic logos, marketing text, CTA, price and fabricated signage. Official branding remains deterministic post-generation composition.

The only model override exposed by this path is `OPENAI_CREATIVE_RESPONSE_MODEL`. There is no automatic fallback to an older model, another reference set or prompt-only generation.

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
- `GOOGLE_DRIVE_ACCESS_TOKEN_ENV_KEY` — optional Drive OAuth token reference; when omitted, the Sheets token reference is reused and therefore must also have Drive download scope;
- `OPENAI_API_KEY_ENV_KEY` — environment-variable name containing the OpenAI API key.

The CLI writes the generated candidate and a manifest with:

- `status=GENERATED_REVIEW_REQUIRED`;
- exact `candidateSha256`;
- `operation`;
- operation-scoped `referenceSetId`;
- approval/reference lineage;
- response model/tool selection;
- `readyForFinalComposition=false`;
- `publicationEligible=false`.

## What this does not do

This command does not:

- create or infer an exception approval;
- infer the content operation;
- infer The Party `INTERNATIONAL|NATIONAL` environment;
- use the deprecated global reference set;
- cross-use Sunset/The Party references;
- generate a logo;
- approve generated pixels;
- fabricate Venue Fidelity review;
- mark Brand Integrity or Quality as passed;
- publish to Instagram;
- create or activate Meta Ads;
- enable full generative venue video.

The next legitimate state after successful generation is **review required**, never approved/published by implication.

## Release gate

The implementation must pass repository `architecture:check`, format, lint, typecheck, tests and build on the exact PR head. Provider-backed smoke runs only after trusted code validation and with a real canonical content item + operation-matched approval/reference set. No readiness claim is valid from a provider response alone.
