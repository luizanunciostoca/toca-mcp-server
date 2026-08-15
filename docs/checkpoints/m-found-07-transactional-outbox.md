# M-FOUND-07 — Event Bus / Transactional Outbox

Status: **READY TO MERGE — OFFICIAL PR QUALITY GATE GREEN**

Milestone: `TOCA_OS_MARKETING_SALES_FOUNDATION_v1`

Base main SHA: `c5373bfde8017ff76fa2a9bce882ddb331f7cabe`

Validated bridge run: `31863810927` — **SUCCESS** (`pnpm quality`)

Official PR Quality Gate: run `31863943331` / Quality Gate `#1033` — **SUCCESS**

## Objective

Provide a durable, transactionally coupled event-delivery foundation so committed TOCA OS workflow state can be delivered asynchronously without losing events, duplicating consumer side effects, or coupling business transactions to external providers.

M-FOUND-07 owns generic event envelopes, transactional outbox persistence, dispatcher delivery state, bounded retries/dead-lettering, stale-claim recovery and idempotent consumer receipts. Audit-ledger/observability expansion remains M-FOUND-08; EventRecord remains M-FOUND-09.

## Domain event identity

Every domain event contains:

- `eventId`;
- durable `eventKey`;
- event type and schema version;
- aggregate type, ID and version;
- tenant, workspace and organization IDs;
- correlation and optional causation IDs;
- occurrence timestamp;
- JSON payload;
- evidence.

`eventId` is deterministic from tenant + aggregate + event type + durable `eventKey`. The durable `eventKey` prevents two legitimate same-type events on the same aggregate/version from collapsing into one identity.

The database additionally enforces uniqueness of `(tenant_id, aggregate_type, aggregate_id, event_key)`.

## Transactional outbox schema

`migrations/009_transactional_outbox.sql` materializes:

1. `event_outbox` — durable event envelope and delivery state;
2. `event_outbox_delivery_attempts` — immutable execution/attempt history;
3. `event_consumer_receipts` — per-consumer idempotency state.

Outbox states are:

`PENDING → CLAIMED → DELIVERED`

or, on controlled failure:

`CLAIMED → FAILED_RETRYABLE → CLAIMED ... → DEAD_LETTER`.

## Atomic workflow-to-outbox bridge

`PostgresWorkflowStore` accepts a `TransactionalOutboxWriter` and defaults to `PostgresTransactionalOutbox`.

When the workflow store appends a durable `workflow_events` row, it creates the corresponding domain event and calls:

`this.#outbox.enqueue(client, domainEvent)`

using the **same PostgreSQL `PoolClient` and transaction** as the workflow mutation/history write.

Therefore:

- if the workflow transaction commits, the outbox row commits with it;
- if the workflow transaction rolls back, the outbox row rolls back with it;
- no provider/network delivery is attempted inside the business transaction.

This is the core transactional-outbox invariant.

## Concurrency-safe delivery

`PostgresTransactionalOutbox.claimAvailable()`:

- selects only available `PENDING` / `FAILED_RETRYABLE` events;
- enforces `attempts < max_attempts`;
- orders deterministically;
- uses `FOR UPDATE SKIP LOCKED` for competing workers;
- creates an immutable delivery `executionId`;
- increments the logical attempt;
- persists a `CLAIMED` delivery-attempt record in the same transaction.

Completion/failure requires the matching claim execution ID, preventing stale workers from finalizing a claim they no longer own.

## Retry, stale recovery and dead-lettering

Failed delivery is evidence-backed and bounded by `maxAttempts`.

Non-terminal failures become `FAILED_RETRYABLE` with `availableAt` controlling the next attempt. The dispatcher applies bounded exponential backoff.

When the maximum attempt count is reached, both the event and its attempt transition to `DEAD_LETTER` instead of being silently dropped.

Stale `CLAIMED` rows are recovered with `FOR UPDATE SKIP LOCKED`. Recovery locks and verifies the corresponding delivery-attempt row, updates it, and explicitly checks `rowCount`; an inconsistent/missing attempt fails closed rather than fabricating recovery evidence.

## Dispatcher

`OutboxDispatcher` is provider-agnostic and receives an injected `EventPublisher`.

For each claimed event it:

1. invokes the publisher outside the business transaction;
2. requires non-empty delivery evidence;
3. marks the event delivered only after successful publication;
4. records retryable/dead-letter failure on exceptions;
5. performs stale-claim recovery as part of the dispatcher cycle.

Tests use fake publishers only and execute no external provider business write.

## Idempotent consumers

`TransactionalEventConsumer` opens a PostgreSQL transaction and uses `event_consumer_receipts` keyed by `(consumer_id, event_id)`.

The processing sequence is:

`begin receipt → handler(client, event) → complete receipt → commit`.

If the handler fails, the transaction rolls back. Replays after `PROCESSED` return idempotently without re-running the handler. A concurrent in-progress receipt is surfaced instead of creating a duplicate side effect.

## Safety and boundaries

M-FOUND-07 does **not**:

- create R33;
- create a second MCP server;
- change the 731 compatibility capability IDs;
- promote any external-write capability;
- dispatch provider business writes during tests;
- implement M-FOUND-08 audit-ledger expansion;
- implement M-FOUND-09 EventRecord;
- implement CRM core records;
- claim that migration 009 has already been applied to production.

## Acceptance criteria

M-FOUND-07 is complete when:

1. domain events have deterministic IDs and a durable `eventKey`;
2. `event_outbox`, delivery attempts and consumer receipts are persisted;
3. enqueue can participate in a caller-owned PostgreSQL transaction;
4. durable workflow history and its outbox event are written through the same `PoolClient` transaction;
5. competing delivery workers use `FOR UPDATE SKIP LOCKED`;
6. delivery attempts have immutable execution IDs and bounded attempt counts;
7. stale claims are recoverable only after verifying/updating the claimed attempt record;
8. failures retry with a future availability time and terminate in `DEAD_LETTER` at the boundary;
9. successful delivery requires evidence before `DELIVERED`;
10. consumers are idempotent per `(consumer_id, event_id)` inside caller-owned transactions;
11. no provider business write occurs in tests;
12. no M-FOUND-08/M-FOUND-09 scope is prematurely implemented;
13. full repository Quality Gate passes;
14. merge uses a fixed green head SHA;
15. post-merge `main` Quality Gate passes.

## Current evidence

The implementation plus workflow bridge passed full repository `pnpm quality` in GitHub Actions run `31863810927`, including format, architecture, lint, typecheck, all tests and build. The temporary bridge workflow/script removed themselves before the validated commit was pushed.

The final cleanup/documentation head then passed the normal pull-request Quality Gate `#1033` (run `31863943331`) with Format, Architecture, Lint, Typecheck, all tests and Build green.

The next required proof is a final Quality Gate on this status-only documentation commit, followed by a fixed-head merge and post-merge `main` Quality Gate.

## Exit

After a fixed-head green merge and post-merge `main` validation, proceed to `M-FOUND-08 — Audit Ledger / Observability`.
