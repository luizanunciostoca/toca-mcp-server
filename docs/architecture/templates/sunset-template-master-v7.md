# SUNSET_TEMPLATE_MASTER_V7

Status: `APPROVED_VISUAL_CONTRACT`  
Runtime: `runtimeEligible=false`

## Purpose

Deterministic visual contract for the seventh approved Sunset Story template. A new approved photograph may replace the background, but the composition must remain fixed.

## Canonical reference

- Drive manual: `1nQZa6yNoJCTCGYXkORCdhgZBMNypSS8l7n3JsdCVuKg`
- Drive image: `1mJAwGR1nX7lEfhKcK4r5g8axdgHh_lV8`
- Reference file: `SUNSET_TEMPLATE_MASTER_V7_REFERENCE.jpeg`
- Reference dimensions: `864x1536`
- Reference SHA-256: `2e178606e1f9cbd0f624d26d658d6652aa7bd3d79c880153e2b2a30f57d4b18b`
- Production canvas: `1080x1920` (`9:16`)

## Visual grammar

- Background photograph is `FULL_BLEED/COVER`, with no image box in the final export.
- The repeated diagonal `INSIRA A IMAGEM DE FUNDO` guidance is editor-only and must be removed before export.
- V7 has no center image-placeholder icon/text; do not inherit that component from V5/V6.
- Three independent support strips remain at the upper-left:
  1. `Venha para a Toca e`
  2. `sinta o dia se despedir`
  3. `de um jeito especial.`
- CTA: `Garanta seu ingresso`, transparent background, thin white outline, white text.
- Main headline: `Viva a melhor` / `vista da ilha!`, centered, white high-contrast editorial serif/Didone.
- Footer order is fixed: `Corona → Toca do Morcego → Red Bull → Morro Digital`.
- Official brand assets only; never redraw or synthesize marks with generative AI.

## Normalized regions (1080x1920)

- support-1: `x=63 y=428 w=456 h=48`
- support-2: `x=63 y=485 w=498 h=49`
- support-3: `x=63 y=544 w=441 h=49`
- CTA: `x=299 y=815 w=483 h=65`
- headline line 1: `x=130 y=933 w=834 h=108`
- headline line 2: `x=162 y=1070 w=760 h=108`
- footer region: `x=130 y=1663 w=819 h=150`

## Rendering rules

1. Place the approved photograph full-bleed.
2. Reposition/crop the photo if a subject conflicts with protected layout regions; never move the template to fit the photo.
3. Apply only broad, localized darkening when needed for CTA/headline/footer legibility.
4. Render support strips, CTA, headline and footer deterministically from pinned typography/assets.
5. Remove all editor-only diagonal guidance.
6. Export only after visual QA passes.

## Invariants

The support-strip copy and positions, CTA, two-line headline, typography roles, footer order, brand colors and `9:16` canvas are immutable. Components from V1–V6 must not be mixed with V7 without a separately approved `templateId`.

## Quality gate

Required PASS: 1080x1920; full-bleed non-distorted photo; exact support copy; intact CTA; exact two-line headline; official logos in correct order; editor guidance removed; adequate contrast; no AI-reconstructed brand marks; no technical guidance in final output; no cross-template mixing.

## Runtime boundary

This document and its descriptor register an approved visual contract only. They do not authorize PREPARE/PUBLISH or provider mutations. `runtimeEligible=false` remains until renderer integration, exact font/asset pinning and deterministic visual regression are separately approved.
