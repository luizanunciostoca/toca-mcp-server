# SUNSET_TEMPLATE_MASTER_V1

Status: **APPROVED_VISUAL_CONTRACT**  
Scope: `SUNSET` → `INSTAGRAM` → `STORIES`  
Purpose: deterministic recreation of the approved layout while replacing only the full-bleed background photograph.

## Canonical references

- Google Drive manual: `TOCA OS — SUNSET_TEMPLATE_MASTER_V1 — Manual Técnico v1.0`
- Drive manual ID: `1TIyMvn4w_WANPjD7jICSWjsUBtoU7nA6oTc3GjJJ8FY`
- Visual reference file: `SUNSET_TEMPLATE_MASTER_V1_REFERENCE.jpg`
- Drive visual reference ID: `1uABkuHwKm5PNRNw5TP38Yzt4s4GTiwH_`
- Reference SHA-256: `b1ffa818a923c3ea94f43a10beb8ee3034d0661bdc437e937a7558042cb905a0`
- Reference dimensions: `864×1536`
- Production canvas: `1080×1920`
- Aspect ratio: `9:16`

The background photograph is the only structurally variable element. The layout, hierarchy, alignment, typography roles, copy, boxes, CTA, footer, logo order and relative proportions are fixed.

## Production rule

A new photograph must fill the entire `1080×1920` canvas with `cover/full-bleed` behavior. It may be cropped and repositioned but must never be distorted. If the subject conflicts with the fixed layout, reposition the photo inside the crop; do not move the template.

Editor-only placeholders such as `INSIRA A IMAGEM DE FUNDO`, repeated placeholder text, photo icons, guide lines or grids must be removed before final export.

## Layer order

1. full-bleed approved photograph;
2. localized contrast treatment only when required;
3. subtle template arcs/circles;
4. time box;
5. `PÔR DO SOL` headline;
6. `na Toca` subheadline;
7. three independent editorial support strips;
8. `Garanta seu ingresso` CTA;
9. official brand footer assets;
10. final export.

## Fixed safe areas on the 1080×1920 canvas

| Element | Coordinates / region |
| --- | --- |
| Time | `x=345..743`, `y=208..291` |
| Main headline | `x=80..1005`, `y=350..485` |
| `na Toca` | `x=255..825`, `y=495..640` |
| Editorial support | `x=81..556`, `y=888..1112` |
| CTA | `x=83..559`, `y=1198..1276` |
| Brand footer | `y=1650..1810` |

Faces, products, hands, horizon lines and other essential photographic subjects should not occupy these areas. Resolve conflicts by changing the crop, never by shifting template elements.

## Time box

- Text: `16:30H ÀS 22H`
- Box: `x=345`, `y=208`, `w=398`, `h=83`
- Alignment: centered
- Background: transparent
- Stroke: white, approximately `1–2px`
- Text: `#FFFFFF`
- Role: clean sans-serif, regular/medium/semibold according to the approved reference

## Main headline

- Text: `PÔR DO SOL`
- Color: `#FFFFFF`
- Family role: high-contrast editorial Didone
- Preferred family: Didot-like
- Runtime fallback candidate: Bodoni Moda
- Position: approximately `x=90..1000`, `y=350..485`
- One line only
- Uppercase
- Center aligned

The exact production font asset must be pinned before declaring a renderer pixel-stable. Font substitution at runtime is not allowed after pinning.

## Subheadline

- Text: `na Toca`
- Color: `#FFFFFF`
- Same Didone family as the headline
- Region: approximately `x=255..825`, `y=495..640`
- Center aligned

## Editorial support strips

The support text is rendered as three independent white strips, not a single container.

### Strip 1
- Text: `Vem curtir um`
- Box: `x=81`, `y=888`, `w=424`, `h=66`

### Strip 2
- Text: `dia inesquecível`
- Box: `x=81`, `y=965`, `w=475`, `h=68`

### Strip 3
- Text: `na Toca!`
- Box: `x=81`, `y=1044`, `w=260`, `h=66`

Shared style:
- Background: `#FFFFFF` / `#F7F7F5`
- Text: `#111111`
- Role: geometric/semi-humanist sans-serif
- Weight: semibold/bold

## CTA

- Text: `Garanta seu ingresso`
- Box: `x=83`, `y=1198`, `w=476`, `h=78`
- Background: transparent
- Border: thin white outline
- Text: `#FFFFFF`
- Role: clean sans-serif regular/medium
- Vertical and horizontal centering required

The CTA must never be converted into a white filled button for this template.

## Brand footer

Required order from left to right:
1. `TOCA_DO_MORCEGO`
2. `CORONA`
3. `RED_BULL`
4. `MORRO_DIGITAL`

All logos must be inserted from official brand assets. AI recreation, tracing or generative replacement is prohibited.

Approximate optical centers on the 1080 px canvas:
- Toca: `x≈184`
- Corona: `x≈405`
- Red Bull: `x≈650`
- Morro Digital: `x≈873`

Footer region: approximately `y=1650..1810`.

Optical balance takes precedence over forcing identical mathematical widths.

## Background treatment

Do not apply an automatic global orange or black filter. Preserve the real photograph.

Localized contrast treatment is allowed when required:
- headline zone: black overlay approximately `10–30%`;
- CTA zone: `0–25%`;
- logo footer: `15–35%` when background luminance is too high.

Use broad feathering and avoid visible rectangular dark patches.

## Subtle decorative arcs

The approved reference contains extremely subtle line arcs/circles. When used:
- white outline;
- approximately `1px`;
- opacity around `8–15%`;
- must not compete with the photograph.

## Invariants

The following are fixed and may not be reinterpreted per image:
- canvas and aspect ratio;
- time position and box proportions;
- headline and subheadline position/proportions;
- three editorial strip positions;
- CTA position and proportions;
- footer region and brand order;
- text content;
- typography roles;
- alignments;
- hierarchy;
- final white/black element colors defined by this contract.

## New-photo adaptation procedure

`new approved photo → 9:16 crop → internal photo repositioning → subject/horizon check → localized contrast → fixed template → official logos → quality gate → human approval`

The photo is adapted to the template. The template is not adapted to the photo.

## Quality gate

A derivative may enter `PENDING_REVIEW` only when all of the following pass:
- final canvas is exactly `1080×1920`;
- final aspect ratio is `9:16`;
- background photograph is full-bleed;
- photograph is not distorted;
- headline/subheadline are white and legible;
- correct typography roles are used;
- fixed layout coordinates are preserved;
- essential subject is not covered;
- support copy is legible;
- CTA is legible;
- all required logos are official source assets;
- logo order is correct;
- editor placeholder is removed;
- no logo is AI-reconstructed;
- no technical/editor text remains in the final export.

## Deterministic production requirement

This template should not be recreated as a new generative image for each Story. The production path is deterministic:

`real photo + crop engine + fixed renderer + text + boxes + CTA + official logos + local contrast → final PNG`

AI may assist with source-photo selection, crop analysis, protected-subject detection and contrast assessment. Text, logo insertion, coordinates and typography must be deterministic.

## Publication boundary

Visual approval does not authorize publication. The final creative remains subject to existing TOCA OS Brand Gate, Quality Gate, Policy, Approval, immutable descriptor/hash and exact-approved-asset publication rules.

## Library evolution

This is the first deterministic master template. Each additional approved Sunset layout should receive the same package:
1. immutable visual reference;
2. technical manual;
3. machine-readable descriptor;
4. SHA-256 lineage;
5. renderer integration only after the visual contract is approved.

The runtime must eventually select an explicit `templateId`; it must not reinterpret composition from prose or from the source photograph.
