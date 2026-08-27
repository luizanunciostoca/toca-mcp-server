# SUNSET_TEMPLATE_MASTER_V8

Status: `APPROVED_VISUAL_CONTRACT`  
Runtime: `runtimeEligible=false`

## Purpose

Deterministic visual contract for the eighth approved Sunset Story template. A new approved photograph may replace the background, but the composition must remain fixed.

## Canonical reference

- Drive manual: `1UohaVZnzvzbQAa-50wZf_CG6U0jngmo6eMp5zKSNXKI`
- Drive image: `1IiayW0SlsoxDqW9iQs7YwPQfCorraBqD`
- Reference file: `SUNSET_TEMPLATE_MASTER_V8_REFERENCE.jpeg`
- Reference dimensions: `864x1536`
- Reference SHA-256: `766429270261ae7d99c7f9081c12a6ab6ca7565b76193c5ab43fe223eea95ed8`
- Production canvas: `1080x1920` (`9:16`)

## Visual grammar

- Background photograph is `FULL_BLEED/COVER`, with no image box in the final export.
- The dashed diagonal X, repeated `INSIRA A IMAGEM DE FUNDO`, center image icon, technical title and explanatory instruction are editor-only and must be removed before export.
- CTA: `Garanta seu ingresso`, transparent background, thin white outline, white text, centered above the headline.
- Main headline: `PÔR DO SOL` / `na Toca`, centered, white high-contrast editorial serif/Didone.
- Three independent support strips remain at the left below the headline:
  1. `Vem curtir um`
  2. `dia inesquecível`
  3. `na Toca!`
- Footer order is fixed: `Corona → Toca do Morcego → Red Bull → Morro Digital`.
- Official brand assets only; never redraw or synthesize marks with generative AI.

## Normalized regions (1080x1920)

- CTA: `x=327 y=329 w=441 h=57`
- headline `PÔR DO SOL`: `x=179 y=430 w=722 h=112`
- subheadline `na Toca`: `x=341 y=536 w=410 h=106`
- support-1: `x=89 y=802 w=350 h=49`
- support-2: `x=89 y=855 w=401 h=50`
- support-3: `x=89 y=911 w=222 h=49`
- editor-only instruction core: approximately `x=264 y=1115 w=552 h=290`
- footer region: `x=170 y=1690 w=744 h=128`

## Rendering rules

1. Place the approved photograph full-bleed.
2. Reposition/crop the photo if a subject conflicts with protected layout regions; never move the template to fit the photo.
3. Apply only broad, localized darkening when needed for CTA/headline/support/footer legibility.
4. Render CTA, headline, subheadline, support strips and footer deterministically from pinned typography/assets.
5. Preserve the three support strips as independent white bands and retain their exact approved line breaks.
6. Remove the dashed X, repeated guidance, center icon and all technical instructional text before export.
7. Export only after visual QA passes.

## Invariants

The CTA, two-line headline, support-strip copy and positions, typography roles, footer order, white brand treatment and `9:16` canvas are immutable. Components from V1–V7 must not be mixed with V8 without a separately approved `templateId`.

## Quality gate

Required PASS: 1080x1920; full-bleed non-distorted photo; exact CTA; exact headline/subheadline; three fixed support strips; official logos in correct order; all editor guidance removed; adequate contrast; no AI-reconstructed brand marks; no technical guidance in final output; no cross-template mixing.

## Runtime boundary

This document and its descriptor register an approved visual contract only. They do not authorize PREPARE/PUBLISH or provider mutations. `runtimeEligible=false` remains until renderer integration, exact font/asset pinning and deterministic visual regression are separately approved.
