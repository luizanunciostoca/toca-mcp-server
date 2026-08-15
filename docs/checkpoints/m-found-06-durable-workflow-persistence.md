# M-FOUND-06 — Durable Workflow Persistence

Status: **VALIDATED IN RUNNER — OFFICIAL QUALITY GATE PENDING**

Milestone: `TOCA_OS_MARKETING_SALES_FOUNDATION_v1`

Base main SHA: `166b4e98a636c0fd5b64c849fd3af986d0593b9e`

Validated full repository run: `31862801088` — **SUCCESS** (`pnpm quality`)

## Objective

Convert governance state-machine concepts into durable business workflow instances that survive process restarts, retries, human waits and timer waits without turning the MCP server into a monolithic orchestrator.

M-FOUND-06 provides deterministic persistence primitives. M-FOUND-07 remains responsible for the generic transactional outbox/event-delivery layer.

## Durable entities

The foundation now defines and persists:

1. `workflow_instances` — one durable execution of an existing R01–R32 route/definition;
2. `workflow_steps` — executable or cognitive/provider-independent durable steps;
3. `workflow_dependencies` — explicit DAG edges between steps;
4. `workflow_events` — append-only workflow history/evidence events;
5. `workflow_human_tasks` — durable human waits, claims and completions;
6. `workflow_timers` — durable scheduled waits and wake-ups;
7. `workflow_compensations` — persisted rollback/compensation intents.

A separate `workflow_execution_claims` ledger makes step/compensation execution IDs immutable and globally non-reusable.

## Workflow identity and tenancy

Every workflow instance is bound to:

- `routeId` within R01–R32;
- definition ID + version;
- idempotency key;
- correlation ID;
- tenant ID;
- workspace ID;
- organization ID;
- requester principal ID.

The PostgreSQL schema enforces `(tenant_id, idempotency_key)` uniqueness. Repeating the same workflow ID/key returns the existing workflow; attempting to reuse the same tenant/key for another workflow ID is an idempotency conflict.

## Workflow DAG

A workflow blueprint is validated before persistence:

- at least one step is required;
- step IDs must be unique;
- max attempts must be positive integers;
- dependencies must reference existing steps;
- self-dependencies are forbidden;
- duplicate dependency edges are forbidden;
- cycles are rejected.

Root steps begin `READY`; dependent steps begin `PENDING` and become `READY` only when all dependencies have succeeded.

## Instance lifecycle

Durable workflow instance states are:

- `RUNNING`;
- `WAITING`;
- `BLOCKED`;
- `SUCCEEDED`;
- `FAILED`;
- `CANCELED`.

The current store derives active state from durable step state after relevant transitions. A failed step blocks the workflow until an explicit retry or compensation decision occurs.

## Step lifecycle and attempt semantics

Durable step states are:

- `PENDING`;
- `READY`;
- `RUNNING`;
- `WAITING_HUMAN`;
- `WAITING_TIMER`;
- `SUCCEEDED`;
- `FAILED`;
- `SKIPPED`;
- `BLOCKED`;
- `CANCELED`.

A fresh execution attempt increments `attempts` once. A step resuming from `WAITING_HUMAN` or `WAITING_TIMER` preserves its existing `startedAt` marker and **does not consume an additional retry attempt** merely because another worker reclaims the resumed step. This remains true even when the step has already reached its configured `maxAttempts`; continuation of the same attempt is allowed, while a genuinely new retry is not.

Each claim binds:

- worker ID;
- immutable execution ID;
- claim timestamp;
- attempt metadata.

Completion/failure must present the matching claim execution ID. Stale workers therefore cannot complete or fail a step they no longer own.

## Durable human tasks

A running claimed step may atomically open a human task only when it supplies its current execution ID.

The step enters `WAITING_HUMAN`; the workflow becomes `WAITING` when no other runnable work remains.

Human tasks persist:

- task ID;
- required role;
- assigned principal;
- payload;
- optional due time;
- claim/completion timestamps;
- completion payload;
- evidence;
- version.

If `requiredRole` is set, claiming the task requires that role in the caller's principal-role set. Completion additionally requires the same principal that claimed the task. Completion returns the waiting step to `READY` for deterministic continuation without charging another attempt.

## Durable timers

A running claimed step may schedule a timer only when it supplies its current execution ID.

The step enters `WAITING_TIMER`. Due timers are claimed using `FOR UPDATE SKIP LOCKED`; firing the timer persists `FIRED`, returns the exact step to `READY` and records a workflow event.

Timer continuation does not create a new logical retry attempt. This makes delayed workflows process-restart safe without relying on in-memory timers.

## Retry behavior

Step failure is durable and blocks the workflow. Retry is explicit, evidence-backed and allowed only while the configured max-attempt boundary has not been exhausted.

A genuine retry clears the prior `startedAt` marker. Its next worker claim therefore increments `attempts` and receives a new immutable execution ID. Human/timer continuation keeps `startedAt` and does not increment `attempts`.

The execution-claim ledger prevents execution-ID recycling after completion/failure.

## Compensation persistence

Compensations can be registered for already-successful steps while a workflow is still active. They persist:

- compensation ID;
- source step;
- deterministic reverse-order index;
- optional capability ID;
- input/output;
- status;
- claim metadata;
- completion/error metadata;
- evidence;
- version.

When downstream work fails, a blocked/failed workflow can explicitly activate pending compensations to `READY` in durable storage. Execution of compensation actions remains a deterministic runtime concern built on these persisted records; provider side effects are not performed by this milestone.

`workflow_execution_claims` binds compensation claims with the composite key `(workflow_id, compensation_id)`, preventing a claim from pairing one workflow ID with a compensation owned by another workflow.

## PostgreSQL concurrency controls

The store uses:

- transactions for every mutating workflow operation;
- a canonical lock order of **workflow instance first, step second** for ready-step claims and other workflow mutations;
- `SELECT ... FOR UPDATE` on workflow/step/task records being changed;
- `FOR UPDATE SKIP LOCKED` for competing ready-step workers and due-timer workers;
- an attempt-aware ready-step predicate that permits continuation but rejects exhausted fresh attempts;
- optimistic entity versions;
- unique tenant-scoped idempotency keys;
- immutable execution claim IDs;
- composite workflow/compensation claim integrity;
- repeatable-read read-only transactions for coherent snapshots;
- append-only workflow event inserts.

The instance-first lock order avoids lock inversion against other workflow transactions, while the second step lock revalidates `READY` state after the instance lock has been obtained.

## Persistence migrations

`migrations/007_durable_workflow_persistence.sql` creates the seven primary durable workflow tables and their constraints/indexes, including a composite `(workflow_id, compensation_id)` uniqueness target.

`migrations/008_workflow_execution_claims.sql` creates the immutable execution-ID ledger after step and compensation tables exist and uses a composite foreign key for compensation claims.

These migrations are versioned and ready for the repository migration runner. This checkpoint does **not** claim they have already been applied to production.

## Explicit M-FOUND-07 boundary

M-FOUND-06 deliberately does **not** create:

- `event_outbox`;
- external event dispatch workers;
- provider webhook delivery queues;
- generic cross-system event retries.

Those belong to M-FOUND-07 — Event Bus / Transactional Outbox. `workflow_events` in this milestone are durable internal history/evidence records, not a delivery mechanism.

## Compatibility and architecture

- no R33 is created;
- no second MCP server is created;
- the 731 compatibility capability IDs are unchanged;
- M-FOUND-03 canonical alias resolution remains intact;
- no external-write capability is promoted;
- no provider business write is executed by tests;
- the existing publication scheduler remains a specialized provider scheduler and is not reused as the generic workflow store.

## Acceptance criteria

M-FOUND-06 is complete when:

1. all seven workflow entities are represented in contracts and PostgreSQL;
2. workflow blueprints reject invalid DAGs;
3. workflow creation is idempotent per tenant/key;
4. ready steps are concurrency-safe under competing workers with instance-first lock ordering;
5. stale execution claims cannot complete/fail a step;
6. successful dependencies unlock downstream steps deterministically;
7. retries are explicit and bounded while human/timer continuation does not consume a retry;
8. human waits survive process restarts, are principal-bound and enforce required roles;
9. timers survive process restarts and use due-row locking;
10. compensations are persistable and explicitly activatable after downstream failure;
11. compensation execution claims cannot cross workflow boundaries;
12. coherent snapshots include instance, steps, dependencies, events, human tasks, timers and compensations;
13. no generic event outbox is introduced before M-FOUND-07;
14. full repository Quality Gate passes;
15. merge uses a fixed green head SHA;
16. post-merge main Quality Gate passes.

## Exit

After validation, proceed to `M-FOUND-07 — Event Bus / Transactional Outbox`.
