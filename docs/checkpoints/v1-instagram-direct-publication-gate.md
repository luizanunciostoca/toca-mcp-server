# V1 Instagram direct-publication gate

Status: **CODE_COMPLETE + STATIC_REVIEW_VERIFIED; LOCAL_VERIFIED BLOCKED BY EXECUTION ENVIRONMENT; CI PENDING**

This checkpoint records the V1 integration gate for the existing Instagram direct-publication capabilities and the validated TOCA-managed reschedule binding.

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

A configuration drift found during the PR #185 audit was corrected: the MCP deployment intentionally has `META_ENABLED=false` while using the explicit Meta access-token reference, but the previous shared configuration guard rejected every `INSTAGRAM_PUBLICATION_WRITES_ENABLED=true` process unless the legacy Meta OAuth module was enabled. Core/MCP and legacy publication guards are now separated without relaxing either boundary.

## Media contracts

The runtime contract is bounded as follows:

- IMAGE: exactly one image URL;
- CAROUSEL: 2–10 image URLs;
- REEL: exactly one media URL;
- STORY: exactly one media URL.

The existing Meta transport/builder remains the only provider path.

## Reschedule validation

`instagram.toca_schedule.reschedule` now exposes `sideEffectValidated: true` and remains canonically `WRITE_REVERSIBLE`.

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

## Validation evidence

`STATIC_REVIEW_VERIFIED`: PASS for the PR diff, capability catalog, runtime bindings, policy/authorization, ApprovalRecord engine, scheduler approval descriptor, executor, Meta transport, PostgreSQL persistence/idempotency, provider readback, reconciliation, and existing tests.

`LOCAL_VERIFIED`: **BLOCKED_BY_EXECUTION_ENVIRONMENT**. The assistant execution container used for this audit does not have the repository checkout, cannot resolve GitHub for a network clone, has Node 22 rather than the repository-required Node >=24, has no pnpm 10.15.0, and does not have the project-local Prettier/ESLint/Vitest/TypeScript toolchain or a PostgreSQL endpoint. Therefore format, architecture check, lint, project typecheck, focused Vitest, full Vitest, build, and PostgreSQL E2E are not truthfully claimed as passing here.

A syntax-only inspection of the edited TypeScript does not substitute for repository Quality.

`CI`: **BLOCKED_EXTERNALLY**. GitHub Actions runs for the prior PR head ended in `startup_failure`; no such run is accepted as Quality evidence.

No real Instagram publication was executed as part of this audit.

## Merge contract

PR #185 must not merge until:

1. the branch is reconciled to the then-current `main` with zero commits behind;
2. repository-local `pnpm quality` or the canonical GitHub `Quality Gate` runs on the exact final head;
3. format, architecture check, lint, typecheck, focused/full tests, and build are green;
4. PostgreSQL E2E is executed when the required test environment is available and applicable;
5. the exact green head SHA is captured;
6. merge occurs without bypassing the required Quality gate.

Historical/deleted `BuildFailed` registrations and GitHub Actions `startup_failure` runs are not accepted as Quality evidence.
