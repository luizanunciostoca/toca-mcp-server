# Sunset Story Intelligent Template Selection

Status: candidate implementation. Runtime publication remains disabled.

## Purpose

Choose the best approved Sunset Story template for a real image without asking a generative model to reinterpret layout. The selector operates only on approved deterministic template contracts and preserves the rule that the photo may be cropped or repositioned, while the template layout itself never moves to accommodate the photo.

## Inputs

The selection service receives:

- asset identifier;
- image bytes;
- creative intent;
- optional recent template selection history;
- an injected image-analysis adapter;
- an optional preview-evaluation adapter.

The image-analysis adapter must return a normalized observation containing subject boxes, salience, negative-space zones, regional luminance, warmth, 9:16 crop fitness, horizon information and optional scene hints. The core is provider-neutral and does not depend on a specific vision vendor.

## Pipeline

1. Analyze the image through `SunsetStoryImageAnalyzerPort`.
2. Build a validated `SunsetStoryImageProfile`.
3. Load the fixed V1-V9 selection registry.
4. Plan a template-specific 9:16 crop while preserving the primary subject.
5. Reject candidates that cannot preserve the primary subject, collide excessively with protected layout regions, or have insufficient 9:16 crop fitness.
6. Score remaining candidates using subject preservation, text-space compatibility, collision clearance, semantic compatibility, contrast/readability, crop quality and anti-repeat pressure.
7. Rank all candidates deterministically.
8. When a preview evaluator is configured, evaluate the top three candidates and reject any preview with a blocking visual finding.
9. Apply confidence and winning-margin gates.
10. Return `AUTO_SELECT`, `REVIEW_REQUIRED` or `NO_SAFE_TEMPLATE`.

## Scoring

Canonical weights are defined by `SUNSET_TEMPLATE_SELECTION_POLICY_V1`:

- subject preservation: 30%;
- text-space compatibility: 20%;
- collision clearance: 20%;
- semantic compatibility: 10%;
- contrast/readability: 10%;
- crop quality: 5%;
- anti-repeat: 5%.

The current confidence gates are:

- score >= 85 and winning margin >= 5: `AUTO_SELECT`;
- score >= 70: `REVIEW_REQUIRED`;
- score < 70 or no eligible candidate: `NO_SAFE_TEMPLATE`.

Anti-repeat is always a soft penalty. It may never override a hard geometric or brand-safety rejection.

## Template registry

`src/creative/sunset-story-template-registry.ts` binds every approved master template to:

- template class;
- preferred scene classes;
- preferred subject kinds;
- preferred subject placement zones;
- preferred text-space zones;
- compatible creative intents;
- protected layout rectangles;
- maximum primary-subject overlap.

The registry is intentionally deterministic. Adding or changing a template requires an explicit contract change and regression coverage.

## Crop planner

`src/creative/sunset-story-crop-planner.ts` computes a 9:16 crop window from the source aspect ratio. For images with a primary subject, it tests the template's allowed preferred subject zones and selects the crop that best balances:

- subject coverage;
- protected-region clearance;
- placement quality.

It never changes template coordinates.

## Preview QA

`SunsetStoryPreviewEvaluatorPort` is optional at the core level so CI can test the selector without an external renderer. Production auto-selection must not be enabled until a deterministic renderer and visual preview evaluator are bound and regression-tested.

A preview blocking finding rejects that candidate fail-closed. Examples include:

- text covers essential subject;
- logo collision;
- unreadable contrast;
- bad crop;
- footer obstruction;
- editor-only placeholder leakage.

## Runtime boundary

This implementation does not:

- enable Story publication;
- enable PREPARE/PUBLISH provider writes;
- mark V1-V9 `runtimeEligible=true`;
- select or call a particular external vision provider;
- regenerate logos or layouts with AI.

Runtime eligibility requires a separate closeout covering exact font/assets, deterministic rendering, vision adapter, preview QA, visual regression and exact-head CI evidence.
