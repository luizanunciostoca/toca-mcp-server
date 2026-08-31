# Artist-safe segmentation and background workflow

## Purpose

Separate an approved artist from the photographic background without generative reconstruction, so background layers can be modified independently while the artist remains sourced only from the original press-kit pixels.

## MCP capability

`toca.creative.artist_segment`

Input:

- approved `artistAsset` registry record;
- original artist image as base64;
- original image content type.

Output:

- transparent `artistCutoutBase64` PNG;
- grayscale `protectionMaskBase64` PNG;
- source, cutout and mask SHA-256 lineage;
- `maskForArtistSourceSha256` for direct use by `toca.creative.artist_composite`;
- `nonGenerative=true`;
- `pixelSourcePreserved=true`;
- `ARTIST_INTEGRITY` result.

## Safety invariant

The local segmentation model is used only to estimate alpha. Its RGB output is never trusted. The pipeline extracts only the provider alpha mask, discards provider RGB, then applies that alpha to the approved original artist source with ImageMagick `CopyOpacity`.

Therefore face, hair, skin, body, hands, clothing and accessories in the transparent cutout originate from the approved original image, not from the segmentation model.

## Local segmentation provider

Production uses the local `rembg` CLI with `u2net_human_seg` by default. Override with:

- `REMBG_BINARY`
- `REMBG_ARTIST_MODEL`

The production container installs `rembg[cpu,cli]==2.0.81`. Model files are downloaded by rembg when first required and stored under `U2NET_HOME=/tmp/rembg-models` unless deployment configuration overrides it.

## Recommended creative flow

1. Register/verify the official artist asset and its SHA-256.
2. Call `toca.creative.artist_segment`.
3. Keep `artistCutoutBase64` as the immutable foreground layer.
4. Use the returned protection mask and `maskForArtistSourceSha256` in `toca.creative.artist_composite`.
5. Modify the background independently using real venue imagery and, when policy allows, separate generative atmosphere/effects layers that contain no artist pixels.
6. Composite the original artist cutout last, above all background/effect layers.
7. Preserve output/source/mask hashes in evidence.

## Prohibited

- generative fill on the artist;
- generative relighting of the artist;
- face/body/hair/clothing reconstruction;
- use of segmentation-provider RGB in final artist pixels;
- using a protection mask whose bound source SHA does not match the exact original artist file.
