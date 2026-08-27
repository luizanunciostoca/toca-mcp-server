# SUNSET_TEMPLATE_MASTER_V6

Status: `APPROVED_VISUAL_CONTRACT`
Runtime: `runtimeEligible=false`

## Purpose

Deterministic visual contract for the sixth approved Sunset Story template. A new approved photograph may replace the background, but the composition must remain fixed.

## Canonical reference

- Drive manual: `1lFkBQZuyMBtQ-sdXuQiPJHhLIZXJPKzpU8d56zJkCCs`
- Drive image: `1YLd6ylU2Gmd7xYxt2Nby1oONxffqqdhr`
- Reference file: `SUNSET_TEMPLATE_MASTER_V6_REFERENCE.jpeg`
- Reference dimensions: `864x1536`
- Reference SHA-256: `6f1196b8aa1f6c47d6d7b5445511afbd540427cfd9ec9304059d2d08110ac8c0`
- Production canvas: `1080x1920` (`9:16`)

## Visual grammar

- Background photograph is `FULL_BLEED/COVER`, with no image box in the final export.
- Editor-only placeholder/icon and `adicionar imagem aqui` guidance must be removed before export.
- Four independent white support strips remain at the upper-left:
  1. `O pôr do sol na Toca`
  2. `é aquele momento que`
  3. `você vai guardar`
  4. `pra sempre.`
- CTA: `Garanta seu ingresso`, transparent background, thin white outline, white text.
- Main headline: `Vem viver essa` / `experiência única!`, centered, white high-contrast editorial serif/Didone.
- Footer order is fixed: `Corona → Toca do Morcego → Red Bull → Morro Digital`.
- Official brand assets only; never redraw or synthesize marks with generative AI.

## Normalized regions (1080x1920)

- support-1: `x=79 y=140 w=463 h=50`
- support-2: `x=79 y=198 w=521 h=49`
- support-3: `x=79 y=254 w=393 h=48`
- support-4: `x=79 y=308 w=283 h=49`
- editor-only placeholder core: `x=471 y=660 w=139 h=126`
- CTA: `x=324 y=1203 w=426 h=58`
- headline combined region: `x=161 y=1296 w=783 h=208`
- footer region: `x=174 y=1674 w=715 h=130`

## Rendering rules

1. Place the approved photograph full-bleed.
2. Reposition/crop the photo if a subject conflicts with protected text regions; never move the template to fit the photo.
3. Apply only local darkening when necessary for white text/logo legibility.
4. Render support strips, CTA, headline and footer deterministically from pinned typography/assets.
5. Preserve the four support strips as independent white bands and retain their approved line breaks/emphasis.
6. Remove all editor-only placeholder guidance.
7. Export only after visual QA passes.

## Invariants

The four support-strip positions and copy, CTA, two-line headline, typography roles, footer order, white brand treatment and `9:16` canvas are immutable. Components from V1–V5 must not be mixed with V6 without a separately approved `templateId`.

## Quality gate

Required PASS: 1080x1920; full-bleed non-distorted photo; four fixed support strips; intact CTA; intact two-line headline; official logos in correct order; placeholder removed; adequate contrast; no AI-reconstructed brand marks; no technical guidance in final output; no cross-template mixing.

## Runtime boundary

This document and its descriptor register an approved visual contract only. They do not authorize PREPARE/PUBLISH or provider mutations. `runtimeEligible=false` remains until renderer integration, exact font/asset pinning and deterministic visual regression are separately approved.
