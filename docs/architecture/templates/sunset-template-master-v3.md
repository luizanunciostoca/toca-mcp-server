# SUNSET_TEMPLATE_MASTER_V3

Status: **APPROVED_VISUAL_CONTRACT**  
Scope: `SUNSET` → `INSTAGRAM` → `STORIES`  
Purpose: deterministic recreation of the third approved Sunset Story layout while replacing only the full-bleed background photograph.

## Canonical references

- Google Drive manual: `TOCA OS — SUNSET_TEMPLATE_MASTER_V3 — Manual Técnico v1.0`
- Drive manual ID: `1ykBBMROCVwZZifQn067QFAuLhQ15lMKnuarplWdFI4c`
- Visual reference file: `SUNSET_TEMPLATE_MASTER_V3_REFERENCE.png`
- Drive visual reference ID: `17iBMe59tJ6Dgc-wSUF7NxljMWrobyGfl`
- Reference SHA-256: `7719597166cb8048c1b5eef065a20b74cc95cf483e6679d847cf04d15f3f657f`
- Reference dimensions: `941×1672`
- Production canvas: `1080×1920`
- Aspect ratio: `9:16`

The background photograph is the only structurally variable element. The top-right Toca symbol, headline box, headline, time, footer, alignments, hierarchy and relative geometry remain fixed.

## Visual grammar

V3 is a distinct visual contract:

- official Toca symbol isolated in the upper-right;
- the editor reference contains a centered `adicionar imagem aqui` placeholder, but production uses no image box: the photo is full-bleed;
- `PÔR DO SOL` is one monumental bold sans-serif line inside a thin white outline rectangle;
- `16:30H ÀS 22H` sits centered directly below the headline without a container;
- there is no CTA and no support copy;
- footer contains only `CORONA → RED_BULL → MORRO_DIGITAL`;
- there is no Toca logo in the footer.

Components from V1/V2 must not be mixed into V3 without a new approved template contract.

## Layer order

1. full-bleed approved real photo;
2. localized contrast treatment if needed;
3. official Toca symbol upper-right;
4. headline outline box;
5. `PÔR DO SOL` text;
6. `16:30H ÀS 22H`;
7. official footer assets;
8. final export.

Editor-only placeholder/icon/text are removed before export.

## Normalized geometry — 1080×1920

### Toca symbol

Approximate reference bbox: `736,79,149,164` on `941×1672`.

Production bbox:

`x≈845, y≈91, w≈171, h≈188`

Use only the official Toca symbol asset in white. No AI reconstruction or approximate redraw.

### Editor-only image placeholder

Reference combined region: `324,542,289,292`.

Normalized combined region:

`x≈372, y≈622, w≈332, h≈335`

Icon region:

`x≈446, y≈622, w≈187, h≈179`

Editor text region:

`x≈372, y≈838, w≈332, h≈119`

These coordinates document the approved reference only. Production contains no placeholder box or centered placeholder text; the real photo covers the entire canvas.

### Headline box

Text: `PÔR DO SOL`

Production outline box:

`x≈64, y≈1300, w≈953, h≈167`

Approximate text region:

`x≈109, y≈1309, w≈877, h≈130`

Rules:

- single line only;
- uppercase;
- bold/extra-bold sans-serif;
- white text;
- transparent fill;
- thin white rectangle outline;
- centered horizontally and vertically;
- circumflex on `Ô` must remain clear;
- do not embed the Toca symbol inside an `O` — that is V2-only behavior.

The exact font asset must be pinned before runtime eligibility. A Montserrat/Gotham/Helvetica-like heavy sans can be evaluated, but runtime substitution is forbidden once pinned.

### Time

Text: `16:30H ÀS 22H`

Production text bbox approximately:

`x≈282, y≈1493, w≈529, h≈70`

Rules:

- white clean sans-serif;
- regular/medium;
- no outline box or fill container;
- centered below headline;
- order must remain headline then time.

### Footer

Required order:

1. `CORONA`
2. `RED_BULL`
3. `MORRO_DIGITAL`

Combined region approximately:

`x≈204, y≈1700, w≈668, h≈110`

Approximate individual boxes:

- Corona: `x≈204, y≈1711, w≈171, h≈98`
- Red Bull: `x≈494, y≈1713, w≈156, h≈95`
- Morro Digital: `x≈736, y≈1700, w≈137, h≈110`

All assets must be official white brand files. Optical balance takes precedence over forcing identical widths.

## Protected layout regions

On `1080×1920`:

- Toca symbol: `x=845..1016`, `y=91..279`
- headline: `x=64..1017`, `y=1300..1467`
- time: `x=282..811`, `y=1493..1563`
- footer: `x=204..872`, `y=1700..1810`

Resolve subject conflicts by changing the photo crop/repositioning, never by moving template geometry.

## Background and contrast

Production uses `FULL_BLEED_PHOTO / COVER`, never `contain`, never distortion.

Do not apply a global black filter by default. Local feathered darkening is allowed where required:

- top-right symbol zone: roughly `10–25%` black;
- headline/time zone: roughly `15–35%`;
- footer: roughly `15–35%`.

Avoid visible rectangular overlays.

## Invariants

The following are fixed:

- canvas `1080×1920` / `9:16`;
- Toca symbol upper-right;
- one-line outlined `PÔR DO SOL` headline;
- time below headline without box;
- no CTA;
- no support copy;
- footer with exactly Corona, Red Bull, Morro Digital;
- no Toca footer logo;
- white graphic elements;
- layout coordinates and hierarchy.

## New-photo adaptation

`approved real photo → crop 9:16 → reposition photo → protected-region check → localized contrast if needed → fixed V3 renderer → official assets → remove editor placeholder → quality gate → human approval`

The photo adapts to the template. The template does not adapt to the photo.

## Quality gate

A derivative may enter `PENDING_REVIEW` only when all pass:

- exact `1080×1920` output;
- 9:16;
- full-bleed undistorted photo;
- editor placeholder fully removed;
- official Toca symbol correct;
- `PÔR DO SOL` exactly correct and on one line;
- correct outline box preserved;
- `16:30H ÀS 22H` exactly correct and without a box;
- footer contains exactly Corona, Red Bull, Morro Digital in that order;
- official assets only;
- no AI-reconstructed brand assets;
- sufficient contrast;
- essential subject not covered;
- no CTA;
- no support copy;
- no technical/editor text in final output.

## Deterministic production requirement

The final Story must not be generated from scratch by an image model. Production path:

`REAL_PHOTO + CROP_ENGINE + FIXED_V3_RENDERER + OFFICIAL_TOCA_SYMBOL + HEADLINE_BOX_AND_TEXT + TIME + OFFICIAL_FOOTER + LOCAL_CONTRAST → FINAL_PNG`

AI may assist with photo selection, crop analysis, protected-subject detection and contrast assessment. Typography, brand assets, geometry and exact copy must be rendered deterministically.

## Runtime and publication boundary

`runtimeEligible=false` until font/assets are pinned, renderer integration is explicit, deterministic regression tests pass, and integration is approved.

Visual approval does not authorize publication. Existing TOCA OS Brand Gate, Quality Gate, Policy, Approval, immutable descriptor/hash and exact-approved-asset publication rules continue unchanged.
