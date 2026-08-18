# TOCA Creative Truth & Venue Fidelity V1

## Status

Repository implementation mirror for the canonical Google Drive policy and registry.

- Policy: `TOCA_CREATIVE_TRUTH_POLICY_V1`
- Canonical implementation plan: Drive `1UR_LD8Gw4rlQkGsYh-VGW1ns8AzEx_m4fazpcCW-2wM`
- Canonical operational registry: Drive/Sheets `1bqF5zN5Lhesy_uls6gHMkOT-KLFRGo81OJMB_LPwXaU`
- Venue reference set: operation-scoped (`TOCA_VENUE_REFERENCE_SET_SUNSET_V1` / `TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1`); the global legacy set is deprecated for new production.
- Canonical Drive enhancement-provenance, thumbnail/R20-R29, operation-scoped generative binding, tool-routing and output-bound fidelity addenda synchronized on `2026-08-18`.
- Canonical Sunset Story standard: `SUNSET_STORY_V1` version `1.2`, Drive `1gTFxCLWnsZIy2vRKHGglXILMAexXoIUzd5WDZvpOtsM`.

Google Drive is the business source of truth. Repository JSON files are deterministic mirrors used by code review, local execution and CI. Runtime canonical-registry readers fail closed when required policy, standard, asset, lineage, brand or fidelity fields drift.

## Non-negotiable rule

AI does not define what Toca do Morcego looks like. Real verified media and official brand files define venue and brand truth. AI may propose copy, layout, enhancement or a controlled generative concept, but it cannot invent venue architecture or reconstruct logos.

A pass/fail statement about venue fidelity is not sufficient by itself. Whenever fidelity evidence is required, that evidence must be bound to the exact candidate output SHA-256 being evaluated so that evidence from one image cannot be replayed against another image.

## Creative modes

### `REAL_COMPOSITE`

Default for final image and video creatives. Uses a `VENUE_VERIFIED` / `MARKETING_READY` source or master and deterministic text/logo composition. The bytes entering deterministic composition must equal the registered master SHA-256.

### `REAL_PLUS_ENHANCEMENT`

Uses a verified real master and allows fidelity-preserving enhancement only. Enhanced bytes are expected to differ from the original master, therefore the system does **not** pretend they are the master. Instead it requires an immutable enhancement provenance record plus a post-edit Venue Fidelity PASS. The fidelity evidence is bound both to the registered real master SHA-256 and to the exact enhancement-output SHA-256 entering deterministic composition. In the current V1 runtime this mode is production-shaped for static image/Story composition; video remains fail-closed until a shot-level enhancement provenance model exists.

### `GENERATIVE_EXCEPTION`

Only allowed for static image creation in V1 with an explicit approval record in `GENERATIVE_EXCEPTIONS`. The approval must bind the content item to the operation-scoped reference set, require enough verified references, and keep architecture invention, environment drift and AI logo generation disabled.

Approval of the **intent to generate** is not approval of the generated pixels. Before a generative candidate can pass Venue Fidelity, its evidence must contain the exact `candidateSha256`, use only active verified references from the correct operation-scoped set, satisfy the approved reference count, contain no architecture/scene/logo drift signal, include output-specific review evidence and use an allowed review method. Generated pixels are intermediate only: marketing text, CTA, event time and brand marks are added later by deterministic composition.

## Canonical registries

`TOCA_OS — CREATIVE_TRUTH_REGISTRY_v1.0` contains:

- `POLICY`: policy lifecycle and fail-closed flags.
- `BRAND_ASSETS`: official Drive files for Toca, Morro Digital and approved partners.
- `VENUE_VISUALS`: real Toca source/master lineage and protected physical elements.
- `VENUE_REFERENCE_SET`: verified spatial references used by generative exceptions.
- `CREATIVE_STANDARDS`: Story, Feed, Ads, Video and Thumbnail standard bindings.
- `VIDEO_SHOTS`: truth-bound real video takes, including source/master lineage, SHA-256, venue verification, marketing readiness and rights status.
- `GENERATIVE_EXCEPTIONS`: explicit approvals only; empty means no exception exists.
- `GATE_LOG`: durable evidence of Brand, Venue and Quality gates.

`VIDEO_SHOTS` is fail-closed. A real video take cannot enter `LocalVideoComposer` merely because bytes were supplied. The shot must be active/approved, venue verified, marketing ready, bound to source/master lineage, carry an approved master SHA-256 and have rights explicitly cleared. Supplied bytes must match that registered master SHA-256 before FFmpeg is allowed to run.

## Brand integrity

A logo is never generated, repaired, approximated or redrawn by an image model. `BrandAsset` records pin the official Drive file ID and SHA-256 once verified. `SHA256_PINNED` records fail on digest mismatch; a registry entry that is not active and approved is not eligible for composition.

The deterministic image/video composers receive official logo bytes separately from the photographic/video source and overlay those files after creative generation or enhancement.

For `SUNSET_STORY_V1` version `1.2`, the footer is stricter than the generic static path: all four WHITE assets are mandatory in fixed order and exact identity — `BRAND-TOCA-WHITE-V1`, `BRAND-CORONA-WHITE-V1`, `BRAND-REDBULL-WHITE-V1`, `BRAND-MORRO-WHITE-V1`. Missing, duplicated, substituted, wrong-variant or hash-mismatched assets fail closed before rendering.

## Venue fidelity and byte identity

Final real-media output requires:

1. `venueVerified=true`;
2. `marketingReady=true` for final photographic/video composition;
3. source/master lineage;
4. master Drive file ID;
5. master SHA-256;
6. exact byte binding appropriate to the creative mode.

For `REAL_COMPOSITE`, the SHA-256 of the media bytes entering composition must equal the registered master SHA-256.

For `REAL_PLUS_ENHANCEMENT`, the system requires a `CreativeEnhancementProvenance` record containing policy/mode identity, editor provider, original master asset/Drive/SHA identity, enhanced output SHA, and source/Creative-Truth binding. The provenance output hash must equal the bytes entering deterministic composition. The final manifest persists this provenance, creating the auditable chain:

`REGISTERED REAL MASTER SHA -> ENHANCEMENT OUTPUT SHA -> OUTPUT-BOUND FIDELITY EVIDENCE -> POST-EDIT VENUE FIDELITY PASS -> FINAL CREATIVE SHA`.

This prevents valid registry metadata from being paired with substituted media bytes while still allowing faithful enhancement.

## Deterministic composition

`LocalCreativeComposer` remains the generic deterministic composer for supported static formats and for operation standards without a more specific renderer. It composes bound source images, controlled text/CTA/functional information and official logo bytes, validates Brand Integrity / Venue Fidelity / Quality, and produces a final output SHA-256 plus `DeterministicRenderManifest`.

`LocalStoryComposer` is the Story entry point and **does not create an alternate branding path**. It validates Story lineage and dispatches by resolved standard. For non-Sunset Story standards it can delegate to `LocalCreativeComposer` under their own contracts. For `SUNSET_STORY_V1`, however, generic fallback is forbidden: it routes exclusively to `LocalSunsetStoryRenderer` / `LOCAL_SUNSET_STORY_RENDERER_V1`.

### Dedicated `SUNSET_STORY_V1` renderer

`LocalSunsetStoryRenderer` is the canonical final renderer for real Sunset Stories. It requires standard version `1.2`, operation `SUNSET`, Instagram Story format, a verified marketing-ready Sunset master (or verified enhancement provenance), the exact four official WHITE footer brands and one of the approved template classes:

- `SUNSET_HERO_LIFESTYLE`
- `SUNSET_VIEW_SCENERY`
- `SUNSET_SOCIAL_EXPERIENCE`
- `SUNSET_DRINKS_EXPERIENCE`
- `SUNSET_INFO_HOURS`

The renderer encodes the approved 1080×1920 layout system rather than relying on the generic compositor. It pins the footer band to the canonical safe region, uses fixed slots for the four brands, and applies deterministic position/scale presets for headline, support copy, CTA and functional time information per template class. The current runtime typography profile is pinned to `DejaVu-Serif` for the editorial headline and `DejaVu-Sans` for support/CTA/functional text. Those runtime font names are an implementation profile, not a claim that Drive names them as the brand's official font files; replacing them requires a new standard version and visual validation.

The quality evidence produced by this renderer records `dedicatedRenderer=SUNSET_STORY_V1`, standard version, template class, runtime fonts, fixed footer geometry, required brand order and required brand asset IDs. Its final manifest keeps `exactAssetBinding=true`. If the dedicated renderer or any required official asset is unavailable, the Story fails closed; it may not fall back to generic composition or image generation.

`LocalThumbnailComposer` remains the final thumbnail-render path defined by its own standard and inherits Creative Truth gates through deterministic composition. `LocalVideoComposer` assembles only registry-bound verified shots and remains subject to its own video-specific provenance/rights restrictions.

Synthetic visual examples may teach palette, typography hierarchy, CTA treatment and layout. They are classified as `VISUAL_DIRECTION_REFERENCE_ONLY` and must never be used as venue or architectural evidence.

## Generative tool routing

Image generation is not a direct finalizer for Toca creatives. The machine-actionable `TOCA_CREATIVE_TOOL_ROUTING_V1` contract requires:

- real composition/enhancement finalization by deterministic renderers;
- generative exceptions to produce candidate pixels only;
- generated candidates to omit final logos, wordmarks, partner marks, marketing text, CTA, event time, price and operational status;
- official brand bytes to be loaded from canonical Drive assets and SHA-verified before final composition;
- final Brand Integrity, Venue Fidelity, Quality, output SHA and exact asset binding before a creative is treated as technically ready.

A generated candidate cannot be returned as `FINAL`, `STORY_READY`, `REVIEW`, `APPROVED`, `PREPARED` or `PUBLISHED` merely because generation succeeded.

## Publication boundary

The final asset is immutable from approval to publication. `CreativeTruthPublicationBinding` contains policy ID, standard ID, creative ID, final output SHA-256, Brand Integrity PASS, Venue Fidelity PASS, Quality PASS, exact asset locator(s) and `exactAssetBinding=true`.

Instagram/Meta execution must consume the exact approved asset. Preparation, scheduling or publishing may materialize/stage the asset, but may not reconstruct or redesign it. A staged object's MIME and byte hash must match the approved descriptor before provider execution.

TOCA-managed Instagram scheduling carries the Creative Truth binding inside the immutable approval descriptor. `PUBLISHED` is only valid after provider-backed confirmation; creative resolution/rendering by itself never authorizes provider mutation.

## Failure codes

The policy fails closed with explicit codes, including:

- `FAILED_NO_VENUE_VERIFIED_ASSET`
- `FAILED_BRAND_ASSET_MISSING`
- `FAILED_BRAND_ASSET_HASH_MISMATCH`
- `FAILED_AI_LOGO_RECONSTRUCTION`
- `FAILED_SCENE_INVENTION_DETECTED`
- `FAILED_ARCHITECTURE_DRIFT`
- `FAILED_UNAPPROVED_GENERATIVE_EXCEPTION`
- `FAILED_GENERATIVE_REFERENCE_MISSING`
- `FAILED_GENERATIVE_OUTPUT_REVIEW_MISSING`
- `FAILED_FIDELITY_EVIDENCE_BINDING`
- `FAILED_STANDARD_NOT_RESOLVED`
- `FAILED_LINEAGE_MISSING`
- `FAILED_ENHANCEMENT_PROVENANCE`
- `FAILED_VENUE_FIDELITY_GATE`
- `FAILED_BRAND_INTEGRITY_GATE`
- `FAILED_QUALITY_GATE`
- `FAILED_DIRECT_GENERATIVE_FINALIZATION`

Sunset Story additionally treats generic-renderer use, stale standard versions and incomplete/incorrect sponsor-footer binding as hard failures under its dedicated standard contract.

## Operational flow

Generic Creative Truth flow:

`BRIEF -> RESOLVE POLICY -> RESOLVE MODE -> RESOLVE STANDARD -> RESOLVE OFFICIAL BRAND ASSETS -> RESOLVE VERIFIED VENUE ASSET / VIDEO_SHOT / REFERENCES -> VERIFY REAL MASTER BYTE HASH -> [ENHANCE/GENERATE CANDIDATE IF ALLOWED] -> DETERMINISTIC FINALIZATION -> BRAND INTEGRITY -> VENUE FIDELITY -> QUALITY -> FINAL OUTPUT SHA-256 -> BUILD EXACT ASSET LOCATORS -> APPROVAL -> EXACT-ASSET EXECUTION`

Sunset Story specialization:

`CONTENT_ITEM SUNSET/STORIES -> SUNSET_STORY_V1 v1.2 -> TEMPLATE CLASS -> VENUE_VERIFIED + MARKETING_READY MASTER -> LOAD + SHA-VERIFY 4 OFFICIAL WHITE BRAND ASSETS -> LOCAL_SUNSET_STORY_RENDERER_V1 -> FIXED 1080x1920 PRESET -> COPY/CTA/TIME -> FIXED FOUR-BRAND FOOTER -> BRAND INTEGRITY -> VENUE FIDELITY -> QUALITY -> OUTPUT SHA-256 + EXACT ASSET BINDING -> STORY_READY -> REVIEW/APPROVAL -> PREPARE/PUBLISH EXACT APPROVED BYTES`

## Safety boundary

No automatic provider mutation is performed merely by resolving, enhancing or rendering a creative. Existing approval, capability, idempotency, budget and provider-write boundaries remain in force. Creative Truth is an additional prerequisite, not a replacement for those controls.
