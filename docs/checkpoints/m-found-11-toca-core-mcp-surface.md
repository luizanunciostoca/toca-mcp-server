# M-FOUND-11 — TOCA Core MCP Surface

Status: **IMPLEMENTED + HARDENED — MERGE BLOCKED UNTIL FIXED-HEAD QUALITY IS GREEN**

Milestone: `TOCA_OS_MARKETING_SALES_FOUNDATION_v1`

Initial branch base: `76aec57a707161f4ca8484059b8ec302b9be6910` (M-FOUND-09).

Current reconciled `main` base: `b0d067e9cc6b469fdb1421ab7a25a25a3b0f1f47` (Measurement / Ticketing Read-Only / Attribution foundation, PR #111). The branch was rebuilt cleanly on this SHA while preserving only the six M-FOUND-11 files.

This base also includes M-FOUND-10 CRM Core Records from PR #102 and Google Business foundation from PR #106.

## Objective

Expose TOCA Core to ChatGPT through a deliberately small, governed and stable MCP facade without turning the internal capability catalog into hundreds of MCP tools and without creating another MCP server, router, orchestrator, workflow engine, scheduler, approval engine, audit ledger or capability registry.

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

Provider/domain capabilities remain internal. New CRM, Measurement, Privacy, Google Business or other capabilities are not promoted into dedicated MCP tools merely for convenience.

## Execution pipeline

`toca.execute` enforces:

`authenticated identity → canonical capability/alias → active runtime binding → typed input schema → authorization → policy/risk → exact approval descriptor → idempotency → handler/provider → mandatory read-back → immutable audit`

Hardening after reconciliation adds these fail-closed requirements:

- runtime risk class must equal the canonical capability contract;
- runtime side-effect metadata must equal the canonical contract;
- runtime lifecycle status must equal the canonical lifecycle status;
- runtime idempotency metadata must equal the canonical contract;
- runtime formal-approval semantics must equal the canonical contract;
- a local/runtime registry cannot promote a capability above the canonical lifecycle;
- every side effect must expose deterministic idempotency before execution;
- every side effect must define read-back before execution;
- successful side-effect read-back must contain non-empty evidence and identify the exact external/internal resource read back;
- formal-approval capabilities must resolve a target account;
- catalog-only capabilities remain non-executable without an explicit runtime binding.

## Approval descriptor and requester binding

The facade does not accept a free-form approval descriptor.

The descriptor is reconstructed from the typed runtime payload and now includes:

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

No new approval subsystem was introduced.

## Provider read-back and audit binding

Every side effect must have a runtime `providerReadback` binding.

The core now binds successful execution audit records to:

- `core:descriptor-sha256:<exact execution descriptor hash>`;
- normalized provider/read-store evidence;
- the exact `externalResourceId` confirmed by read-back.

TOCA-managed Instagram scheduler create/reschedule read-back must prove the job is `SCHEDULED`; cancellation read-back must prove the job is `CANCELED`. Each path records the job ID as `externalResourceId`.

Meta Ads create-paused remains canonically `IMPLEMENTED`, not `PRODUCTION_VALIDATED`, and therefore remains lifecycle-blocked. Its existing future binding reads the campaign back and requires paused state, but M-FOUND-11 does not promote it.

## `toca.verify`

`toca.verify` now rejects ambiguous replay/confusion paths by requiring all of the following:

- immutable audit chain is valid;
- execution ID and correlation locate the audited execution;
- authenticated tenant matches every selected execution record;
- authenticated requester matches the audited requester;
- requested capability resolves to the same canonical capability recorded in audit;
- typed payload reconstructs the exact descriptor hash stored in the successful audit record;
- for side effects, fresh read-back returns non-empty evidence;
- for side effects, fresh read-back identifies a resource;
- the fresh read-back resource ID equals the resource ID captured in the successful audit record.

A caller-supplied `result` can therefore no longer redirect verification to an unrelated provider resource while still reporting success.

## Capability discovery and lifecycle maturity

`toca.capabilities.search` and `toca.capabilities.describe` read the effective canonical catalog, not MCP registration count.

A capability is reported executable only when:

- the active `ToolRegistry` contains the canonical capability;
- a typed runtime binding exists;
- the durable audit store required by `toca.execute` exists;
- runtime risk, side effects, lifecycle, idempotency and approval semantics match the canonical contract;
- lifecycle is operational;
- side effects are `PRODUCTION_VALIDATED`;
- side effects expose idempotency and read-back bindings;
- formal approval persistence exists when formal approval is required.

This prevents runtime/local metadata from manufacturing lifecycle maturity or executable status.

## Durable workflow facade

The facade continues to reuse M-FOUND-06 `WorkflowStore` and its transactional outbox behavior.

`toca.workflow.create`:

- derives tenant/workspace/organization/requester from authenticated identity;
- derives a deterministic workflow ID from tenant + idempotency key;
- resolves step capability aliases and persists canonical capability IDs;
- delegates state/dependency/idempotency persistence to the existing workflow engine.

`toca.workflow.advance` remains tenant-scoped. A static review identified a cross-workflow mutation hazard in `CLAIM_HUMAN_TASK` and `COMPLETE_HUMAN_TASK`: the store APIs mutate by `taskId`, while the facade separately accepted `workflowId`. The facade now verifies that the task belongs to the already-authorized workflow snapshot before invoking either mutation. The post-mutation tenant assertion remains as defense in depth.

Global worker-wide operations remain outside the public ChatGPT facade.

## Approval reads

`ApprovalRecord` currently does not carry tenant/workspace/organization scope. The previous `toca.approval.get` allowed a generic `APPROVER`/`ADMIN` role to read arbitrary approval IDs, which was not demonstrably safe for future multi-tenant operation.

M-FOUND-11 now fails closed: `toca.approval.get` is requester-owned only. Broader approver visibility requires a future tenant-scoped Approval Engine contract rather than a facade-level role bypass.

## Reconciliation with current main

### Measurement / Ticketing / Attribution — PR #111

PR #111 added Measurement/Ticketing/Attribution files without modifying any of the six M-FOUND-11 files. Its domain-local `registerMeasurementAuditCapabilities` explicitly registers internal audit metadata and states that it does not expose MCP tools or imply provider connectivity/production validation.

No Measurement MCP tools or runtime bindings were added by M-FOUND-11. Future execution can use `toca.execute` only after canonical lifecycle + explicit typed runtime binding requirements are satisfied.

### Google Business

Google Business contracts are present in main and remain internal/domain capabilities. Public writes are `IMPLEMENTED`, not `PRODUCTION_VALIDATED`, and no M-FOUND-11 runtime resolver binding promotes or exposes them.

### CRM Core

CRM Core is merged and tenant/workspace/organization scoped. No `toca.crm.*` facade was added. CRM capabilities can use `toca.execute` later when canonical executable contracts and bindings exist.

### Privacy and other concurrent fronts

Privacy, Google Ads, Video and Omnichannel work remain in separate open PRs at this checkpoint and are not part of the validated `main` base. M-FOUND-11 does not copy or anticipate their implementation.

### EventRecord, Outbox, Audit Ledger, Workflow and Approval foundations

- `toca.event.get` reuses `EventRecordStore` and enforces tenant equality before returning data;
- `PostgresEventRecordStore` and `PostgresWorkflowStore` continue using the existing Transactional Outbox;
- the immutable Audit Ledger remains the sole execution audit sink;
- durable workflow concurrency/versioning remains owned by the existing workflow store;
- formal approval reservation/consumption remains owned by the existing Approval Engine.

No parallel infrastructure was created.

## MCP schema/annotation review

The surface remains Zod-typed and bounded for IDs, evidence arrays, search limits, workflow steps, dates and discriminated workflow transitions.

MCP idempotency hints were corrected:

- deterministic `toca.workflow.create` remains `idempotentHint: true`;
- `toca.workflow.advance` is now `idempotentHint: false` because state transitions such as human-task claim are not generally replay-safe as an MCP operation;
- `toca.approval.request` is now `idempotentHint: false` because it creates a new ApprovalRecord;
- `toca.execute` remains conservative with `idempotentHint: false`.

## Acceptance tests

`tests/m-found-11-core-surface.test.ts` now covers:

1. exact 12-tool public facade;
2. catalogued capability without active runtime binding fails closed;
3. runtime lifecycle promotion beyond canonical maturity fails before handler execution;
4. descriptor hash changes on payload drift and requester/tenant drift;
5. side effect without read-back fails before handler execution;
6. read-back without exact resource identity fails;
7. successful side effect records descriptor evidence + provider evidence + resource ID in audit;
8. human-task ID outside the authorized workflow is rejected before mutation;
9. a generic `ADMIN` cannot read another requester's ApprovalRecord.

Tests use in-memory stores and simulated handlers only. No provider write or advertising spend is performed by the test design.

## Quality evidence and blocker

Historical PR #107 Quality evidence:

- run `31866485005`: formatting failure; repository Prettier was applied;
- run `31866564398`: format and architecture checks passed; lint exposed localized resolver typing issues, which were fixed;
- run `31866620290` and later heads: GitHub Actions could not start because of the account/billing lock and returned startup failure.

After the current reconciliation/hardening, run `31869397264` on head `b9ad6fd01ba5b78a85cc92b1388d7becd396d318` also completed as `startup_failure` with zero jobs created.

Local Quality could not be truthfully executed in the available assistant container because:

- the repository is not mounted locally;
- network cloning is unavailable in that container;
- `pnpm`, Vitest, ESLint and Prettier are not installed there;
- available runtime is Node `22.16.0` / TypeScript `5.8.3`, while `package.json` requires Node `>=24`, pnpm `10.15.0` and project TypeScript `6.x`.

Static review and GitHub-side source/contract inspection are evidence only. They are **not** substitutes for repository `pnpm quality` or the official GitHub Actions Quality Gate.

## Remaining risks

1. **Official Quality is pending.** Lint, repository Prettier, TypeScript 6 typecheck, Vitest, architecture checks and build are not certified on the final head until Actions can run.
2. **ApprovalRecord is not tenant-scoped in its persisted contract.** The MCP facade mitigates this by requester-only reads; broader tenant-safe approver queries require a foundation change outside M-FOUND-11.
3. **EventRecordStore.get is ID-based rather than tenant-parameterized.** The facade performs a mandatory tenant check before returning the EventRecord, but storage-level tenant predicate hardening belongs to the EventRecord contract rather than this milestone.
4. **No new provider capabilities are promoted.** Measurement, CRM, Google Business and concurrent fronts remain non-executable through `toca.execute` unless an explicit canonical runtime binding and required lifecycle evidence are added later.
5. **No live provider smoke test was performed.** This milestone must not infer production validation from static/local behavior.

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
5. require format, architecture, lint, typecheck, Vitest and build to be green;
6. inspect the final diff and confirm the public facade is still exactly 12 tools;
7. capture the exact green head SHA;
8. merge PR #107 using `expected_head_sha` equal to that exact green SHA;
9. run/observe post-merge `main` Quality and require it to be green.

Until all items above are satisfied, PR #107 must remain draft and unmerged.
