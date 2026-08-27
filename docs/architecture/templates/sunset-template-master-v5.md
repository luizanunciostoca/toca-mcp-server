# SUNSET_TEMPLATE_MASTER_V5

Status: `APPROVED_VISUAL_CONTRACT`
Runtime: `runtimeEligible=false`

## Purpose

Deterministic visual contract for the fifth approved Sunset Story template. A new approved photograph may replace the background, but the composition must remain fixed.

## Canonical reference

- Drive manual: `11U_zPmQIEApQQYEzOJjrAp-q82rYLG9SeELyYXaRK4M`
- Drive image: `1qDQBcJYllOMin2nqdfA70MNz7e9K3LmV`
- Reference file: `SUNSET_TEMPLATE_MASTER_V5_REFERENCE.png`
- Reference dimensions: `941x1672`
- Reference SHA-256: `4addb6828fdc37e1a90468c938102f2c576053cdd3a5e6d789a12e71c34a766a`
- Production canvas: `1080x1920` (`9:16`)

## Visual grammar

- Background photograph is `FULL_BLEED/COVER`, with no image box in the final export.
- Editor-only placeholder/icon must be removed before export.
- Three independent white support strips remain at the upper-left:
  1. `A Toca tem o`
  2. `melhor pôr do sol`
  3. `que você verá!`
- CTA: `Garanta seu ingresso`, transparent background, thin white outline, white text.
- Main headline: `PÔR DO SOL` / `na Toca`, centered, white high-contrast editorial serif/Didone.
- Footer order is fixed: `Corona → Toca do Morcego → Red Bull → Morro Digital`.
- Official brand assets only; never redraw or synthesize marks with generative AI.

## Normalized regions (1080x1920)

- support-1: `x=87 y=322 w=337 h=48`
- support-2: `x=87 y=379 w=442 h=49`
- support-3: `x=87 y=436 w=375 h=49`
- editor-only placeholder region: `x=390 y=665 w=295 h=277`
- CTA: `x=312 y=1194 w=457 h=67`
- headline `PÔR DO SOL`: `x=164 y=1280 w=762 h=119`
- subheadline `na Toca`: `x=328 y=1415 w=430 h=99`
- footer region: `x=191 y=1705 w=708 h=119`

## Rendering rules

1. Place the approved photograph full-bleed.
2. Reposition/crop the photo if a subject conflicts with protected text regions; never move the template to fit the photo.
3. Apply only local darkening when necessary for white text/logo legibility.
4. Render support strips, CTA, headline and footer deterministically from pinned typography/assets.
5. Remove all editor-only placeholder guidance.
6. Export only after visual QA passes.

## Invariants

The support-strip positions and copy, CTA, headline, typography roles, footer order, brand colors and `9:16` canvas are immutable. Components from V1–V4 must not be mixed with V5 without a separately approved `templateId`.

## Quality gate

Required PASS: 1080x1920; full-bleed non-distorted photo; fixed support copy; intact CTA; intact headline; official logos in correct order; placeholder removed; adequate contrast; no AI-reconstructed brand marks; no technical guidance in final output; no cross-template mixing.

## Runtime boundary

This document and its descriptor register an approved visual contract only. They do not authorize PREPARE/PUBLISH or provider mutations. `runtimeEligible=false` remains until the renderer integration, exact font/asset pinning and deterministic visual regression are separately approved.
