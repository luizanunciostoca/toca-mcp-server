# SUNSET_TEMPLATE_MASTER_V4

Status: **APPROVED_VISUAL_CONTRACT**  
Scope: `SUNSET` → `INSTAGRAM` → `STORIES`  
Purpose: deterministic recreation of the approved V4 layout while replacing only the full-bleed background photograph.

## Canonical references

- Google Drive manual: `TOCA OS — SUNSET_TEMPLATE_MASTER_V4 — Manual Técnico v1.0`
- Drive manual ID: `1MAYim7kFREF1F5x5xnqelPZB8eKX9TRAOstYIPJHNKM`
- Visual reference file: `SUNSET_TEMPLATE_MASTER_V4_REFERENCE.jpeg`
- Drive visual reference ID: `1ZVe1Od9ZXNrYybV9VGB9M6E8etvAm4Si`
- Reference SHA-256: `38fe256a82af8a762017913a34a382b376fae09d6e065ac17a1cb6657d2b2822`
- Reference dimensions: `864×1536`
- Production canvas: `1080×1920`
- Aspect ratio: `9:16`

## Contract

The background photograph is the only structurally variable element. It must fill the whole production canvas using `FULL_BLEED/COVER`, with cropping/repositioning allowed and distortion prohibited. If a subject conflicts with fixed layout regions, reposition the photograph instead of moving the template.

The black reference background, placeholder icon, `adicionar imagem aqui`, and diagonal `INSIRA A IMAGEM DE FUNDO` marks are editor-only guidance and must not appear in the final Story.

## Fixed composition

Layer order:

1. approved real photo;
2. localized contrast treatment if required;
3. warm/orange bottom gradient;
4. two-line editorial headline;
5. outline CTA;
6. official four-brand footer;
7. final export.

### Headline

Fixed copy:

- `Temos drinks especiais`
- `para o Pôr do Sol`

Requirements:

- white high-contrast editorial serif/Didone role;
- center aligned;
- line break is invariant;
- approximate normalized region: `x=101, y=1280, w=873, h=194`.

### CTA

- Text: `Compre seu ingresso`
- Approximate box: `x=289, y=1520, w=490, h=73`
- Transparent fill
- Thin white outline
- White centered text
- Filled CTA is not allowed for this template.

### Footer

Required order:

1. `TOCA_DO_MORCEGO`
2. `CORONA`
3. `RED_BULL`
4. `MORRO_DIGITAL`

Approximate footer region: `x=145, y=1678, w=776, h=154`.
Approximate optical centers: Toca `x≈189`, Corona `x≈403`, Red Bull `x≈641`, Morro Digital `x≈852`.

Only official source assets may be used. AI reconstruction or generative tracing of any brand asset is prohibited.

## Editor-only placeholder geometry

Reference 864×1536:

- image icon: approximately `x=370, y=432, w=108, h=103`;
- placeholder text: approximately `x=307, y=564, w=233, h=82`.

Normalized 1080×1920:

- image icon: approximately `x=463, y=540, w=135, h=129`;
- placeholder text: approximately `x=384, y=705, w=291, h=103`.

All placeholder elements are removed before final export.

## Warm bottom gradient

A subtle warm/orange lower gradient is part of V4. It should help protect readability of headline, CTA and footer while keeping the underlying photograph visible. It must use a broad feather and must not become a hard rectangular block or a fully opaque orange field.

## Protected regions

- `HEADLINE`: approximately `x=101..974`, `y=1280..1474`
- `CTA`: approximately `x=289..779`, `y=1520..1593`
- `FOOTER`: approximately `x=145..921`, `y=1678..1832`

Essential faces, products, hands and other critical photographic subjects should remain outside those regions whenever possible.

## Invariants

The following may not be reinterpreted per image:

- canvas/aspect ratio;
- two-line headline copy and line break;
- headline position and hierarchy;
- CTA position/style;
- footer region;
- footer brand order;
- white text/brand treatment;
- warm bottom gradient role;
- typography roles.

## Deterministic production path

`REAL_PHOTO → CROP_9_16 → SUBJECT_CHECK → LOCAL_CONTRAST → WARM_BOTTOM_GRADIENT → FIXED_HEADLINE → FIXED_CTA → OFFICIAL_FOOTER_ASSETS → QUALITY_GATE → HUMAN_APPROVAL → FINAL_PNG`

## Quality gate

A derivative may enter `PENDING_REVIEW` only when all pass:

- exact 1080×1920 canvas;
- 9:16 ratio;
- full-bleed undistorted photo;
- placeholder icon/text removed;
- diagonal editor guidance removed;
- headline remains two lines and legible;
- CTA matches outline contract;
- official logos only;
- footer order correct;
- no AI-recreated marks;
- no technical/editor text;
- warm bottom gradient remains subtle;
- essential subject is not obscured.

## Publication boundary

Visual approval does not authorize `PREPARE` or `PUBLISH`. This template remains runtime-ineligible until explicit renderer integration, pinned fonts/assets, deterministic regression tests, and existing Brand/Quality/Policy/Approval gates pass.

V4 is a separate contract from V1, V2 and V3. Components must not be mixed without a newly approved `templateId`.
