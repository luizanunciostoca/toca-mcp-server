# M-FOUND-08 — Audit Ledger / Observability

Status: **IMPLEMENTED IN BRANCH — VALIDATION REQUIRED**

Milestone: `TOCA_OS_MARKETING_SALES_FOUNDATION_v1`

Base main SHA: `8c4b0cbd6ac4d4e111dd2086c5c08d5c04167bb5`

## Objective

Upgrade the existing execution audit log and runtime-only telemetry into a durable, tamper-evident and queryable governance surface without prematurely implementing the generalized EventRecord of M-FOUND-09.

## Audit ledger

The new audit ledger records every governed execution audit transition with:

- immutable event ID;
- execution and correlation IDs;
- monotonic sequence per execution;
- previous hash and current SHA-256 event hash;
- actor/identity/authorization context;
- tool and risk class;
- audit status;
- approval/provider/error references;
- normalized evidence;
- canonical payload;
- event timestamp.

The chain begins at a fixed genesis hash. Writers serialize per `executionId`, append one event, and atomically advance the corresponding ledger head.

## Append-only enforcement

`migrations/010_audit_ledger_observability.sql` creates:

- `audit_ledger_events`;
- `audit_ledger_heads`;
- `operational_signals`.

Database triggers reject UPDATE/DELETE of ledger events and operational signals. Ledger heads may advance but cannot be deleted.

The existing `audit_events` table remains as a compatibility projection; it is no longer the integrity source of truth.

## Integrity verification

The verifier reads a repeatable-read snapshot and checks:

1. contiguous sequence numbers;
2. exact previous-hash linkage;
3. deterministic canonical payload reconstruction;
4. SHA-256 event hashes;
5. final sequence against the persisted head;
6. final hash against the persisted head.

Any mismatch is surfaced as a specific integrity reason rather than silently accepted.

## Durable observability

Every persisted audit transition also produces an `operational_signals` record in the same PostgreSQL transaction.

Signals are correlated by audit event, execution, correlation and tenant. They have explicit type/name/value/attributes/evidence/timestamp and are append-only.

The operational store supports deterministic queries by execution and correlation. Existing in-memory/Prometheus runtime telemetry remains compatible; M-FOUND-08 adds durable execution-governance signals rather than replacing every specialized metric emitter.

## Transactional guarantees

A `PostgresAuditSink.write()` transaction performs, in order:

1. tool/risk resolution;
2. per-execution advisory lock;
3. current ledger-head lock/read;
4. canonical payload + hash computation;
5. append audit-ledger event;
6. advance/insert ledger head;
7. append legacy compatibility audit projection;
8. append operational signal;
9. commit.

Any failure rolls back the entire audit/observability write.

## Architectural boundary

M-FOUND-08 does **not**:

- create R33;
- create a second MCP server;
- change the 731 compatibility capability IDs;
- promote external-write capabilities;
- implement generic EventRecord (M-FOUND-09);
- implement CRM core records;
- perform provider business writes in tests;
- claim migration 010 has already been applied to production.

## Acceptance criteria

M-FOUND-08 is complete when:

1. audit events are durably sequence-ordered per execution;
2. each event is chained to the previous SHA-256 hash;
3. a durable head records the last sequence/hash;
4. concurrent writers are serialized per execution;
5. audit event mutation/deletion is rejected at the database layer;
6. ledger verification detects sequence/hash/head corruption;
7. existing `audit_events` compatibility is preserved;
8. each audit transition creates durable correlated observability in the same transaction;
9. operational signals are append-only and queryable by execution/correlation;
10. existing runtime telemetry remains compatible;
11. no M-FOUND-09 EventRecord scope is introduced;
12. full repository Quality Gate passes;
13. merge uses a fixed green head SHA;
14. post-merge `main` Quality Gate passes.

## Exit

After validation, proceed to `M-FOUND-09 — EventRecord`.
