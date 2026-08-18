# TOCA Creative Truth & Venue Fidelity V1

## Status

Repository implementation mirror for the canonical Google Drive policy and registry.

- Policy: `TOCA_CREATIVE_TRUTH_POLICY_V1`
- Canonical implementation plan: Drive `1UR_LD8Gw4rlQkGsYh-VGW1ns8AzEx_m4fazpcCW-2wM`
- Canonical operational registry: Drive/Sheets `1bqF5zN5Lhesy_uls6gHMkOT-KLFRGo81OJMB_LPwXaU`
- Venue reference set: `TOCA_VENUE_REFERENCE_SET_V1`
- Canonical Drive enhancement-provenance addendum synchronized on `2026-08-18`; `POLICY` now records `ENHANCEMENT_PROVENANCE_REQUIRED=true` and the fail-closed video boundary.

Google Drive is the business source of truth. Repository JSON files are deterministic mirrors used by code review, local execution and CI. Runtime `assertCanonicalPolicy()` reads the canonical `POLICY!A2:Q20` row and fails closed if enhancement provenance or the video fail-closed flags drift.

## Non-negotiable rule

AI does not define what Toca do Morcego looks like. Real verified media and official brand files define venue and brand truth. AI may propose copy, layout, enhancement or a controlled generative concept, but it cannot invent venue architecture or reconstruct logos.

## Creative modes

### `REAL_COMPOSITE`

Default for final image and video creatives. Uses a `VENUE_VERIFIED` / `MARKETING_READY` source or master and deterministic text/logo composition. The bytes entering deterministic composition must equal the registered master SHA-256.

### `REAL_PLUS_ENHANCEMENT`

Uses a verified real master and allows fidelity-preserving enhancement only. Enhanced bytes are expected to differ from the original master, therefore the system does **not** pretend they are the master. Instead it requires an immutable enhancement provenance record plus a post-edit Venue Fidelity PASS. In the current V1 runtime this mode is production-shaped for static image/Story composition; video remains fail-closed until a shot-level enhancement provenance model exists.

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

The canonical `POLICY` row additionally declares `ENHANCEMENT_PROVENANCE_REQUIRED=TRUE`, `VIDEO_REAL_PLUS_ENHANCEMENT=FAIL_CLOSED_UNTIL_SHOT_LEVEL_PROVENANCE`, and `VIDEO_ENHANCEMENT_FAILURE=VIDEO_ENHANCEMENT_PROVENANCE_UNSUPPORTED`.

`VIDEO_SHOTS` is fail-closed. A real video take cannot enter `LocalVideoComposer` merely because bytes were supplied. `CreativeTruthResolver.resolveVideoShots()` resolves requested shot IDs from the canonical registry first. The shot must be `ACTIVE_APPROVED`, venue verified, marketing ready, bound to source/master lineage, carry an approved master SHA-256 and have rights explicitly cleared. The supplied bytes must then match that registered master SHA-256 before FFmpeg is allowed to run.

A verified source may exist in the registry without being marketing-ready. Such a record remains useful as evidence/reference, but it is rejected for final video composition until master and rights approval are completed.

## Brand integrity

A logo is never generated, repaired, approximated or redrawn by an image model. `BrandAsset` records pin the official Drive file ID and SHA-256 once verified. `SHA256_PINNED` records fail on digest mismatch; a registry entry that is not active and approved is not eligible for composition.

The deterministic image/video composers receive the official logo bytes separately from the photographic/video source and overlay those files after creative generation or enhancement.

## Venue fidelity and byte identity

Final real-media output requires:

1. `venueVerified=true`;
2. `marketingReady=true` for final photographic/video composition;
3. source/master lineage;
4. master Drive file ID;
5. master SHA-256;
6. exact byte binding appropriate to the creative mode.

For `REAL_COMPOSITE`, the SHA-256 of the media bytes entering composition must equal the registered master SHA-256.

For `REAL_PLUS_ENHANCEMENT`, the system requires a `CreativeEnhancementProvenance` record containing:

- `policyId=TOCA_CREATIVE_TRUTH_POLICY_V1`;
- `creativeMode=REAL_PLUS_ENHANCEMENT`;
- editor provider;
- original master asset ID;
- original master Drive file ID;
- original master SHA-256;
- enhanced output SHA-256;
- `sourceImageBound=true`;
- `creativeTruthBound=true`;
- `requiresVenueFidelityGate=true`.

The provenance must point to the exact registered master and its `outputSha256` must equal the bytes actually entering deterministic composition. The final `DeterministicRenderManifest` persists this provenance, creating an auditable chain:

`REGISTERED REAL MASTER SHA -> ENHANCEMENT OUTPUT SHA -> POST-EDIT VENUE FIDELITY PASS -> FINAL CREATIVE SHA`.

Both the local ImageMagick enhancer and the OpenAI enhancement adapter emit this same policy-pinned provenance contract. The OpenAI adapter independently rehashes the supplied original bytes and returned enhanced bytes instead of trusting provider-reported digests alone.

This prevents valid registry metadata from being paired with substituted media bytes while still allowing faithful enhancement. A source/master identity mismatch, enhancement-output substitution, wrong policy/mode or missing post-edit Venue Fidelity evidence fails closed.

For generative output, a fidelity verifier must state whether source/reference identity was preserved and whether architecture drift, scene invention or logo reconstruction was detected. Any positive drift signal is a hard failure.

## Deterministic composition

`LocalCreativeComposer` composes 4:5, 1:1 and 9:16 static creatives from a bound source image, controlled typography, CTA, functional information and official logos. It produces an output SHA-256 and `DeterministicRenderManifest`. In enhancement mode the manifest also persists `CreativeEnhancementProvenance`.

`LocalStoryComposer` is not an independent branding path. It delegates rendering to `LocalCreativeComposer`, requires a Story creative standard, binds the declared master ID and Drive file ID to the verified venue master, and uses official brand files. If the Story uses a verified enhancement, its `masterSha256` remains the original real master SHA while the enhancement output SHA remains in the provenance record. Literal text labels or AI-reconstructed logos are not a valid branding mechanism.

`LocalVideoComposer` assembles only registry-bound verified shots with FFmpeg, validates cleared rights and exact registered master hashes, overlays official logo files and produces the same manifest semantics for video. It also emits a deterministic video edit manifest containing ordered shot IDs, source/master lineage, registered master SHA-256, expected source duration and the exact-master-byte-binding flag. `GENERATIVE_EXCEPTION` remains a separately approved, reference-bound path and does not make unregistered real footage acceptable. `REAL_PLUS_ENHANCEMENT` is intentionally rejected by the current video composer with `VIDEO_ENHANCEMENT_PROVENANCE_UNSUPPORTED` until a shot/segment-level provenance contract can bind every transformed input to its real master; the composer must not emit a misleading READY artifact that the publication manifest would later reject.

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

### TOCA-managed Instagram scheduling

The durable TOCA-managed scheduler carries the `CreativeTruthPublicationBinding` inside the immutable approval descriptor. The descriptor also contains the staged GCS object name, MIME type and SHA-256. Scheduling is rejected when the approved asset SHA-256 differs from the Creative Truth `outputSha256`.

The managed single-asset path supports image posts, image/video Stories and MP4 Reels. A Reel descriptor must be `video/mp4`; MIME substitution is rejected. Carousel remains fail-closed in this single-asset descriptor until a dedicated multi-asset approval contract binds every child asset independently. Generic Instagram publication contracts may represent multiple URLs, but the managed scheduler must not pretend a singular approved object is a complete carousel.

At execution time:

1. `GcsPublicationAssetDelivery.createVerifiedDeliveryUrl()` signs the private object URL;
2. the staged object MIME must match the approved descriptor;
3. the complete object is fetched and SHA-256 verified against the approved final creative hash;
4. only after byte equality is proven is the current signed `MEDIA_URL` added to the runtime binding;
5. the production `InstagramPublicationExecutor` is instantiated with Creative Truth enforcement enabled;
6. the executor rejects any request whose exact runtime media URL is not in the binding.

GCS staging accepts the exact final image types and `video/mp4`, creates deterministic object names from correlation ID + creative asset ID + SHA prefix, and validates the externally fetchable MIME before returning the object. This gives the Reel path the same exact-asset guarantee as static image publication.

This allows a short-lived signed URL to be derived at execution time without weakening exact-asset approval: object identity, object name, MIME and final-byte SHA-256 are approved first, and the derived URL is accepted only after the private object is reverified.

Legacy/manual publication preparation that does not supply a Creative Truth binding cannot cross the production executor boundary. It therefore fails closed rather than becoming an alternate publication bypass.

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
- `FAILED_ENHANCEMENT_PROVENANCE`
- `FAILED_VENUE_FIDELITY_GATE`
- `FAILED_BRAND_INTEGRITY_GATE`
- `FAILED_QUALITY_GATE`

Additional fail-closed execution reasons include exact master-byte mismatches, missing `VIDEO_SHOTS` registry bindings, uncleared video rights, unsupported video enhancement provenance, incomplete video edit lineage, managed-schedule Creative Truth hash mismatch, invalid Reel MIME and GCS publication object SHA-256/MIME mismatch.

## Operational flow

`BRIEF -> RESOLVE POLICY -> RESOLVE MODE -> RESOLVE STANDARD -> RESOLVE OFFICIAL BRAND ASSETS -> RESOLVE VERIFIED VENUE ASSET / VIDEO_SHOT / REFERENCES -> VERIFY REAL MASTER BYTE HASH -> [STATIC REAL_PLUS_ENHANCEMENT ONLY: FAITHFUL ENHANCEMENT -> VERIFY ENHANCEMENT PROVENANCE -> POST-EDIT VENUE FIDELITY] -> BUILD DETERMINISTIC EDIT/RENDER MANIFEST -> DETERMINISTIC COMPOSITION -> BRAND INTEGRITY -> VENUE FIDELITY -> QUALITY -> OUTPUT SHA-256 -> BUILD EXACT ASSET LOCATORS -> APPROVAL -> STAGE PRIVATE FINAL ASSET -> VERIFY STAGED MIME + BYTE HASH -> EXACT-ASSET PUBLICATION`

## Safety boundary

No automatic provider mutation is performed merely by resolving, enhancing or rendering a creative. Existing approval and provider-write boundaries remain in force. Creative Truth is an additional prerequisite, not a replacement for approval, idempotency, budget or provider policies.
