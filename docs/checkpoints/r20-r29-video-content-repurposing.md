# R20/R29 — Video, Reels, Content Versioning and Repurposing

Date: 2026-08-15

## Scope

This checkpoint evolves only R20 and R29. It does not add a new route, a parallel video editor, a second content lifecycle, or an external publication path.

R20 is the production and validation layer for short-form video artifacts. R29 remains the canonical content lifecycle and owns immutable versions, variants, channel adaptations, localizations, repurposing lineage, EventRecord linkage and experiment linkage.

## Canonical TOCA OS rules applied

The implementation was reconciled against the current TOCA OS master technical/operational manual and the official Creative Production Pipeline in Google Drive. The code therefore enforces or models:

- official source assets and master-first selection when a marketing master exists;
- original -> derivation lineage and stable content/version identifiers;
- factual source references before factual validation can pass;
- rights evidence, expiry checks and fail/review states;
- vertical video metadata, safe-area policy validation and duration policy validation;
- subtitles/captions and accessibility gates;
- quality aggregation that fails closed on hard failures;
- approval verification before an export step;
- export as an internal artifact only, with no provider publication side effect;
- R29 as the lifecycle backbone rather than a second content system.

## Capabilities

R20 adds 15 explicit internal capabilities under `video.*` covering brief, storyboard, script, asset selection, timeline, subtitles, caption embedding, audio normalization, music rights, safe area, duration, thumbnail, Reel/Story export and quality validation.

R29 adds 10 explicit internal capabilities for version creation, variants, channel adaptation, localization, factual validation, rights validation, accessibility validation, EventRecord linkage, experiment linkage and repurposing planning.

The 731 compatibility identifiers remain intact. These 25 technical extensions bring the raw catalog to 756 entries while the existing eight compatibility aliases remain canonicalized independently.

## Persistence and reliability

`content_items` is the mutable lifecycle head. `content_item_versions`, `content_item_validations` and `content_item_history` are append-only evidence/lineage structures. Version creation uses per-content idempotency keys and optimistic `record_version` checks.

Event linkage validates the referenced canonical `event_records` row and requires tenant, workspace and organization scope equality. Content state/version/link mutations emit domain events through the existing transactional outbox in the same database transaction.

The durable workflow builder uses the existing workflow engine. The production graph includes factual, rights, accessibility, music-rights, safe-area, duration and quality checks, then reuses `approval.verify` before `video.export.reel` or `video.export.story`. It contains no publication capability.

## Evidence

- base main SHA used for implementation: `76aec57a707161f4ca8484059b8ec302b9be6910`;
- one-shot implementation Quality run `31866404716`: success after the complete `pnpm quality` gate;
- the first run `31866325924` correctly failed closed on a stale catalog-count assertion; the assertion was reconciled and the complete gate was rerun successfully;
- implementation head after the successful gate: `98e31377efca7f94fbad6fc15cd80b4ae088ff42` before this checkpoint/test-only follow-up.

The PR Quality Gate and fixed-head merge evidence supersede this implementation-run evidence for release closure.
