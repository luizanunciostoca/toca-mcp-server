# Sunset Stories — QA Hardening v2.1

Status: **ACTIVE CANONICAL HARDENING**  
Date: **2026-09-02**

## Authority and precedence

For Sunset Story production, use this order:

1. Google Drive `TOCA_OS — STORY_CREATIVE_STANDARD_SUNSET` hardening v2.1.
2. `control/creative-standards/sunset-story-standard.v1.json` with `standardVersion=2.1`.
3. Exact template contracts in `control/creative-standards/templates/sunset-template-master.v1..v9.json`.
4. Runtime gates in `src/creative/sunset-story-*`.
5. Historical architecture/template notes only as supporting evidence.

If an older Markdown note, flattened raster, legacy master or historical reference conflicts with v2.1, **v2.1 wins**. Do not propagate legacy footer order or legacy semantic classification from historical files.

## Fail-closed production contract

A Story may not become `IN_REVIEW`, `STORY_READY`, `APPROVED` or equivalent until all machine gates below pass.

### Editorial asset gate

- `AMBIENCE`: architecture, venue ambience, scenery or view must dominate. A dominant portrait/lifestyle asset is rejected.
- `MUSIC`: requires DJ/performance or explicit `DJ_GEAR` evidence.
- `DRINKS`: requires a drink plus experience/service/venue context when the brief is experiential. Product-only/packshot crops are rejected.
- `SCENERY`: requires place/view evidence and preserves sun, horizon and sun reflection when present.

### Protected-feature gate

Image analysis must explicitly audit:

- `FACE`
- `EYES`
- `HANDS`
- `DRINK_PRODUCT`
- `SUN`
- `HORIZON`
- `SUN_REFLECTION`
- `LOGO_EXISTING`
- `DJ_GEAR`
- `VENUE_FEATURE`

The crop planner must preserve those features. The exact output safety gate independently verifies that final text, shapes and brand assets do not cover them.

### Template geometry gate

`template_id` means exact contract geometry. There is no runtime state called “inspired by Vx”. If headline, support copy, CTA, footer or structural alignment is moved outside the approved contract, the output must be rejected or a new approved template contract must be created.

### Safe-area gate

- horizontal recommendation: 90 px;
- absolute critical-text minimum: 64 px;
- critical headline/CTA vertical region: y=180..1580 unless an exact approved contract defines a non-critical support element differently.

V2 and V7 were reconciled to the 64 px minimum in v2.1.

### Footer gate

Default final order:

`TOCA_DO_MORCEGO → CORONA → RED_BULL → MORRO_DIGITAL`

Only V2/V3 may use:

`CORONA → RED_BULL → MORRO_DIGITAL`

when Toca is structurally present in the hero/top area. Legacy raster order must not be propagated to V5–V9 finals.

### Narrative gate

Before rendering, compare the current message against same-day Feed/Stories. High semantic overlap blocks production/requires rewrite. A Story must retain a distinct editorial function from nearby Feed slots.

### Content identity gate

- canonical `content_item_id`: `MKT-*`;
- `CONT-*`: source/task alias only;
- a `CONT-*` alias must never replace the canonical content ID.

### Registry gate

A produced or QA-failed output may not remain `PLANNED`. The Content Registry must contain its source binding, QA state and decision reason before human review.

## Blocking reasons

- `ASSET_EDITORIAL_MISMATCH`
- `PRODUCT_ONLY_COMPOSITION`
- `TEMPLATE_GEOMETRY_DRIFT`
- `CRITICAL_TEXT_OUTSIDE_SAFE_AREA`
- `PROTECTED_FEATURE_OVERLAP`
- `PROTECTED_FEATURE_CROPPED`
- `MOBILE_LEGIBILITY_FAIL`
- `SAME_DAY_SEMANTIC_DUPLICATION`
- `CONTENT_ID_DRIFT`
- `REGISTRY_STATE_DRIFT`
- `FOOTER_ORDER_DRIFT`
- `PROTECTED_FEATURE_AUDIT_MISSING`

## Runtime boundary

This hardening does **not** authorize publication. Dynamic replication remains non-publishable until the normal Brand Integrity, Venue Fidelity, Quality, Policy and Human Approval gates pass and the exact approved output/hash is bound for provider execution.
