# Deterministic Artist-Safe Composite

## Purpose

This runtime creates a real-photo composite without generative image synthesis. It is intended for artist press-kit assets whose face, hair, body, clothing and other physical characteristics must remain derived from the approved source photograph.

## Invariants

- Creative mode is `REAL_COMPOSITE`.
- The artist source is SHA-256 pinned through `ArtistAsset`.
- AI modification of the artist is denied.
- Physical geometry modification of the artist is denied.
- A protection mask is mandatory.
- The protection mask must be explicitly bound to the exact artist source SHA-256.
- The venue/background layer may be scaled, positioned, faded, opacity-adjusted and conventionally color-integrated.
- The venue layer is masked out of protected artist pixels.
- Output lineage records source, venue, mask and output SHA-256 values.

## Inputs

1. Approved original artist photograph.
2. Approved real venue/background photograph.
3. Grayscale protection mask aligned to the artist photograph: white pixels identify the protected artist; black pixels identify background.
4. Artist registry JSON matching `artistAssetSchema`.

The mask must be generated from the exact artist source used for rendering. Supply that source SHA-256 through `--mask-for-artist-source-sha256`.

## Default visual treatment

- Instagram feed canvas: `1080x1350`.
- Venue opacity: `55` percent.
- Fade: `RIGHT_TO_LEFT`.
- Orange integration tint: `#d96b16`.
- Artist layer remains the base source and is not regenerated.

## Development execution

Use `pnpm dev:deterministic-artist-composite` and pass:

- `--artist`
- `--artist-content-type`
- `--artist-registry`
- `--venue`
- `--venue-content-type`
- `--venue-asset-id`
- `--venue-drive-file-id`
- `--mask`
- `--mask-content-type`
- `--mask-for-artist-source-sha256`
- `--output`

Optional:

- `--canvas` (`1080x1350`, `1080x1920`, `1080x1080`)
- `--opacity` (`0` to `100`, default `55`)
- `--orange-tint` (default `#d96b16`)
- `--fade-direction` (`LEFT_TO_RIGHT`, `RIGHT_TO_LEFT`, `TOP_TO_BOTTOM`, `BOTTOM_TO_TOP`)

Production builds expose the equivalent `pnpm start:deterministic-artist-composite` command.

## Fail-closed conditions

Rendering is blocked for:

- artist source hash mismatch;
- mask/source lineage mismatch;
- missing protection mask;
- AI modification evidence;
- physical geometry modification evidence;
- unapproved retouch evidence;
- revoked artist asset;
- disallowed transform.

## Press-kit compliance workflow

For restricted artist imagery, never route the artist layer through `OpenAiImageEditProvider`, Firefly, generative fill, image-to-image generation or generative expansion. Conventional subject selection may be used only to derive the protection mask; it must not alter source pixels.
