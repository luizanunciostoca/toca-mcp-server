# Logo Integrity Gate v1

Status: `ACTIVE_CANONICAL` after merge.

Drive authority: `TOCA_OS — LOGO_INTEGRITY_GATE_v1.0`, document ID `1moeBgZrb2UcC_jm0dDvTvTA4kDBXefCZ7EyntogMulU`.

## Canonical Toca white logo

- `brandAssetId`: `BRAND-TOCA-WHITE-V1`
- `brand`: `TOCA_DO_MORCEGO`
- `variant`: `WHITE`
- `driveFileId`: `1kd_Kk6SpAoFexwMgZsk1S1FpGpV-rdef`
- `contentType`: `image/png`
- `integrityMode`: `SHA256_PINNED`
- `sha256`: `87e81cdbd2ef6ae7f9263f4cf3973d1c55ac991da2708b2e15d2674f45f65d5e`
- `aiReconstructionAllowed`: `false`

## Mandatory pipeline

1. Resolve the official BrandAsset from the Creative Truth Registry.
2. Require the exact canonical Toca binding when the requested brand is `TOCA_DO_MORCEGO` / `WHITE`.
3. Fetch bytes from the registered Google Drive file ID.
4. Validate MIME/signature and SHA-256 before use.
5. For AI-generated imagery, generate the visual base without a graphic Toca logo overlay.
6. Composite the exact official asset only after generation with a deterministic compositor.
7. Persist brand asset ID, Drive ID, expected/observed hash and output hash.
8. Require Brand Integrity PASS before review, approval, scheduling or publication.

## Important distinction

Real physical signage that already exists inside a source photograph is part of venue truth and may remain in the photograph. A new graphic overlay logo is different: its pixels must come from the official pinned asset, never from an image model.

## Fail-closed behavior

The system must reject canonical asset drift, hash mismatch, AI-generated logo pixels, non-deterministic logo composition, missing brand lineage, or any request to reconstruct the logo.

## Why

Image generators can create visually similar but non-identical marks. Visual resemblance is not sufficient for brand integrity. The official logo is a binary asset with identity and integrity provenance, and the final graphic brand overlay must therefore derive from those exact bytes.
