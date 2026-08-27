# Sunset AI dynamic replication

Status: pre-runtime implementation contract.

## Goal

Render each approved Sunset Story template dynamically over the selected real photo without using a pre-rendered template PNG. The nine approved `SUNSET_TEMPLATE_MASTER_V1` through `V9` JSON descriptors remain the layout authority.

## Flow

`PHOTO → IMAGE PROFILE → TEMPLATE SELECTOR → CONTRACT LOADER → AI RENDER PLAN → PLAN VALIDATOR → DYNAMIC SVG RENDERER → VISUAL QA → PREVIEW`

The selector chooses the best template for the image. The contract loader normalizes the approved descriptor. An AI planner may propose a complete structured `RenderPlan`, but the validator rejects any proposal that changes fixed copy, canvas, selected crop, element regions, typography roles, official asset identities, brand order or template identity.

The renderer rebuilds the composition from the source photo, vector shapes, live text and official brand assets on every request. It does not consume a flattened template overlay.

## AI boundary

AI is allowed to assist with local contrast treatment and small optical scale adjustments that remain inside the approved contract bounds. AI is not allowed to:

- rewrite approved copy;
- move fixed layout regions;
- invent or redraw logos;
- replace official assets;
- change the selected photo crop;
- mix V1–V9 components;
- emit editor-only guidance;
- authorize publication.

A model response that violates any of these rules fails closed before rendering.

## Brand and typography

Brand assets are resolved through `SunsetStoryBrandAssetResolverPort`. Each returned asset must have an immutable SHA-256 that matches its bytes. Fonts are resolved through `SunsetStoryFontResolverPort` and must expose a pinned SHA-256 and an explicit family.

The current renderer creates a fresh SVG composition. A production rasterizer is intentionally not included in this front; `STORY_READY` remains false until exact font files, official assets, rasterization and V1–V9 visual regression are certified.

## Visual QA

When an approved reference image is available, the preview is compared through `SunsetStoryVisualQaPort`. Minimum thresholds are:

- layout similarity: `0.92`;
- typography similarity: `0.90`;
- brand integrity: `1.00`;
- no blocking reason.

A lower score produces `visualQaStatus=FAIL` and never authorizes publication.

## Runtime boundary

This implementation only creates a controlled dynamic preview. It does not mark the creative `STORY_READY`, does not create PREPARE/PUBLISH commands and does not mutate Instagram or any external provider.
