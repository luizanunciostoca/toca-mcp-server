# Controlled static image generation — Creative Truth V1

Status: implementation candidate on PR #197. This document describes the executable `GENERATIVE_EXCEPTION` boundary for full **static-image** creation. It does not enable full synthetic venue video.

## Purpose

The normal TOCA creative path remains `REAL_COMPOSITE` / `REAL_PLUS_ENHANCEMENT`. Full static generation exists only for an explicitly approved exception and must preserve venue and brand truth.

The canonical executable path is:

`content item -> canonical operation -> canonical approval -> operation-scoped reference set -> authenticated Drive reference bytes -> source SHA verification -> OpenAI candidate generation -> immutable candidate manifest -> output-specific human/multimodal review -> controlled finalization -> canonical standard/context/brand revalidation -> Venue Fidelity -> deterministic composition -> Brand Integrity -> Quality -> exact final output binding -> normal approval/publication boundaries`

Generation and finalization are deliberately separate. Generation stops at a non-publishable candidate. Finalization only accepts the exact reviewed candidate and still does not authorize publication.

## Operation-scoped truth

The legacy global reference set `TOCA_VENUE_REFERENCE_SET_V1` is **DEPRECATED** and is not eligible for new production execution.

Active reference sets are:

- `SUNSET -> TOCA_VENUE_REFERENCE_SET_SUNSET_V1`;
- `THE_PARTY -> TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1`.

`CONTENT_ITEMS.operation` is resolved from the canonical Marketing Autopilot registry before the approval is trusted. The approval row also carries an explicit `OPERATION` column. Runtime requires all three identities to agree:

`content operation == approval.operation == operation(reference_set_id)`.

Missing canonical content operation, unsupported operation, approval/reference-set mismatch, cross-operation reference reuse or a deprecated reference set fails closed before provider access and is revalidated again before final composition.

## Runtime components

Generation:

- `ControlledOperationScopedStaticImageGenerationService`: top-level fail-closed generation orchestration with trusted clock.
- `GoogleSheetsOperationScopedGenerativeRegistry`: canonical operation, scoped policy, approval, reference, brand and standard reads.
- `GoogleSheetsCreativeTruthRegistry`: shared Brand/Venue/Creative Truth primitives and base policy validation.
- `GoogleDriveCreativeTruthReferenceLoader`: authenticated metadata + byte download from exact canonical Drive reference IDs.
- `CreativeTruthOperationScopedImageGenerator`: provider call only after independent canonical approval/operation/reference/hash revalidation.
- `marketing-autopilot-image-generate.ts`: operator CLI that writes a candidate JPEG and a non-publishable candidate manifest.

Finalization:

- `operationScopedGenerativeCandidateManifestSchema`: immutable candidate identity and reference lineage contract.
- `evaluateOperationScopedGenerativeFidelity`: output-specific human/multimodal Venue Fidelity gate.
- `ControlledOperationScopedGenerativeFinalizationService`: single canonical finalization authority.
- `createControlledOperationScopedGenerativeFinalizationService`: production factory that owns construction of the raw local compositor so CLIs/workers cannot import it directly.
- `LocalOperationScopedGenerativeComposer`: deterministic ImageMagick rendering primitive, not an execution authority.
- `resolveCanonicalGenerativeBrandInputs`: canonical `BRAND_ASSETS` metadata revalidation before rendering.
- `GoogleDriveCreativeTruthBrandAssetLoader`: loads exact official brand bytes from Drive and verifies pinned SHA-256.
- `GoogleSheetsThePartyContentOrchestration`: canonical The Party standard/environment context resolver used by finalization.
- `marketing-autopilot-image-finalize.ts`: operator CLI for reviewed candidate -> final exact asset. It returns `publicationAuthorized=false`.

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

The higher-level generation service verifies this operation before loading approval/references. The low-level OpenAI adapter verifies it again immediately before provider access. The finalization service verifies it a third time before deterministic composition. This deliberate duplication prevents direct low-level calls or stale candidate artifacts from bypassing current content-operation truth.

## Trusted clock boundary

Approval expiry is never evaluated against caller-provided time.

Both controlled generation and controlled finalization own an injected trusted `now()` dependency, defaulting to current runtime time. The operator CLIs explicitly reject `--now-iso`. An invalid trusted clock fails closed with `GENERATIVE_TRUSTED_CLOCK_INVALID`.

This prevents backdating an expired exception approval at either generation or finalization.

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

The approval schema rejects operation/reference-set mismatch. The low-level generator independently re-reads the canonical approval before provider access. Finalization re-reads it again and requires exact `exceptionId`, `approvalRef`, content item, operation and reference-set binding from the candidate manifest.

## Reference boundary

`ControlledOperationScopedStaticImageGenerationService` selects only canonical references that are:

- from the approved operation-scoped reference set;
- `ACTIVE`;
- `VENUE_VERIFIED`;
- `requiredForGenerativeException=true`.

Duplicate reference IDs, duplicate source asset IDs or insufficient coverage fail closed. References are loaded in deterministic `referenceId` order.

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

The candidate manifest persists the deterministic ordered `referenceAssetIds` and `referenceSha256s`. Finalization re-reads the current canonical reference set and `VENUE_VISUALS`, then requires the same ordered identities and hashes. A revoked/replaced reference therefore invalidates an older candidate before it can become final.

## Candidate manifest boundary

The generated candidate is represented by `operationScopedGenerativeCandidateManifestSchema` and remains non-final.

The manifest binds:

- `contentItemId`;
- `operation`;
- operation-scoped `referenceSetId`;
- `exceptionId` and `approvalRef`;
- exact `candidateSha256`;
- ordered reference asset IDs and source SHA-256 values;
- provider and model/tool metadata;
- output MIME and optional byte length;
- `requiresPostGenerationHumanReview=true`;
- `requiresVenueFidelityGate=true`;
- `readyForFinalComposition=false`;
- `publicationEligible=false`.

The schema itself rejects operation/reference-set mismatch, lineage-length mismatch, duplicate reference identities and duplicate reference source hashes.

## Post-generation Venue Fidelity

`evaluateOperationScopedGenerativeFidelity` accepts only evidence bound to the exact candidate SHA and exact operation-scoped reference set.

A passing candidate requires:

- a still-valid operation-scoped approval;
- enough unique active verified references;
- evidence covering only and all canonical eligible references;
- output-specific `HUMAN_REVIEW` or `MULTIMODAL_PLUS_HUMAN` evidence with `reviewRef`;
- no architecture drift;
- no scene invention;
- no AI logo reconstruction;
- preserved source/venue identity.

Evidence replayed from another candidate or another operation/reference set fails closed.

## Canonical finalization boundary

`ControlledOperationScopedGenerativeFinalizationService` is the only finalization authority. `LocalOperationScopedGenerativeComposer` is intentionally only a primitive and architecture checks forbid operator/worker imports outside the controlled finalizer.

Immediately before render, finalization revalidates:

1. candidate MIME, byte length and SHA-256;
2. canonical Creative Truth policy;
3. current `CONTENT_ITEMS.operation`;
4. current approval identity and expiry using trusted time;
5. current canonical reference topology and minimum count;
6. current `VENUE_VISUALS` operation, Drive identity and source SHA-256;
7. current `CREATIVE_STANDARDS` record for the requested output/visual standard;
8. canonical The Party content/edition context when `operation=THE_PARTY`;
9. canonical `BRAND_ASSETS` metadata;
10. exact supplied brand bytes/locator against canonical Brand Integrity during deterministic composition.

The caller may request a standard by ID, but caller-supplied standard fields are discarded and replaced by canonical registry readback.

## Official brand byte boundary

The finalization CLI resolves every required brand from canonical `BRAND_ASSETS` and then uses `GoogleDriveCreativeTruthBrandAssetLoader` to load the exact official file.

The loader requires:

- `status=ACTIVE_APPROVED`;
- `aiReconstructionAllowed=false`;
- `integrityMode=SHA256_PINNED`;
- supported image MIME;
- exact Drive metadata file identity and MIME;
- `canDownload=true`;
- valid image signature;
- SHA-256 of downloaded bytes equal to the pinned registry hash.

The finalization service re-resolves brand metadata again before passing it to the primitive compositor. The compositor's Brand Integrity gate re-hashes actual bytes, so caller-forged metadata or substituted logo bytes cannot become a final asset.

For The Party, the hero brand must resolve to the official white asset `BRAND-THE-PARTY-WHITE-V1`.

## The Party-specific boundary

A The Party exception can only use `TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1`. Sunset references never define The Party venue truth.

The Party visual governance is enforced inside the canonical finalizer, not delegated to the CLI. For `operation=THE_PARTY`, finalization requires a canonical The Party context resolver. The effective output/visual standard must equal the current standard resolved for the same content item.

For `THE_PARTY_HYBRID_NETWORKS_V1`, the environment is read from canonical content/edition context. A missing/unresolved environment fails with `THE_PARTY_ENVIRONMENT_REQUIRED`. Callers cannot provide `partyEnvironment` or `--party-environment` to override this state.

This means a worker introduced later cannot bypass the edition boundary simply by calling the finalization class directly.

## Sunset-specific boundary

A Sunset exception can only use `TOCA_VENUE_REFERENCE_SET_SUNSET_V1`. The Party references never define Sunset venue truth.

The final standard must be an active canonical Sunset-compatible standard. Required Toca branding and the same post-generation Creative Truth / exact-output boundaries still apply.

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

## Generation CLI

Development entrypoint:

```text
pnpm dev:marketing-autopilot-image-generate -- \
  --content-item-id <CONTENT_ITEM_ID> \
  --prompt-file .autopilot/prompt.txt \
  --output .autopilot/candidate.jpg \
  --manifest .autopilot/candidate.manifest.json
```

Exactly one of `--prompt` or `--prompt-file` is required. `--now-iso` is explicitly forbidden.

Secret references:

- `GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY` — environment-variable name containing the Sheets OAuth token;
- `GOOGLE_DRIVE_ACCESS_TOKEN_ENV_KEY` — optional Drive OAuth token reference; when omitted, the Sheets token reference is reused and therefore must also have Drive download scope;
- `OPENAI_API_KEY_ENV_KEY` — environment-variable name containing the OpenAI API key.

The legitimate next state after this command is **review required**, never final/published by implication.

## Finalization CLI

After an output-specific review has produced a `FidelityEvidence` JSON document, the controlled finalization entrypoint is:

```text
pnpm dev:marketing-autopilot-image-finalize -- \
  --candidate .autopilot/candidate.jpg \
  --candidate-manifest .autopilot/candidate.manifest.json \
  --fidelity-evidence .autopilot/fidelity-evidence.json \
  --creative-id <CREATIVE_ID> \
  --standard-id <CANONICAL_STANDARD_ID> \
  --canvas 1080x1350 \
  --output .autopilot/final.jpg \
  --final-manifest .autopilot/final.manifest.json
```

For an `operation=ALL` transversal output standard, `--visual-standard-id` is also required so the finalizer can re-resolve the exact operation-specific visual identity.

Optional copy fields are deterministic composition inputs. `--additional-brands` may request additional registered partner brands, but cannot remove the mandatory operation brand. The Party environment is never accepted from the CLI. `--now-iso` and `--party-environment` are explicitly forbidden.

Successful finalization writes the exact JPEG and deterministic final manifest, and still returns `publicationAuthorized=false`. Publication continues through the existing Approval / Policy / Capability / exact-asset provider boundaries.

## What this does not do

Neither command:

- creates or infers an exception approval;
- accepts the deprecated global reference set;
- cross-uses Sunset/The Party references;
- invents or reconstructs a logo;
- fabricates Venue Fidelity review;
- bypasses The Party edition/environment truth;
- lets caller-controlled time keep an expired approval alive;
- silently trust stale standard, reference or brand metadata;
- publish to Instagram;
- create or activate Meta Ads;
- enable full generative venue video.

Generation alone never marks Brand Integrity, Venue Fidelity or Quality as passed. Finalization can produce the exact gate-bound asset, but still does not grant provider publication authorization.

## Release gate

The implementation must pass repository `architecture:check`, format, lint, typecheck, tests and build on the exact PR head. Provider-backed smoke runs only after trusted code validation and with a real canonical content item + operation-matched approval/reference set. No readiness claim is valid from a provider response alone.
