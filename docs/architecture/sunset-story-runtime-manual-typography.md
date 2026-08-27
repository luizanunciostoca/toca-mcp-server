# Sunset Story runtime typography and multimodal adapters

Status: implementation candidate; runtime/publication remain fail-closed.

## Authority

The Google Drive manuals for `SUNSET_TEMPLATE_MASTER_V1` through `SUNSET_TEMPLATE_MASTER_V9` are the typography and composition authority for this pipeline. The runtime must not infer a single global font from the institutional typography document or from visual similarity alone.

The manuals define two recurring systems:

- high-contrast editorial serif / Didone for editorial headlines (V1, V4, V5, V6, V7, V8, V9), with Didot as the preferred visual reference and Bodoni Moda as a documented close alternative where stated;
- clean/geometric sans for utility text, support strips and the heavy display headlines of V2/V3, with Montserrat/Poppins/Avenir/Gotham/Helvetica-like references depending on the manual.

`control/creative-standards/sunset-story-typography-policy.v1.json` converts those manual rules into machine-readable role assignments. `src/creative/sunset-story-typography.ts` resolves the role and weight for each template element at render time.

## Runtime behavior

The AI does not select a font family freely. It receives the manual-derived typography profile and may only propose bounded optical scale adjustments. The deterministic SVG renderer resolves the corresponding pinned font role, applies the manual-defined weight/letter spacing, and renders the text itself.

The Vertex Gemini planner receives the exact source-image bytes and MIME type together with the immutable template contract and manual-derived typography. It cannot rewrite copy, move regions, replace assets, change crop or substitute typography roles.

Official Toca/Corona/Red Bull/Morro Digital assets continue to flow through Creative Truth and SHA-256 validation. The ImageMagick rasterizer converts the deterministic SVG result to PNG for downstream visual QA.

## Fail-closed boundary

No exact font binary is currently declared canonical merely from the family names in the manuals. Final runtime enablement requires an authorized font binary for every used role, a pinned SHA-256, and deterministic visual regression against the approved V1-V9 references.

Until those conditions pass:

- `runtimeEligible=false`;
- `storyReady=false`;
- `publicationEligible=false`;
- no PREPARE/PUBLISH or provider mutation is authorized.
