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

Production uses the local `rembg` Python API with `u2net_human_seg` by default. The provider executes through `python3` and does not install or depend on rembg's optional CLI/web stack. Override with:

- `PYTHON_BINARY`
- `REMBG_ARTIST_MODEL`

The production container installs `rembg[cpu]==2.0.86` and `pillow==13.0.0` in the same pip resolution. This intentionally excludes the optional `cli` extra so FastAPI, Gradio, Starlette and python-multipart are not part of the runtime attack surface. Model files are downloaded by rembg when first required and stored under `U2NET_HOME=/tmp/rembg-models` unless deployment configuration overrides it.

## Dependency security and validation

The paired pins are intentional: rembg 2.0.86 permits Pillow 13, while the older rembg constraint excluded it. Pillow 13.0.0 fixes the image-decoder advisories affecting 12.3.0, including [GHSA-8g5g-8vmr-9782](https://github.com/python-pillow/Pillow/security/advisories/GHSA-8g5g-8vmr-9782). See the [rembg 2.0.86 release](https://github.com/danielgatis/rembg/releases/tag/v2.0.86).

The image build runs `pip check`, imports the actual Python API, verifies the `new_session`/`remove` entry points and `session`/`alpha_matting` parameters, and confirms that `u2net_human_seg` remains registered. It also encodes and decodes synthetic RGB pixels as PNG, JPEG and WebP and verifies lossless PNG pixel preservation. These checks do not call `new_session` or `remove`, download model weights, send images to a provider, or prove model inference quality. A real-model segmentation check remains separate and requires an approved model artifact and test input.

The runtime still calls `new_session(model_name)` and `remove(source, session=session, alpha_matting=True)`. No remote session or CLI extra is selected. The original-pixel/alpha-only composition invariant above is unchanged.

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
