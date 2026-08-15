# M-FOUND-11 — TOCA Core MCP Surface

Status: **IMPLEMENTED + HARDENED — MERGE BLOCKED UNTIL FIXED-HEAD QUALITY IS GREEN**

Milestone: `TOCA_OS_MARKETING_SALES_FOUNDATION_v1`

Current reconciled `main` base: `b0d067e9cc6b469fdb1421ab7a25a25a3b0f1f47` — Measurement / Ticketing Read-Only / Attribution foundation, PR #111.

The PR #107 branch was rebuilt cleanly on that SHA while preserving only the six files belonging to M-FOUND-11. That base also includes M-FOUND-10 CRM Core Records and the Google Business foundation already merged before #111.

## Objective

Expose TOCA Core to ChatGPT through a deliberately small, governed and stable MCP facade without turning the internal capability catalog into hundreds of MCP tools and without creating another MCP server, orchestrator, workflow engine, scheduler, approval engine, audit ledger or capability registry.

ChatGPT remains the reasoning/orchestration layer. `toca-mcp-server` remains the deterministic execution boundary.

## Public MCP facade

The public surface remains exactly 12 tools:

1. `toca.system.health`
2. `toca.capabilities.search`
3. `toca.capabilities.describe`
4. `toca.workflow.create`
5. `toca.workflow.get`
6. `toca.workflow.advance`
7. `toca.approval.request`
8. `toca.approval.get`
9. `toca.execute`
10. `toca.verify`
11. `toca.audit.query`
12. `toca.event.get`

CRM, Measurement, Privacy, Google Business, Google Ads and other domain capabilities are not promoted into dedicated MCP tools merely for convenience.

## `toca.execute` pipeline

`toca.execute` enforces:

`authenticated identity → canonical capability/alias → active runtime binding → typed input schema → authorization → policy/risk → exact approval descriptor → idempotency → handler/provider → mandatory read-back → immutable audit`

The hardening review adds the following fail-closed invariants:

- runtime risk class must equal the canonical capability contract;
- runtime side-effect metadata must equal the canonical contract;
- runtime lifecycle status must equal the canonical lifecycle status;
- runtime idempotency metadata must equal the canonical contract;
- runtime formal-approval semantics must equal canonical `approval_required`;
- a runtime/local `ToolRegistry` cannot promote a capability beyond the canonical lifecycle;
- every side effect must expose a deterministic idempotency binding before execution;
- every side effect must define provider/store read-back before execution;
- successful side-effect read-back must contain evidence and the exact affected resource ID;
- formal-approval capabilities must resolve their target account;
- catalog-only capabilities remain non-executable without an explicit typed runtime binding;
- account-scoped bindings pass their resolved target account to authorization for reads as well as writes;
- side-effect runtime bindings require `sideEffectValidated: true` in addition to canonical lifecycle maturity.

The last item is deliberately separate from the canonical catalog. Canonical lifecycle metadata alone cannot activate a side-effect implementation whose replay/idempotency/read-back behavior has not itself been proven.

## Runtime binding maturity

Current explicit side-effect binding decisions:

- `instagram.toca_schedule.create`: `sideEffectValidated: true`;
- `instagram.toca_schedule.cancel`: `sideEffectValidated: true`;
- `instagram.toca_schedule.reschedule`: `sideEffectValidated: false`;
- `meta_ads.campaign.create_paused`: `sideEffectValidated: false`.

`instagram.toca_schedule.reschedule` remains fail-closed through `toca.execute` because the underlying operation is a cancel-then-schedule sequence rather than one transactional idempotent mutation. The binding includes deterministic recovery logic for sequential replay, but a concurrent interruption/race can still leave ambiguity between cancellation and replacement persistence. M-FOUND-11 therefore does not claim this binding as validated.

`meta_ads.campaign.create_paused` remains canonically `IMPLEMENTED`, not `PRODUCTION_VALIDATED`, and its binding is also explicitly unvalidated. The current provider service can partially progress across campaign/ad-set/creative/ad creation and is not a transactional idempotency boundary. A future catalog promotion alone must not make it executable.

Capability discovery uses the same binding-maturity rule, so `toca.capabilities.search` / `describe` cannot advertise an unvalidated side-effect binding as executable while `toca.execute` would refuse it.

## Approval descriptor and requester binding

The facade does not accept a caller-defined approval descriptor.

The descriptor is reconstructed from the typed runtime payload and includes:

- canonical capability ID;
- authenticated principal ID;
- tenant ID;
- workspace ID;
- organization ID;
- parsed payload;
- resolved target account;
- deterministic idempotency key;
- financial context when supplied by the binding.

The descriptor uses canonical SHA-256 hashing through the existing Approval Engine. Payload drift, requester drift, tenant/workspace/organization drift, target drift, idempotency drift or financial drift therefore changes the descriptor hash.

Formal approval remains atomic through the existing lifecycle:

`APPROVED → RESERVED → EXECUTING → PROVIDER_READBACK → CONSUMED`

No parallel approval subsystem was introduced.

## Provider read-back and audit binding

Every executable side effect must have a runtime `providerReadback` binding.

The core binds successful execution audit records to:

- `core:descriptor-sha256:<exact execution descriptor hash>`;
- normalized provider/store read-back evidence;
- the exact `externalResourceId` confirmed by read-back.

TOCA-managed Instagram scheduler create read-back must prove the resulting job is `SCHEDULED`; cancellation read-back must prove the target job is `CANCELED`. Each records the job ID as `externalResourceId`.

## `toca.verify`

`toca.verify` now requires all of the following:

- immutable audit chain is valid;
- execution ID and correlation locate the audited execution;
- authenticated tenant matches every selected execution record;
- authenticated requester matches the audited requester;
- requested capability resolves to the same canonical capability recorded in audit;
- typed payload reconstructs the exact descriptor hash stored in the successful audit record;
- for side effects, fresh read-back returns non-empty evidence;
- for side effects, fresh read-back identifies a resource;
- the fresh read-back resource ID equals the resource ID captured in the successful audit record.

This prevents a caller-supplied `result` from redirecting verification to an unrelated provider resource while still reporting success.

## Authorization and account scope

A static review found that account-scoped Meta Ads read bindings already resolved `targetAccount`, but the Core only forwarded that target into `authorizeExecution` for side effects. That meant `allowedTargetAccounts` could be bypassed for account-scoped reads.

The Core now forwards any resolved target account, including reads. A token/principal scoped to one ad account cannot use `toca.execute` to read another account merely because the capability itself is allowed.

## Durable workflow facade

The facade reuses M-FOUND-06 `WorkflowStore` and its transactional outbox behavior.

`toca.workflow.create`:

- derives tenant/workspace/organization/requester from authenticated identity;
- derives a deterministic workflow ID from tenant + idempotency key;
- resolves step capability aliases and persists canonical capability IDs;
- delegates state/dependency/idempotency persistence to the existing durable workflow engine.

`toca.workflow.advance` remains tenant-scoped. A static review identified a cross-workflow mutation hazard in `CLAIM_HUMAN_TASK` and `COMPLETE_HUMAN_TASK`: the underlying store mutations are keyed by `taskId`, while the facade accepted a separate `workflowId`.

The facade now verifies that the task belongs to the already-authorized workflow snapshot before invoking either mutation. The post-mutation tenant assertion remains defense in depth.

Global worker-wide operations remain outside the public ChatGPT facade.

## Approval reads

`ApprovalRecord` currently does not persist tenant/workspace/organization scope. The earlier `toca.approval.get` implementation allowed generic `APPROVER`/`ADMIN` roles to read arbitrary approval IDs, which was not demonstrably safe in a multi-tenant future.

M-FOUND-11 now fails closed to requester-owned reads only. This is a mitigation, not a claim that the underlying ApprovalRecord is tenant-native: identical principal IDs across tenants cannot be proven distinct from the record alone. A future foundation change must add tenant scope before broad approver queries are exposed.

## Reconciliation with current `main`

### Measurement / Ticketing / Attribution — PR #111

PR #111 added Measurement/Ticketing/Attribution files without modifying the six M-FOUND-11 files. Its domain-local registration is internal audit/capability metadata and does not expose new MCP tools or imply provider connectivity/production validation.

No Measurement runtime binding or dedicated MCP tool was added by M-FOUND-11. Future execution can use `toca.execute` only after canonical lifecycle plus an explicit typed runtime binding satisfy the Core gates.

### Google Business

Google Business contracts are present in `main` and remain internal/domain capabilities. Public writes are `IMPLEMENTED`, not `PRODUCTION_VALIDATED`, and M-FOUND-11 does not add runtime bindings or MCP tools for them.

### CRM Core

CRM Core is merged and tenant/workspace/organization scoped. No `toca.crm.*` facade was added. CRM capabilities can use `toca.execute` later when canonical executable contracts and bindings exist.

### Privacy and other concurrent fronts

Privacy, Google Ads, Video and Omnichannel work were still separate open PRs during this reconciliation and were not part of the validated `main` base. M-FOUND-11 does not copy or anticipate their implementations.

### EventRecord, Outbox, Audit Ledger, Workflow and Approval foundations

- `toca.event.get` reuses `EventRecordStore` and enforces tenant equality before returning data;
- `PostgresEventRecordStore` and `PostgresWorkflowStore` continue using the existing Transactional Outbox;
- the immutable Audit Ledger remains the sole execution audit sink;
- durable workflow concurrency/versioning remains owned by the existing workflow store;
- formal approval reservation/consumption remains owned by the existing Approval Engine.

No parallel infrastructure was created.

## MCP schema and annotation review

The surface remains Zod-typed and bounded for IDs, evidence arrays, search limits, workflow steps, dates and discriminated workflow transitions.

MCP idempotency annotations were corrected:

- deterministic `toca.workflow.create`: `idempotentHint: true`;
- `toca.workflow.advance`: `idempotentHint: false`;
- `toca.approval.request`: `idempotentHint: false`;
- `toca.execute`: conservative `idempotentHint: false`.

## Vitest regression coverage authored

`tests/m-found-11-core-surface.test.ts` now contains coverage for:

1. exact 12-tool public facade;
2. catalogued capability without active runtime binding fails closed;
3. runtime lifecycle promotion beyond canonical maturity fails before handler execution;
4. unvalidated side-effect runtime binding fails before handler execution;
5. target-account authorization is enforced for account-scoped reads;
6. descriptor hash changes on payload drift and requester/tenant drift;
7. side effect without read-back fails before handler execution;
8. read-back without exact resource identity fails;
9. successful side effect records descriptor evidence + provider evidence + resource ID in audit;
10. human-task ID outside the authorized workflow is rejected before mutation;
11. generic `ADMIN` cannot read another requester's ApprovalRecord.

The tests use in-memory stores and simulated handlers. No provider write or advertising spend is part of their design.

**These tests are authored but not certified as passing on the final head until the repository Quality Gate can execute.**

## Quality evidence and blocker

Historical PR #107 Quality evidence:

- run `31866485005`: formatting failure; repository Prettier was subsequently applied;
- run `31866564398`: format and architecture passed; lint identified localized resolver typing issues, which were subsequently corrected;
- run `31866620290` and later heads: GitHub Actions could not start because of the account/billing lock and returned startup failure;
- run `31869397264` on an intermediate hardened head also completed as `startup_failure` with zero jobs created.

Recent code/documentation commits continue to require a fresh fixed-head Quality run when Actions becomes available. Static inspection is not a substitute.

Local Quality could not be truthfully executed in the available assistant container because:

- the repository is not mounted there;
- network cloning is unavailable in that container;
- `pnpm`, Vitest, ESLint and Prettier are not installed there;
- the available runtime is Node `22.16.0` / TypeScript `5.8.3`, while `package.json` requires Node `>=24`, pnpm `10.15.0` and project TypeScript `6.x`.

Static source/contract review and GitHub-side inspection are evidence only. They are **not** substitutes for repository `pnpm quality` or official GitHub Actions.

## Remaining risks

1. **Official Quality is pending.** Repository Prettier, architecture checks, ESLint, TypeScript 6 typecheck, Vitest and build are not certified on the final head until Actions can run.
2. **ApprovalRecord is not tenant-scoped in its persisted contract.** Requester-only reads reduce exposure but cannot prove isolation if principal IDs collide across tenants.
3. **EventRecordStore.get is ID-based rather than tenant-parameterized.** The facade enforces a tenant check before return; storage-level tenant predicate hardening belongs to the EventRecord contract.
4. **Scheduler reschedule remains intentionally non-executable through Core** until replay/concurrency/idempotency is transactional or otherwise proven.
5. **Meta Ads create-paused remains intentionally non-executable through Core** until lifecycle evidence and runtime idempotency/partial-failure guarantees are proven.
6. **No live provider smoke was performed.** M-FOUND-11 does not infer production validation from static behavior.

## Non-goals preserved

M-FOUND-11 does **not**:

- create `R33`;
- create another MCP server;
- create another orchestrator;
- create another registry;
- expose hundreds of capabilities as MCP tools;
- add dedicated CRM/Measurement/Privacy/Google Business tools;
- promote provider writes without evidence;
- weaken credentials/scopes/config/financial guardrails;
- perform real provider writes in tests;
- merge while Quality is unavailable.

## Fixed-head merge contract

Before merge:

1. GitHub Actions must be able to start normally;
2. revalidate the current `main` SHA;
3. if `main` moved, reconcile the branch again without scope expansion;
4. run full repository `pnpm quality` on the exact reconciled head;
5. require format, architecture, lint, TypeScript typecheck, Vitest and build to be green;
6. inspect the final diff and confirm the public facade is still exactly 12 tools;
7. confirm discovery and execution agree on canonical lifecycle plus `sideEffectValidated` maturity;
8. capture the exact green head SHA;
9. merge PR #107 using `expected_head_sha` equal to that exact green SHA;
10. run/observe post-merge `main` Quality and require it to be green.

Until every item above is satisfied, PR #107 must remain draft and unmerged.
