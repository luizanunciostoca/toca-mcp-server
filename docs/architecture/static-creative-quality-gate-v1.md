# TOCA OS — Static Creative Quality Gate v1

Status: implementation candidate on `fix/static-creative-quality-gates-20260902`.

## Objective

Prevent a static Feed/Story creative from reaching `storyReady`, `publicationEligible` or a new managed Instagram schedule when the final bytes do not have sufficient evidence for source truth, resolution, layout safety, typography, rights and editorial QA.

This gate exists because visual review alone can produce false positives. A human or agent saying `PASS` is not sufficient when the machine-observable evidence contradicts it.

## Canonical contract

Machine-readable policy:

`control/creative-standards/static-creative-quality-policy.v1.json`

Runtime evaluator:

`src/creative/static-creative-quality-gate.ts`

Architecture drift guard:

`scripts/check-static-creative-quality-contract.mjs`

## Final source truth

A publication-ready static asset must resolve to `ORIGINAL_MASTER` and carry a SHA-256 for that source master.

`REFERENCE_TEMPLATE` and `DERIVED_RASTER` are valid for review, composition guidance and controlled drafts. They are never sufficient as the final photographic source.

A missing/unreachable requested source must not trigger a silent substitution. A substitute can be rendered only as a non-publication-eligible review draft until the source decision and rights/master eligibility are resolved.

## Resolution

The maximum effective upscale ratio is `1.5`.

The ratio is evaluated from the declared source dimensions against the final output dimensions. A low-resolution crop extracted from a historical JPEG therefore cannot become publication-ready simply because the final canvas itself is 1080px wide.

## Supported static formats and safe areas

### Story 9:16

- canvas: 1080×1920;
- left/right: 72px;
- top/bottom: 250px.

### Feed 4:5

- canvas: 1080×1350;
- left/right: 64px;
- top/bottom: 80px.

### Feed 1:1

- canvas: 1080×1080;
- all sides: 64px.

Protected roles are headline, support copy, CTA, brand and footer. Decorative marks may leave the safe region when the specific design standard permits it, but they cannot be used to carry critical information.

## Readability treatments

Preferred:

- soft gradients;
- localized contrast;
- local panels when composition requires them.

Forbidden by this baseline:

- `HARD_FULL_WIDTH_PANEL`.

This specifically prevents the visible hard bands previously produced by `rectangle 0,1250 1080,1920` in the legacy local Story composer.

## Typography

When typography is present on a final static creative, the renderer must receive a canonical pinned typography binding.

A review fallback font may be used to create a draft, but that draft is always:

- `storyReady=false`;
- `publicationEligible=false`.

This reconciles runtime behavior with the existing font-pin readiness contract.

## Required QA evidence

The static evidence snapshot carries:

- exact source lineage/master binding;
- source master SHA-256;
- source dimensions and effective upscale ratio;
- safe-area result;
- typography result;
- rights result;
- Brand Integrity;
- Venue Fidelity;
- Copy QA;
- Information QA;
- visual-artifact result;
- exact final output SHA-256.

A failed gate can still produce an `EM REVISÃO` artifact. It cannot produce a publication-ready artifact.

## Scheduler enforcement

Every new managed Instagram schedule containing a static image must include one exact quality evidence record per static asset.

The scheduler verifies:

1. evidence count;
2. unique asset binding;
3. exact asset ID;
4. exact output SHA-256;
5. overall PASS;
6. original-master binding;
7. no individual failed gate.

The approved descriptor hash includes this evidence, so modifying evidence, assets, caption or schedule data invalidates prior approval.

Already persisted legacy schedules remain parse-compatible so the migration does not reinterpret historical durable state. New static schedules are fail-closed.

## Review vs final

`REVIEW` exists to let design work continue while a dependency is unresolved. It is not a weaker path to publication.

`FINAL` requires machine evidence. If source, typography, resolution, rights, safe area or QA is unresolved, final composition fails rather than claiming readiness.

## Failure codes

Representative failures include:

- `STATIC_CREATIVE_SOURCE_MASTER_REQUIRED`;
- `STATIC_CREATIVE_SOURCE_RESOLUTION_TOO_LOW`;
- `STATIC_CREATIVE_SAFE_AREA_VIOLATION`;
- `STATIC_CREATIVE_CANONICAL_FONT_PIN_REQUIRED`;
- `STATIC_CREATIVE_HARD_PANEL_FORBIDDEN`;
- `STATIC_CREATIVE_RIGHTS_NOT_READY`;
- `STATIC_CREATIVE_BRAND_INTEGRITY_NOT_READY`;
- `STATIC_CREATIVE_VENUE_FIDELITY_NOT_READY`;
- `STATIC_CREATIVE_COPY_QA_NOT_READY`;
- `STATIC_CREATIVE_INFORMATION_QA_NOT_READY`;
- `STATIC_CREATIVE_QUALITY_OUTPUT_SHA256_MISMATCH`;
- `TOCA_MANAGED_INSTAGRAM_STATIC_CREATIVE_QUALITY_REQUIRED`.

## Acceptance

The feature is acceptable only when repository Quality Gate is green at the exact PR head and Drive governance has been synchronized. A green code gate does not by itself authorize publication or production deployment.
