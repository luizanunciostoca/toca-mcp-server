# V1 Instagram direct-publication gate

Status: **CODE_COMPLETE + STATIC_REVIEW_VERIFIED + CI_VERIFIED; FINAL MERGE REQUIRES EXACT-HEAD GREEN**

This checkpoint records the V1 integration gate for the existing Instagram direct-publication capabilities and the validated TOCA-managed reschedule binding. The work was recovered from the historical PR #185 branch onto the canonical repository as PR #8 without importing the old divergent merge history.

## Scope

- `instagram.publish.image`
- `instagram.publish.carousel`
- `instagram.publish.reel`
- `instagram.publish.story`
- `instagram.toca_schedule.reschedule`

No second Instagram executor, provider, persistence layer, approval engine, scheduler, or audit subsystem is introduced by this work.

## Direct-publication execution boundary

The four direct-publication capabilities reuse the existing `InstagramPublicationExecutor`, `MetaInstagramPublicationTransport`, and `PostgresPublicationExecutionStore` through the TOCA Core runtime binding.

The executable boundary remains fail-closed on all of the following:

- explicit `INSTAGRAM_PUBLICATION_WRITES_ENABLED=true` opt-in;
- persistent `DATABASE_URL`;
- canonical `INSTAGRAM_BUSINESS_ACCOUNT_ID`;
- referenced `META_ACCESS_TOKEN_ENV_KEY` secret;
- canonical `WRITE_EXTERNAL` risk class and authorization;
- formal ApprovalRecord bound to the exact Core descriptor, authenticated requester, target account, scope, and deterministic idempotency key;
- durable publication reservation before provider side effects;
- exact provider readback before successful completion;
- immutable Core audit evidence.

The MCP/Core path intentionally does not reuse the legacy one-shot `INSTAGRAM_PUBLICATION_APPROVED_REQUEST_SHA256` gate. Per-request authorization is owned by the Core ApprovalRecord lifecycle. The legacy controlled-publication path remains unchanged and still requires `MCP_ENABLED=false`, `META_ENABLED=true`, persistent OAuth token storage, and the pre-approved request hash.

A configuration drift found during the historical PR #185 audit was corrected: the MCP deployment intentionally has `META_ENABLED=false` while using the explicit Meta access-token reference, but the previous shared configuration guard rejected every `INSTAGRAM_PUBLICATION_WRITES_ENABLED=true` process unless the legacy Meta OAuth module was enabled. Core/MCP and legacy publication guards are now separated without relaxing either boundary.

## Media contracts

The runtime contract is bounded as follows:

- IMAGE: exactly one image URL;
- CAROUSEL: 2–10 image URLs;
- REEL: exactly one media URL;
- STORY: exactly one media URL.

The existing Meta transport/builder remains the only provider path.

## Reschedule validation

`instagram.toca_schedule.reschedule` exposes `sideEffectValidated: true` and remains canonically `WRITE_REVERSIBLE`.

Its deterministic Core idempotency key binds the source job ID and the approved replacement schedule descriptor. Replay recovery checks the durable scheduler state and reuses an already-persisted replacement when the source was canceled before a retry. Successful Core completion requires scheduler readback proving the replacement job is `SCHEDULED`, with the replacement job ID as the external resource ID.

Formal ApprovalRecord is **not** a canonical requirement for this `WRITE_REVERSIBLE` capability. Forcing it locally would violate the Core invariant that formal-approval semantics must match the capability catalog. Instead, the replacement schedule itself remains approval-bound: the scheduler validates `approval.mode`, `approval.status`, and the exact `approvedDescriptorSha256` before persistence. Core authorization, deterministic idempotency, mandatory readback, and audit still apply.

This checkpoint supersedes only the old M-FOUND-11 statement that reschedule had `sideEffectValidated: false`; it does not change the canonical risk or approval model.

## Failure and replay review

Static source/test review confirms coverage or explicit fail-closed behavior for:

- invalid target Instagram account;
- direct-publication feature flag disabled;
- missing/invalid formal ApprovalRecord for direct publication;
- deterministic idempotency replay;
- provider/container processing failure;
- provider publish uncertainty;
- persisted `PUBLISHING` ambiguity;
- provider reconciliation with a unique match;
- ambiguous reconciliation;
- overdue publication with no provider evidence;
- scheduler reschedule replay after source cancellation.

Provider uncertainty is never converted into a second blind publish. The existing publication executor persists the uncertain state and requires reconciliation/manual review before another write can proceed.

## Recovery and validation evidence

`STATIC_REVIEW_VERIFIED`: PASS for the recovered PR diff, capability catalog, runtime bindings, policy/authorization, ApprovalRecord engine, scheduler approval descriptor, executor, Meta transport, PostgreSQL persistence/idempotency, provider readback, reconciliation, and tests.

`RECOVERY_BASE`: PR #8 was reconstructed from canonical `main` SHA `36da7c43cfb2cdc166c0ac914b5f94bc35f6b31e`. The recovery branch was verified zero commits behind `main` before validation and imported only the intended feature delta rather than the historical divergent commit graph.

`CI_VERIFIED_IMPLEMENTATION_HEAD`: PASS on SHA `fc987f386d96d3749e3d1623398b435c0d518c84`.

- GitHub Actions `Quality Gate` run `32314159412`: PASS for workflow supply-chain verification, dependency install, format, architecture/control-plane checks, lint, typecheck, full Vitest suite, and build.
- GitHub Actions `M-FOUND-12 PostgreSQL E2E` run `32314159404`: PASS for PostgreSQL container initialization, real repository migrations, restart/outbox/audit and Video/R29 E2E, migration-drift verification, and clean container shutdown.
- The recovery exposed and corrected one compatibility regression in the legacy Meta publication-client test by explicitly binding that test to `MCP_ENABLED=false`; Core direct-publication validation remains fail-closed.

`LOCAL_VERIFIED`: not used as release evidence for this recovery. The canonical hosted GitHub Actions gates now execute successfully and supersede the historical execution-environment blocker recorded by PR #185.

No real Instagram publication was executed as part of recovery or CI validation.

## Merge contract

PR #8 must merge only when:

1. the final branch remains zero commits behind the then-current `main`;
2. the canonical GitHub `Quality Gate` passes on the exact final PR head;
3. format, architecture/control-plane checks, lint, typecheck, full tests, and build are green;
4. `M-FOUND-12 PostgreSQL E2E` passes on the exact final PR head;
5. merge occurs without bypassing the required gates;
6. no real Instagram provider write is introduced as a validation shortcut.

The historical PR #185 `startup_failure` state is superseded by PR #8 and is not accepted as current release evidence.
