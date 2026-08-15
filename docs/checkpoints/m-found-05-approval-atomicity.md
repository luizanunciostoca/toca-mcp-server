# M-FOUND-05 — Approval Engine Atomicity

Status: **VALIDATED IN BRANCH — READY TO MERGE**

Milestone: `TOCA_OS_MARKETING_SALES_FOUNDATION_v1`

Base main SHA: `a25f60b11a75c73145ec24525c0b79f72b67b53a`

Validated Quality Gate: `31861261004` / run `#999` — **SUCCESS**

## Objective

Make formal approvals safe under concurrency, provider ambiguity and retry pressure by binding one approval to one execution before any external side effect and consuming it only after provider-backed readback proves the expected state.

M-FOUND-05 does not promote any external-write capability. It establishes the execution control required before such promotion can be considered.

## Approval lifecycle

The governed lifecycle is now:

`REQUESTED → APPROVED → RESERVED → EXECUTING → PROVIDER_READBACK → CONSUMED`

Additional controlled states are:

- `RELEASED`: a reservation was safely released **before provider execution began** and the approval may be reserved again with a new execution ID;
- `FAILED_REVIEW_REQUIRED`: provider execution began or provider state became ambiguous, therefore automatic retry/reuse is blocked;
- `REVOKED`;
- `EXPIRED`.

`APPROVED` and `RELEASED` are the only reservable states.

## Atomic reservation

`ApprovalStore` now exposes a single atomic `transition()` boundary for execution-lifecycle transitions.

The PostgreSQL implementation:

1. starts a database transaction;
2. locks the approval row with `SELECT ... FOR UPDATE`;
3. for `RESERVE`, inserts an immutable execution claim into `approval_execution_claims`;
4. validates and applies the transition against the locked current record;
5. updates the approval row;
6. appends the new version to `approval_record_history`;
7. commits atomically.

Any failure rolls the transaction back.

The execution-claim ledger uses `execution_id` as the primary key. An execution ID can therefore never be reused across approvals or after a prior release.

## Execution binding

A reservation binds the approval to:

- `executionId`;
- authenticated `principalId`;
- execution `correlationId`;
- reservation timestamp.

The principal must match the requester already bound to the approval expectation.

Every later transition verifies the same execution ID.

## Provider boundary

For `WRITE_EXTERNAL`, `FINANCIAL_IMPACT` and `DESTRUCTIVE` tools, `executeTool()` now supports a formal `approvalExecution` contract containing:

- approval ID;
- ApprovalStore;
- provider-readback callback;
- optional deterministic clock for tests.

A production-validated formal-approval write cannot execute merely because a caller supplied a valid ApprovalRecord object. If the atomic ApprovalStore/readback contract is missing, execution is denied with `APPROVAL_ATOMICITY_REQUIRED`.

## Execution algorithm

For a formal-approval write the executor performs:

1. load the latest approval from the authoritative store;
2. evaluate identity, authorization and formal approval against that stored record;
3. atomically reserve the approval for the generated execution ID;
4. persist audit `STARTED`;
5. transition to `EXECUTING`;
6. invoke the provider action exactly once;
7. invoke provider readback;
8. if readback proves expected state with evidence, persist `PROVIDER_READBACK`;
9. persist `CONSUMED`;
10. only then persist audit `SUCCEEDED` and return success.

The passed-in approval snapshot is therefore not the final concurrency authority; the store is.

## Safe release boundary

`RELEASE` is accepted only from `RESERVED`.

Examples of safe release conditions:

- audit cannot be persisted before provider execution;
- execution-state transition fails before the provider action is invoked.

Once state is `EXECUTING`, release is forbidden.

## Ambiguous provider outcomes

If provider execution throws after invocation begins, automatic retry is unsafe because the remote side effect may have completed.

The approval moves to `FAILED_REVIEW_REQUIRED` and the executor returns non-retryable `APPROVAL_REVIEW_REQUIRED`.

The same rule applies when:

- provider readback throws;
- provider readback cannot prove expected state;
- readback evidence cannot be persisted after the provider side effect.

If provider readback was already persisted but final consumption persistence fails, the record remains in `PROVIDER_READBACK`, which is non-reservable and therefore fail-closed for reconciliation rather than replay.

## Provider readback evidence

Consumption requires:

- prior `PROVIDER_READBACK` state;
- `providerReadbackAt`;
- at least one non-empty provider readback evidence item.

The database migration enforces this structurally for `PROVIDER_READBACK` and `CONSUMED` rows.

## PostgreSQL migration

`migrations/006_approval_execution_atomicity.sql` adds:

- reservation/execution/readback/release/failure columns;
- expanded status constraint;
- execution-binding checks;
- provider-readback evidence checks;
- release/failure checks;
- `approval_execution_claims` immutable execution-ID ledger;
- indexes for active/ambiguous approval states.

The migration is versioned and ready for the repository migration runner. This milestone does not claim the migration is already applied to production merely because the SQL exists in GitHub.

## Compatibility and safety

- direct `ApprovalStore.put()` is forbidden for execution lifecycle states; those states require `transition()`;
- request/issue/revoke/expire remain direct versioned governance operations;
- legacy approval history is normalized with empty/null execution fields when read;
- `consumeApproval()` remains as an internal compatibility helper but now requires `PROVIDER_READBACK` and execution binding;
- capability route validation accepts the canonical primary route plus declared consumer routes from M-FOUND-03;
- no provider mutation is executed by M-FOUND-05 tests;
- no lifecycle status is promoted.

## Acceptance criteria

M-FOUND-05 is complete when:

1. `RESERVED`, `EXECUTING`, `PROVIDER_READBACK`, `RELEASED` and `FAILED_REVIEW_REQUIRED` exist in the canonical approval lifecycle;
2. PostgreSQL reservation uses row locking and an immutable execution-ID claim in one transaction;
3. concurrent/replayed use cannot execute the provider twice;
4. formal-approval writes cannot bypass the atomic store contract;
5. release is impossible after provider execution starts;
6. provider/readback ambiguity becomes non-retryable review-required state;
7. consumption is impossible before evidence-backed provider readback;
8. audit success occurs only after consumption persistence;
9. tests cover happy path, bypass denial, release, provider failure, readback failure and replay blocking;
10. full repository Quality Gate passes;
11. merge uses a fixed green head SHA;
12. post-merge main Quality Gate passes.

## Exit

After validation, proceed to `M-FOUND-06 — Durable Workflow Persistence`.
