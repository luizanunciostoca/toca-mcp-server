# M-FOUND-11 — TOCA Core MCP Surface

Status: **IMPLEMENTED — MERGE BLOCKED UNTIL FULL QUALITY CAN RUN**

Milestone: `TOCA_OS_MARKETING_SALES_FOUNDATION_v1`

Initial branch base: `76aec57a707161f4ca8484059b8ec302b9be6910` (M-FOUND-09)

Reconciled `main` base: `88de675febdb1142f65c1354effef2ef2a9e0588` via mechanical sync PR #110. This base includes M-FOUND-10 CRM Core Records from PR #102 (`a33bfb18614b01b1f263edd1d8dee497c3a47495`) and Google Business foundation PR #106.

## Objective

Expose TOCA Core to ChatGPT through a deliberately small, governed and stable MCP facade without turning the internal capability catalog into hundreds of MCP tools and without creating a second MCP server, router, orchestrator or capability registry.

ChatGPT remains the reasoning/orchestration layer. `toca-mcp-server` remains the deterministic execution boundary. The canonical capability catalog, policy engine, approval lifecycle, durable workflows, audit ledger, provider adapters and EventRecord stores remain the underlying source contracts.

## Public MCP facade

The public surface is exactly 12 tools:

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

Existing provider services and adapters are no longer registered as independent ChatGPT-facing MCP tools by `createTocaServer`. They are resolved internally by `toca.execute` through explicit typed runtime bindings over the existing `ToolRegistry` and canonical capability catalog.

The runtime resolver is a dispatch adapter, not another registry: catalog membership and lifecycle remain canonical in `src/governance/capability-catalog.ts`, while active runtime enablement remains canonical in `src/registry.ts`.

## Execution pipeline

`toca.execute` resolves and enforces:

`authenticated identity → canonical capability/alias → active runtime binding → typed input schema → risk/authorization → policy → exact approval descriptor → idempotency binding → handler/provider → mandatory read-back for side effects → immutable audit`

Important properties:

- identity is mandatory for execution;
- a catalogued capability without an active runtime binding fails with `CAPABILITY_NOT_EXECUTABLE`;
- runtime risk and side-effect metadata must match the canonical capability contract;
- executable payloads are parsed by concrete runtime schemas before policy/execution;
- every side effect must resolve deterministic idempotency before the handler is invoked;
- every side effect must define provider/read-store read-back before the handler is invoked;
- formal-approval capabilities must resolve a target account;
- writes still depend on existing lifecycle policy, so a side-effect capability that is not `PRODUCTION_VALIDATED` remains denied;
- no test performs a real provider write or spends budget.

## Exact approval binding

The facade does not accept a free-form approval descriptor.

`toca.approval.request` parses the exact capability payload through the same runtime schema used by execution and constructs a canonical descriptor containing:

- canonical capability ID;
- parsed payload;
- resolved target account;
- deterministic idempotency key;
- financial context when the runtime binding can derive one.

The existing approval engine hashes this descriptor with stable SHA-256 canonicalization. `toca.execute` reconstructs the same descriptor. Any material payload, target, idempotency or financial change therefore changes the descriptor hash and invalidates the ApprovalRecord.

Formal approval remains atomic through the existing lifecycle:

`APPROVED → RESERVED → EXECUTING → PROVIDER_READBACK → CONSUMED`

No new approval subsystem was created.

## Mandatory provider read-back

A side-effect runtime binding without `providerReadback` is rejected before its handler can execute.

For reversible internal scheduler writes, read-back is performed against the durable scheduler store. For provider writes, the binding must re-read the provider and prove the expected state. Current Meta Ads create-paused binding remains lifecycle-blocked from production execution; if its canonical lifecycle is later promoted, its binding reads the campaign back and requires PAUSED state.

`toca.verify` independently verifies the immutable audit chain and performs a fresh read-back for side effects through the same runtime binding. It requires execution ID, correlation ID, canonical capability, typed payload and execution result, and checks that the audit execution was for that capability inside the authenticated tenant.

## Capability discovery

`toca.capabilities.search` and `toca.capabilities.describe` read the effective canonical catalog rather than MCP tool registration count.

A capability is reported executable only when:

- the active runtime `ToolRegistry` contains it;
- an internal typed runtime binding exists;
- its lifecycle is operational;
- side-effect capabilities are `PRODUCTION_VALIDATED`.

This prevents catalog-only capabilities from being treated as executable.

## Workflow facade

The facade reuses the M-FOUND-06 `WorkflowStore` and its transactional outbox behavior.

`toca.workflow.create` derives tenant/workspace/organization/requester from authenticated identity, derives a deterministic workflow ID from tenant + idempotency key, validates referenced capability IDs against the canonical catalog, and delegates persistence/dependency validation to the existing workflow engine.

`toca.workflow.get` and `toca.workflow.advance` enforce tenant isolation. `advance` exposes evidence-bearing transitions for completed/failed/retried steps, human tasks, timers and compensation activation without creating another scheduler or state engine.

Global worker operations such as claiming arbitrary ready steps or firing due timers are intentionally not exposed because the current store methods are worker-wide rather than tenant-scoped.

## Approval, audit and EventRecord reads

- `toca.approval.request/get` reuse the existing approval store and requester/approver authority model.
- `toca.audit.query` reuses the immutable Postgres audit ledger and filters results to the authenticated tenant.
- `toca.event.get` reuses the M-FOUND-09 EventRecord store and enforces tenant isolation.

## M-FOUND-10 CRM assessment

M-FOUND-10 was not merged when this branch was first cut, but it was subsequently merged via PR #102 and entered this branch during the main reconciliation.

A controlled CRM read was evaluated and deliberately **not** added to the public facade. M-FOUND-10 itself states that CRM persistence does not create a new MCP tool merely because the store exists and does not mark CRM as `PRODUCTION_VALIDATED`. `CrmCoreStore` is an internal persistent domain contract with scoped query methods, but there is no canonical runtime capability binding that requires a dedicated ChatGPT-facing CRM tool in M-FOUND-11.

Adding `toca.crm.*` would expand the facade without necessity and would bypass the intended capability lifecycle. Future CRM capabilities can be exposed through `toca.execute` by adding canonical runtime bindings when their contracts/lifecycle are ready, without changing the control-plane facade.

## Runtime wiring

`createTocaServer` creates one MCP server and registers only the TOCA Core facade. Existing Instagram history, Meta Ads read/write and TOCA-managed scheduler services are instantiated under existing feature/config gates and supplied to an internal runtime resolver.

No second MCP server, AI brain, router, workflow engine, scheduler, approval engine, audit ledger or capability registry is introduced.

## Acceptance tests

`tests/m-found-11-core-surface.test.ts` explicitly verifies:

1. the public facade is exactly the 12 expected `toca.*` tools;
2. a catalogued capability without a runtime binding is not executable;
3. a production-validated external write cannot execute without a formal approval;
4. changing the typed payload invalidates an already-issued approval before the provider handler runs;
5. a side effect without provider read-back is rejected before the handler runs.

The tests use in-memory stores and simulated handlers only. They do not call providers or consume advertising budget.

## Quality evidence and current blocker

Quality history on PR #107:

- run `31866485005`: stopped at repository formatting; implementation was reformatted with the repository's own Prettier configuration;
- run `31866564398`: format and architecture checks passed; lint identified localized typing issues in `src/mcp/runtime-capability-resolver.ts`;
- those lint findings were fixed by replacing `any` result handling with typed generic runtime bindings and removing unnecessary async/unused imports;
- subsequent full Quality could not start because GitHub Actions reported: `The job was not started because your account is locked due to a billing issue.` (run `31866620290`);
- later heads continue to receive Actions `startup_failure`, so lint/typecheck/tests/build cannot currently be truthfully certified green by CI.

Additional static review after the Actions lock corrected strict TypeScript hazards in approval dependency narrowing, optional durable audit wiring and typed Vitest handler mocks.

This checkpoint must **not** be interpreted as a green Quality Gate. PR #107 remains draft and must not be merged until a full repository `pnpm quality` runs successfully on the exact final head.

## Non-goals

M-FOUND-11 does **not**:

- create `R33`;
- expose the full capability catalog as MCP tools;
- create a dedicated CRM MCP surface;
- promote provider writes to `PRODUCTION_VALIDATED`;
- weaken provider/config/credential requirements;
- create approval authority through ChatGPT;
- perform external provider writes in tests;
- create another orchestrator or registry.

## Merge contract

Before merge:

1. GitHub Actions must be able to start normally;
2. full repository `pnpm quality` must pass on the exact PR head;
3. current `main` SHA must be revalidated and the branch reconciled if it moved;
4. any reconciliation must be followed by another full Quality run;
5. PR #107 must be merged with `expected_head_sha` equal to the exact green head;
6. post-merge `main` Quality must be green.
