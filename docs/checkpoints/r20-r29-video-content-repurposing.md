# R20/R29 — Video, Reels, Content Versioning and Repurposing

Date: 2026-08-15

## Scope

This checkpoint evolves only R20 and R29. It does not add a new route, a parallel video editor, a second content lifecycle, or an external publication path.

R20 is the production and validation layer for short-form video artifacts. R29 remains the canonical content lifecycle and owns immutable versions, variants, channel adaptations, localizations, repurposing lineage, EventRecord linkage and experiment linkage.

## Canonical TOCA OS rules applied

The implementation was reconciled against the current TOCA OS master technical/operational manual and the official Creative Production Pipeline in Google Drive. The code therefore enforces or models:

- official source assets and master-first selection when a marketing master exists;
- original → derivation lineage and stable content/version identifiers;
- factual source references before factual validation can pass;
- rights evidence, expiry checks and fail/review states;
- vertical video metadata, caller-supplied/versioned safe-area policy and duration-policy validation;
- subtitles/captions and accessibility gates;
- quality aggregation that fails closed on hard failures;
- approval verification before an export step;
- export as an internal artifact only, with no provider publication side effect;
- R29 as the lifecycle backbone rather than a second content system.

## Capabilities

R20 adds 15 explicit internal capabilities under `video.*` covering brief, storyboard, script, asset selection, timeline, subtitles, caption embedding, audio normalization, music rights, safe area, duration, thumbnail, Reel/Story export and quality validation.

R29 adds 10 explicit internal capabilities for version creation, variants, channel adaptation, localization, factual validation, rights validation, accessibility validation, EventRecord linkage, experiment linkage and repurposing planning.

The reconciled main already contained 745 raw catalog entries after the Google Business foundation. These 25 R20/R29 technical extensions bring the combined raw catalog to 770 entries; the existing eight compatibility aliases remain independently canonicalized, yielding 762 effective capabilities.

## Persistence and reliability

`content_items` is the mutable lifecycle head. `content_item_versions`, `content_item_validations` and `content_item_history` are append-only evidence/lineage structures. Version creation uses per-content idempotency keys and optimistic `record_version` checks.

Event linkage validates the referenced canonical `event_records` row and requires tenant, workspace and organization scope equality. Content state/version/link mutations emit domain events through the existing transactional outbox in the same database transaction.

The durable workflow builder uses the existing workflow engine. The production graph includes factual, rights, accessibility, music-rights, safe-area, duration and quality checks, then reuses `approval.verify` before `video.export.reel` or `video.export.story`. It contains no publication capability.

## Concurrency reconciliation

Implementation began from main `76aec57a707161f4ca8484059b8ec302b9be6910`. During development, CRM Core and Google Business were merged by other isolated workstreams. The implementation was then rebuilt cleanly on `88de675febdb1142f65c1354effef2ef2a9e0588` instead of resolving catalog conflicts by choosing one side blindly.

Measurement/Ticketing later advanced main to `b0d067e9cc6b469fdb1421ab7a25a25a3b0f1f47` through a file-disjoint change set. The final PR branch is based against that main state and retains only the R20/R29 delta.

The R20/R29 capability identifiers are intentionally isolated in `src/content/capability-ids.ts`, then folded into the global capability catalog. This preserves the central Google Business technical-extension map while keeping one unified canonical catalog.

## Quality evidence

A preliminary full `pnpm quality` run `31866404716` passed on the original R20/R29 implementation before concurrent main changes. The final release authority is the official pull-request Quality Gate executed against the reconciled branch head and current main; its fixed-head SHA and merge evidence must be recorded at closure.

PR #114 is the clean final Quality candidate. It uses a fresh branch to avoid stale Actions state from the earlier closed PR #108 branch reuse.
