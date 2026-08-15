# M-FOUND-12 — End-to-End and Production Validation

Status: **FINAL CANDIDATE — EXECUTION EVIDENCE COMPLETE; SAME-HEAD RECERTIFICATION REQUIRED BEFORE MERGE**

Foundation baseline: `main@18c36ba428d1b10981b5ea68a23b561daa07bd96`, which contains the merged M-FOUND-11 Core MCP Surface. M-FOUND-11 post-merge Quality run `31912275711` is green.

M-FOUND-12 is intentionally an evidence/test surface over the merged Core. It does not create a second MCP server, workflow engine, scheduler, ledger, outbox, CRM master or provider family.

## Governed path under validation

`ChatGPT/MCP request -> capability discovery -> identity -> typed schema -> authorization -> policy -> risk -> approval -> idempotency -> workflow -> handler/provider -> provider read-back -> EventRecord/CRM when applicable -> Transactional Outbox -> Audit Ledger -> verify -> final response`

The milestone uses multiple layers because no single test can truthfully prove both Core composition, process-restart durability and external provider truth.

## Layer 1 — executable risk/failure matrix

`test/fixtures/m-found-12-harness.ts` and `test/m-found-12-e2e-matrix.test.ts` preserve the 24 required dimensions:

- READ;
- WRITE_REVERSIBLE;
- WRITE_EXTERNAL;
- FINANCIAL_IMPACT;
- DESTRUCTIVE;
- approval required;
- human task;
- timer;
- retry;
- compensation;
- stale claim;
- idempotency replay;
- duplicate request;
- payload drift;
- approval replay;
- cross-tenant attempt;
- provider timeout;
- ambiguous provider response;
- missing read-back;
- audit failure;
- outbox retry;
- recovery after restart;
- EventRecord linkage;
- CRM linkage.

These scenarios remain fail-closed. Timeout or ambiguous provider state is not converted into success or blind retry.

## Layer 2 — real merged Core facade

`test/m-found-12-core-facade-e2e.test.ts` imports the merged M-FOUND-11 implementation. It registers `registerTocaCoreSurface`, invokes real `toca.execute` and `toca.verify`, uses `createRuntimeCapabilityResolver`, the canonical capability registry and the real `TocaManagedInstagramScheduler` contract.

The Core-facade E2E proves:

- authenticated trusted execution identity;
- canonical capability discovery/runtime agreement;
- typed payload parsing;
- authorization and policy;
- risk/lifecycle gating;
- deterministic idempotency binding;
- actual reversible scheduler handler execution;
- fresh read-back and exact resource identity;
- audit descriptor/resource binding;
- `toca.verify` binding to requester, capability, descriptor and resource;
- replay returns the existing logical schedule instead of duplicating it;
- READ through the same `toca.execute` route has no write side effect.

This layer intentionally uses an in-memory scheduler/audit adapter to isolate Core composition. Durability is proven separately below.

## Layer 3 — real PostgreSQL 18 durability and restart

`test/m-found-12-postgres-e2e.test.ts` and `.github/workflows/m-found-12-postgres-e2e.yml` run against a real disposable PostgreSQL 18 service and apply the repository migrations with `pnpm migrate`.

The executed scenario proves, across explicit pool shutdown/reopen boundaries:

- durable Workflow creation and step claim;
- attempt/claim identity survives restart;
- wrong/stale execution identity is rejected before completion;
- the original claim completes successfully after restart;
- Transactional Outbox delivery failure becomes retryable without redoing the domain mutation;
- retry is claimed as attempt 2 after restart and can be marked delivered;
- EventRecord persists with tenant/workspace/organization scope;
- CRM Contact and Lead persist and the Lead reuses the canonical EventRecord ID;
- cross-tenant Lead read returns no record;
- Audit Ledger can append STARTED before restart and SUCCEEDED after restart;
- ledger verification succeeds across the restart boundary;
- direct database checks show one logical Workflow and one logical Lead;
- migrations can be applied again after the scenario without drift.

Provider-independent PostgreSQL evidence already completed successfully on run `31912549105` and again on run `31912673488`. The final merge head must rerun this workflow successfully after this checkpoint/evidence update.

## Layer 4 — real production provider READ

`.github/workflows/m-found-12-provider-read.yml` contains no provider mutation method. It builds a temporary immutable read-only image, authenticates through GitHub OIDC/WIF, deploys a temporary Cloud Run Job under the production runtime service account, mounts the existing Meta token from Secret Manager and performs only Meta Graph `GET` operations.

Exact branch-head provider evidence:

- validation head: `083d09f0cc034ec213651d200119589794f4da46`;
- push run: `31912813129` — **SUCCESS**;
- provider: Meta Graph API v24.0;
- required granted scopes verified: `instagram_basic`, `pages_show_list`, `pages_read_engagement`;
- Facebook Page binding verified: `306103746115875`;
- Instagram business account binding verified: `17841402033495654`;
- Instagram username verified: `tocadomorcego`;
- recent media read returned at least one real provider resource;
- no access token or raw credential is written to repository evidence.

The corresponding PR run `31912815007` is also green. Its sanitized artifact is `9254146159`, digest `sha256:db586128234fb42b1cffd4ecf43b582ba5b2d28fb649524f26649eaf2acfc595`.

The final merge head must rerun the provider READ successfully after this checkpoint/evidence update.

## Layer 5 — controlled external WRITE evidence

M-FOUND-12 does **not** create a new Instagram post merely to obtain a newer timestamp. The external-write invariant is supported by immutable real production evidence already merged into the same repository history, while current account/provider connectivity is re-proven by Layer 4.

Accepted write evidence:

- PR #37 (`feat: add first Instagram publication execute gate`) is merged. Its execution design is exact-request/hash gated, one-shot and verifies a `PUBLISHED` result with immutable evidence. PR head `8297c5f99b62e59e16b5b37317c4c0f529c0405c` had Quality run `31663466024` green before merge.
- The real publication subsequently exposed a stale-local-state incident rather than a missing provider side effect.
- PR #64 (`fix: reconcile Instagram publication evidence before retry`) is merged at `203e6e1a5c3d57d9e14dcc36c69283b803a8f39e`. It added provider-backed media read-back (`id`, caption, media type, permalink and timestamp), strict single-match reconciliation and fail-closed handling so the already-created provider resource is reconciled instead of blindly republished.
- Current Meta/Instagram binding and provider read access are independently fresh-validated by run `31912813129` above.

This combination proves a real external side effect occurred, its provider truth is readable/reconcilable, and replay/uncertain local state is not allowed to create a duplicate. A fresh side effect was deliberately avoided because it would add business output solely for validation rather than reduce risk.

Fresh Meta Ads `CREATE_PAUSED`, Google Ads and Privacy-governed messaging remain separate provider-write closeout items. They are not prerequisites for declaring the Core/Foundation E2E path validated and must not broaden M-FOUND-12.

## Current Quality evidence

On head `083d09f0cc034ec213651d200119589794f4da46`, canonical Quality run `31912815134` passed format, architecture, lint, typecheck, tests and build.

Because this checkpoint update changes the candidate head, that earlier run is supporting evidence only. The **final merge head** must have all of the following green simultaneously:

1. canonical Quality Gate;
2. M-FOUND-12 PostgreSQL E2E;
3. M-FOUND-12 Provider READ.

No previous green run is substituted for a failed final-head run.

## Completion invariants

M-FOUND-12 may be treated as complete only when the final candidate satisfies all of these conditions:

- M-FOUND-11 is merged and post-merge `main` Quality is green;
- the 24-scenario matrix is green;
- real Core-facade E2E is green through `toca.execute` and `toca.verify`;
- real PostgreSQL/restart/outbox/audit scenario is green;
- EventRecord/CRM persistence and tenant isolation are proven;
- real provider READ is green under the production runtime identity;
- real controlled external-write evidence has provider-backed reconciliation/read-back and no blind retry;
- no terminal external-write success exists without resource identity/read-back evidence;
- no unresolved P0/P1 finding is introduced by this milestone;
- no capability lifecycle promotion is inferred from CI alone;
- final exact-head Quality + PostgreSQL E2E + Provider READ are all green;
- merge uses the exact green head SHA and post-merge `main` Quality is green.

This document is therefore a conditional final checkpoint: the execution evidence is assembled, but the milestone is not promoted to complete until the same-head recertification and fixed-head merge conditions above are actually satisfied.
