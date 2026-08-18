# TOCA Creative Truth & Venue Fidelity V1

## Status

Repository implementation mirror for the canonical Google Drive policy and registry.

- Policy: `TOCA_CREATIVE_TRUTH_POLICY_V1`
- Canonical implementation plan: Drive `1UR_LD8Gw4rlQkGsYh-VGW1ns8AzEx_m4fazpcCW-2wM`
- Canonical operational registry: Drive/Sheets `1bqF5zN5Lhesy_uls6gHMkOT-KLFRGo81OJMB_LPwXaU`
- Venue reference set: `TOCA_VENUE_REFERENCE_SET_V1`

Google Drive is the business source of truth. Repository JSON files are deterministic mirrors used by code review, local execution and CI.

## Non-negotiable rule

AI does not define what Toca do Morcego looks like. Real verified media and official brand files define venue and brand truth. AI may propose copy, layout, enhancement or a controlled generative concept, but it cannot invent venue architecture or reconstruct logos.

## Creative modes

### `REAL_COMPOSITE`

Default for final image and video creatives. Uses a `VENUE_VERIFIED` / `MARKETING_READY` source or master and deterministic text/logo composition.

### `REAL_PLUS_ENHANCEMENT`

Uses a verified real source and allows fidelity-preserving enhancement only. A post-edit Venue Fidelity evidence record is mandatory.

### `GENERATIVE_EXCEPTION`

Only allowed with an explicit approval record in `GENERATIVE_EXCEPTIONS`. The approval must bind the content item to `TOCA_VENUE_REFERENCE_SET_V1`, require enough verified references, and keep architecture invention, environment drift and AI logo generation disabled. The generated result still must pass Venue Fidelity, Brand Integrity and Quality gates.

## Canonical registries

`TOCA_OS — CREATIVE_TRUTH_REGISTRY_v1.0` contains:

- `POLICY`: policy lifecycle and fail-closed flags.
- `BRAND_ASSETS`: official Drive files for Toca, Morro Digital and approved partners.
- `VENUE_VISUALS`: real Toca source/master lineage and protected physical elements.
- `VENUE_REFERENCE_SET`: verified spatial references used by generative exceptions.
- `CREATIVE_STANDARDS`: Story, Feed, Ads and Video standard bindings.
- `VIDEO_SHOTS`: truth-bound real video takes, including source/master lineage, SHA-256, venue verification, marketing readiness and rights status.
- `GENERATIVE_EXCEPTIONS`: explicit approvals only; empty means no exception exists.
- `GATE_LOG`: durable evidence of Brand, Venue and Quality gates.

`VIDEO_SHOTS` is fail-closed. A real video take cannot enter `LocalVideoComposer` merely because bytes were supplied. The shot ID must resolve to an `ACTIVE_APPROVED` record, venue and marketing checks must be true, rights must be explicitly cleared, and the supplied bytes must match the registered master SHA-256.

## Brand integrity

A logo is never generated, repaired, approximated or redrawn by an image model. `BrandAsset` records pin the official Drive file ID and optionally SHA-256 when that checksum has been captured. `SHA256_PINNED` records fail on digest mismatch; `DRIVE_FILE_ID_PINNED` records fail on file identity mismatch and remain eligible for later hash hardening.

The deterministic image/video composers receive the official logo bytes separately from the photographic/video source and overlay those files after creative generation or enhancement.

## Venue fidelity and byte identity

Final real-media output requires:

1. `venueVerified=true`;
2. `marketingReady=true` for final photographic/video composition;
3. source/master lineage;
4. master Drive file ID;
5. master SHA-256;
6. exact equality between the SHA-256 of the bytes actually rendered and the registered master SHA-256.

This prevents valid registry metadata from being paired with substituted media bytes. A source/master identity mismatch fails before ImageMagick or FFmpeg runs.

For enhancement or generative output, a fidelity verifier must state whether source identity was preserved and whether architecture drift, scene invention or logo reconstruction was detected. Any positive drift signal is a hard failure.

## Deterministic composition

`LocalCreativeComposer` composes 4:5, 1:1 and 9:16 static creatives from a bound source image, controlled typography, CTA, functional information and official logos. It produces an output SHA-256 and `DeterministicRenderManifest`.

`LocalStoryComposer` is no longer an independent branding path. It delegates rendering to `LocalCreativeComposer`, requires a Story creative standard, binds the declared master ID and Drive file ID to the verified venue master, and uses official brand files. Literal text labels or AI-reconstructed logos are not a valid branding mechanism.

`LocalVideoComposer` assembles only registry-bound verified shots with FFmpeg, validates cleared rights and exact registered master hashes, overlays official logo files and produces the same manifest semantics for video. `GENERATIVE_EXCEPTION` remains a separately approved, reference-bound path and does not make unregistered real footage acceptable.

Synthetic visual examples may teach palette, typography hierarchy, CTA treatment and layout. They are classified as `VISUAL_DIRECTION_REFERENCE_ONLY` and must never be used as venue or architectural evidence.

## Publication boundary

The final asset is immutable from approval to publication. `CreativeTruthPublicationBinding` contains:

- policy ID;
- standard ID;
- creative ID;
- final output SHA-256;
- Brand Integrity PASS;
- Venue Fidelity PASS;
- Quality PASS;
- one or more exact asset locators such as `MEDIA_URL`, provider image/video IDs/hashes or a Drive file ID;
- `exactAssetBinding=true`.

Instagram verifies that the ordered `MEDIA_URL` locators are exactly the URLs being published. Meta Ads validates the provider creative locator before its controlled write path. Publication or ad creation cannot silently substitute or rebuild a creative.

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
- `FAILED_STANDARD_NOT_RESOLVED`
- `FAILED_LINEAGE_MISSING`
- `FAILED_VENUE_FIDELITY_GATE`
- `FAILED_BRAND_INTEGRITY_GATE`
- `FAILED_QUALITY_GATE`

Additional fail-closed execution reasons include exact master-byte mismatches, missing `VIDEO_SHOTS` registry bindings and video rights that are not explicitly cleared.

## Operational flow

`BRIEF -> RESOLVE POLICY -> RESOLVE MODE -> RESOLVE STANDARD -> RESOLVE OFFICIAL BRAND ASSETS -> RESOLVE VERIFIED VENUE ASSET / VIDEO_SHOT / REFERENCES -> VERIFY MASTER BYTE HASH -> GENERATE/ENHANCE IF ALLOWED -> DETERMINISTIC COMPOSITION -> BRAND INTEGRITY -> VENUE FIDELITY -> QUALITY -> OUTPUT SHA-256 -> BUILD EXACT ASSET LOCATORS -> APPROVAL -> EXACT-ASSET PUBLICATION`

## Safety boundary

No automatic provider mutation is performed merely by resolving or rendering a creative. Existing approval and provider-write boundaries remain in force. Creative Truth is an additional prerequisite, not a replacement for approval, idempotency, budget or provider policies.
