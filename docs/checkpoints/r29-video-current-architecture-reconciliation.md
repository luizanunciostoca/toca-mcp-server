# Video/R29 — current-architecture reconciliation

Date: 2026-08-16

## Decision

PR #114 is preserved as historical implementation evidence but is not safe to merge directly. At revalidation its head (`c62f975f90986cc8d6831d243bcc11c60d08c74f`) was 16 commits ahead and 17 commits behind the then-current main and GitHub reported it non-mergeable. The replacement branch `feat/r29-video-reconciliation-final` was therefore created from current main and the valid domain work was ported selectively.

The replacement PR is #143.

## Scope and route ownership

This work does not create R33 or another domain.

- R20 remains the short-form video production/validation route for the 15 `video.*` technical capabilities introduced by the original Video/R29 work.
- R29 remains the canonical ContentItem lifecycle/versioning/repurposing backbone and receives the 10 versioning, validation, linking and repurposing technical capabilities.
- No scheduler, daemon, public publication route or parallel content lifecycle is introduced.

## Reused from #114

The following parts remained architecturally valid and were ported:

- ContentItem and immutable version/lineage model;
- factual, rights and accessibility validation;
- Reel/Story video brief, storyboard, script, asset, timeline, subtitle, audio, safe-area, duration and quality validation;
- internal export manifest validation;
- R29-only Postgres content store;
- optimistic concurrency and per-content version idempotency;
- append-only version, validation and history persistence;
- EventRecord scope validation;
- transactional outbox emission for persisted ContentItem changes;
- the durable video workflow blueprint using the existing workflow engine and `approval.verify` before internal export.

## Reimplemented for the current architecture

The old PR predates the current TOCA Core execution contract. Catalog entries marked `IMPLEMENTED` are no longer sufficient: `toca.execute` requires a matching internal ToolRegistry definition and an active typed runtime binding.

The replacement therefore adds:

- `PostgresVideoContentRuntime`, enabled only when the existing database runtime is available;
- ToolRegistry registration for the 25 technical capabilities without adding public MCP tools;
- current `runtime-capability-resolver` bindings;
- fail-closed behavior when the Video/R29 runtime service is absent;
- deterministic idempotency for internal side effects;
- explicit `sideEffectValidated` bindings;
- durable Postgres readback for internal side effects;
- append-only `content_video_artifacts` manifests with scope, version lineage, idempotency key and payload SHA-256;
- transactional outbox events for persisted video artifact manifests;
- existing TOCA Core audit wrapping for all executions.

## Approval and external effects

Video/R29 adds no external publication operation. Internal Reel/Story export retains a required `approval_ref` and the durable workflow retains `approval.verify` before export. The current TOCA Core formal ApprovalRecord contract is reserved for risk classes that require formal external/financial/destructive approval; therefore the internal export contract is `WRITE_REVERSIBLE` with an approval reference rather than being misclassified as an external provider write.

No Instagram, Meta Ads, Google Ads, Drive or other external write is introduced by this reconciliation.

## Privacy

The R29 persistence model stores content identifiers, version lineage, asset/source references, validation evidence and artifact manifests. It does not create a second contact/customer identity model and does not replace Privacy/R16 consent, suppression or preference governance. Any source asset containing personal data remains subject to the existing Privacy and rights policies; this change creates no new privacy authority.

## Catalog and public surface

The current main before the 25 technical additions has 758 raw capability entries and eight compatibility aliases (750 effective capabilities).

After this reconciliation the expected catalog is:

- raw capability entries: **783**;
- compatibility aliases: **8**;
- effective capabilities: **775**;
- macro-routes: **32** (`R01` through `R32`);
- public MCP tools: **12**, unchanged.

The 12 public MCP tools remain the existing TOCA Core surface; Video/R29 is executed through `toca.execute` rather than exposing new top-level MCP tools.

## Provider/readback boundary

The Video/R29 capabilities in this change are internal production capabilities. No real external video-rendering/publication provider is configured by this domain, so no external-provider mutation is applicable. For every internal side effect, the authoritative provider is the existing PostgreSQL runtime and readback verifies persisted ContentItem or immutable artifact-manifest state before TOCA Core treats execution as verified.

External publication remains governed by the separately existing Instagram/publication capabilities and is not invoked here.

## Merge/closure rule

PR #114 must remain open until #143 is green, merged and safely production-validated. Only then may #114 be closed as superseded. Historical commits and evidence in #114 must remain intact.
