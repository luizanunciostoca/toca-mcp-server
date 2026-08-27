# SUNSET_TEMPLATE_MASTER_V9

Status: `APPROVED_VISUAL_CONTRACT`  
Runtime: `runtimeEligible=false`

## Purpose

Deterministic visual contract for the ninth approved Sunset Story template. A new approved photograph may replace the background, but the composition must remain fixed.

## Canonical reference

- Drive manual: `1seSp3GmQ4alvbzPK35FXkLyLvq1W7XQ7y2LAt6SJctE`
- Drive image: `123mZsKJJwnKXZfl_BuNUniKRk3qujRPE`
- Reference file: `SUNSET_TEMPLATE_MASTER_V9_REFERENCE.jpeg`
- Reference dimensions: `864x1536`
- Reference SHA-256: `0ee7a17d1ca0cf678e63c9f0b8e6bdee8bb6d9de131dff7045caa41040ba55f1`
- Production canvas: `1080x1920` (`9:16`)

## Visual grammar

- Background photograph is `FULL_BLEED/COVER`, with no image box in the final export.
- The outer dashed frame, dashed X, repeated `INSIRA A IMAGEM DE FUNDO`, center image icon, center technical title and center technical instruction are editor-only and must be removed before export.
- Hashtag: `#VemPraToca`, centered in a transparent box with a thin white outline and white sans-serif text.
- Main headline line 1: `Hoje tem um pôr do sol`, centered in white high-contrast editorial serif/Didone.
- Main headline line 2: `inesquecível`, centered in the same editorial serif role at a substantially larger scale.
- CTA: `Garanta seu ingresso`, transparent background, thin white outline, white text.
- Footer order is fixed: `Toca do Morcego → Corona → Red Bull → Morro Digital`.
- Official brand assets only; never redraw or synthesize marks with generative AI.

## Normalized regions (1080x1920)

- hashtag: `x≈390 y≈805 w≈290 h≈58`
- headline line 1: `x≈196 y≈895 w≈688 h≈76`
- headline line 2: `x≈110 y≈968 w≈858 h≈158`
- CTA: `x≈299 y≈1146 w≈470 h≈60`
- footer region: `x≈146 y≈1585 w≈788 h≈145`
- editor-only center guidance: `x≈318 y≈395 w≈450 h≈225`

These positions are normalized approximations derived from the approved reference. Final implementation must be tuned by deterministic visual regression against the reference image, never by creative reinterpretation.

## Rendering rules

1. Place the approved photograph full-bleed.
2. Reposition/crop the photo if a subject conflicts with protected layout regions; never move the template to fit the photo.
3. Apply only broad, localized darkening when needed for hashtag/headline/CTA/footer legibility.
4. Render hashtag, headline, CTA and footer deterministically from pinned typography/assets.
5. Preserve the approved two-line hierarchy, with `inesquecível` as the dominant typographic element.
6. Remove all editor-only framing, X lines, guidance text, icon and technical instruction.
7. Export only after visual QA passes.

## Invariants

The hashtag, two-line headline copy and hierarchy, CTA, typography roles, footer order, white functional treatment and `9:16` canvas are immutable. Components from V1–V8 must not be mixed with V9 without a separately approved `templateId`.

## Quality gate

Required PASS: 1080x1920; full-bleed non-distorted photo; exact hashtag; exact two-line headline; dominant `inesquecível`; intact CTA; official logos in correct order; editor guidance removed; adequate contrast; no AI-reconstructed brand marks; no technical guidance in final output; no cross-template mixing.

## Runtime boundary

This document and its descriptor register an approved visual contract only. They do not authorize PREPARE/PUBLISH or provider mutations. `runtimeEligible=false` remains until renderer integration, exact font/asset pinning and deterministic visual regression are separately approved.
