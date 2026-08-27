# SUNSET_TEMPLATE_MASTER_V2

Status: **APPROVED_VISUAL_CONTRACT**  
Scope: `SUNSET` → `INSTAGRAM` → `STORIES`  
Purpose: deterministic recreation of the second approved Sunset layout while replacing only the full-bleed background photograph.

## Canonical references

- Google Drive manual: `TOCA OS — SUNSET_TEMPLATE_MASTER_V2 — Manual Técnico v1.0`
- Drive manual ID: `1eAPaQywMVWkNOSZbBtzCUy5dkO_mzZJaIafrIV1_67U`
- Visual reference file: `SUNSET_TEMPLATE_MASTER_V2_REFERENCE.png`
- Drive visual reference ID: `1UMBo_aSOojs95VOFw1kKH_p_cysih7LM`
- Reference SHA-256: `da4d13a4e71388eb0f0edf8f90023c5b9d352d13c2a0d5d4e5c116e11c5a4d48`
- Reference dimensions: `941×1672`
- Production canvas: `1080×1920`
- Aspect ratio: `9:16`

The background photograph is the only structurally variable element. The typographic composition, time box, embedded Toca symbol, footer order, hierarchy and relative proportions are fixed.

## Production rule

A new approved photograph must fill the complete `1080×1920` canvas using `cover/full-bleed`. It may be cropped and repositioned but must never be distorted. The black reference background is editor/reference-only; it is replaced entirely by the production photograph.

If the subject conflicts with the fixed layout, reposition the photo inside the crop. Do not move the template.

## Visual grammar

This is a monumental typographic template. Layer order:

1. approved full-bleed photograph;
2. localized contrast treatment only when required;
3. time box;
4. `PÔR DO` display line;
5. monumental `SOL` display line;
6. official Toca symbol embedded inside the counter of the `O` in `SOL`;
7. official footer logos;
8. final export.

There is **no CTA** and **no support copy** in this template.

## Fixed regions — 1080×1920

| Element | Region |
| --- | --- |
| Time box | `x=489, y=240, w=523, h=96` |
| `PÔR DO` | `x=76, y=388, w=953, h=178` |
| `SOL` | `x=62, y=598, w=982, h=425` |
| Embedded Toca symbol | `x=523, y=752, w=155, h=152` |
| Footer | approximately `y=1660..1810` |

## Time box

- Text: `16:30H ÀS 22H`
- Box: `x=489`, `y=240`, `w=523`, `h=96`
- Background: transparent
- Stroke: `#FFFFFF`, approximately `1–2px`
- Text: `#FFFFFF`
- Alignment: centered
- Font role: clean geometric sans, regular/medium

## Display line 1

- Text: `PÔR DO`
- Region: `x=76`, `y=388`, `w=953`, `h=178`
- Color: `#FFFFFF`
- Alignment: centered
- Font role: heavy geometric/grotesk sans
- Weight: ExtraBold/Black
- Tracking: compact
- One line only

## Display line 2

- Text: `SOL`
- Region: `x=62`, `y=598`, `w=982`, `h=425`
- Color: `#FFFFFF`
- Alignment: centered
- Same family as display line 1
- Weight: ExtraBold/Black
- `SOL` must remain monumental and occupy nearly the full useful width.

## Embedded Toca symbol

- Region: `x=523`, `y=752`, `w=155`, `h=152`
- Position: optically centered inside the counter of the `O` in `SOL`
- Source: official Toca brand asset only
- Preferred color for this contract: `#FFFFFF`
- AI recreation, tracing, invented bat glyphs or approximate replacements are forbidden.

The embedded symbol is part of the headline composition. It is not a footer substitute to be moved elsewhere.

## Footer

Required order left to right:

1. `CORONA`
2. `RED_BULL`
3. `MORRO_DIGITAL`

Approximate normalized regions:

- Corona: `x≈204`, `y≈1680`, `w≈191`, `h≈113`
- Red Bull: `x≈477`, `y≈1695`, `w≈161`, `h≈94`
- Morro Digital: `x≈692`, `y≈1680`, `w≈149`, `h≈98`

All footer marks use official white source assets. Optical balance takes precedence over forcing identical mathematical widths.

No separate Toca logo is added to the footer because the Toca symbol is already embedded in the `O` of `SOL`.

## Photography contract

The preferred new photo is a real approved vertical asset whose principal subject occupies the center-to-lower portion of the frame, leaving enough visual structure for the oversized typography.

The subject may appear behind portions of the display typography when this preserves the approved visual grammar. Arms, hair, silhouettes and secondary details may cross behind letterforms. A face, product or critical subject must not become unreadable or fully hidden by the typography.

Resolve conflicts by changing the crop/repositioning of the photo, not the template coordinates.

## Typography

The display role is a heavy geometric/grotesk sans visually close to Montserrat Black/ExtraBold. The exact production font file must be pinned before `runtimeEligible=true`.

The time role is a clean sans in regular/medium weight. Font substitution after runtime pinning is prohibited.

## Contrast

No global color filter is mandatory. Preserve the natural photograph.

Localized black contrast treatment may be applied when necessary:

- time/headline zones: approximately `10–35%` black;
- footer: approximately `15–40%` black when background luminance is too high.

Use broad feathering. Visible rectangular dark patches are not allowed.

## Invariants

The following may not be reinterpreted per photograph:

- canvas `1080×1920`;
- aspect ratio `9:16`;
- time position and text;
- two-line structure `PÔR DO` / `SOL`;
- monumental scale of `SOL`;
- embedded official Toca symbol inside the `O`;
- absence of CTA;
- absence of support copy;
- footer containing only Corona, Red Bull and Morro Digital in that order;
- white graphic elements;
- fixed hierarchy and approximate coordinates;
- full-bleed photo background.

## New-photo adaptation procedure

`approved real photo → crop to 9:16 → reposition photo → subject check → localized contrast if needed → fixed time box → fixed PÔR DO → fixed SOL → official Toca symbol inside O → official footer logos → quality gate → human approval`

The photo is adapted to the template. The template is not adapted to the photo.

## Quality gate

A derivative may enter `PENDING_REVIEW` only when all required checks pass:

- final canvas is exactly `1080×1920`;
- final aspect ratio is `9:16`;
- background photo is full-bleed and not distorted;
- `PÔR DO` and `SOL` are white, legible and in the approved regions;
- `SOL` preserves the monumental scale;
- time text is exactly `16:30H ÀS 22H` inside the approved outline box;
- official Toca symbol is optically centered in the `O` of `SOL`;
- no logo/symbol is AI-recreated;
- footer contains only Corona, Red Bull and Morro Digital in the approved order;
- no CTA was added;
- no support copy was added;
- no editor placeholder, guide, grid or technical text remains in final export;
- essential photographic subject remains recognizable;
- photo and brand-asset lineage is complete.

## Deterministic production requirement

This template must not be regenerated as a fresh synthetic graphic for every Story. Production path:

`real photo + crop engine + fixed renderer + deterministic type + embedded official Toca symbol + official footer assets + local contrast → final PNG`

AI may assist in selecting the source photo, crop analysis, subject detection and contrast assessment. Text, logos/symbols, coordinates and pinned typography must be deterministic.

## Publication boundary

`APPROVED_VISUAL_CONTRACT` does not authorize external publication. The final Story remains subject to existing Brand Gate, Quality Gate, Policy, Approval, immutable asset descriptor/hash and exact-approved-asset publication requirements.

## Library rule

`SUNSET_TEMPLATE_MASTER_V2` is a distinct templateId and must coexist with `SUNSET_TEMPLATE_MASTER_V1`. Components from V1 and V2 must not be mixed unless a separate visual contract is explicitly approved.
