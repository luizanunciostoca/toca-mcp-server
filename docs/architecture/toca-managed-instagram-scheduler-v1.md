# TOCA-managed Instagram Scheduler v1

## Purpose

Provide durable automatic publication timing inside `toca-mcp-server` while preserving a strict semantic distinction from Instagram provider-native scheduling.

## States

- `TOCA_SCHEDULED`: a publication time is persisted in TOCA PostgreSQL and owned by the TOCA scheduler.
- `SCHEDULED`: reserved exclusively for scheduling confirmed by an external provider.
- `PUBLISHED`: provider-backed publication confirmation exists.

`TOCA_SCHEDULED` must never populate a provider schedule identifier or claim that Instagram has a native queued post.

## Source of truth

TOCA OS decides what should be published and at what editorial time. After an approved descriptor is accepted, `scheduled_jobs` in PostgreSQL becomes the execution-time source of truth. TOCA OS mirrors returned scheduler evidence and reconciles it through status reads and provider evidence.

## M1 — persistent scheduling control plane

M1 exposes prepare/create/reschedule/cancel/status/list operations through the protected MCP surface.

Creation stores an immutable approved descriptor in PostgreSQL and does not call Meta. Approval is bound to a SHA-256 descriptor containing content item, execution time, timezone, account, media type, stable asset identity/SHA, copy, correlation ID and publication idempotency key. Changing any field requires a new descriptor hash and approval.

Schedule create/reschedule/cancel are application mutations. They must pass through the generic MCP execution policy/audit layer in addition to the descriptor-specific approval checks.

## M2 — temporal executor

The active production topology is a private, request-driven Cloud Run service named `toca-managed-instagram-daemon` with scale-to-zero enabled.

1. One global Cloud Scheduler job, `toca-managed-instagram-tick`, sends an authenticated `POST /tick` every minute in `America/Bahia`.
2. The daemon is private, configured with `minInstances=0`, `maxInstances=1`, concurrency `1` and CPU throttling.
3. A tick calls `claimDue()` against PostgreSQL for `internal.instagram.publication.toca-managed.execute` only.
4. `claimDue()` remains transactionally protected with `FOR UPDATE SKIP LOCKED` semantics.
5. Zero due jobs is a successful no-op.
6. Due jobs pass through per-job approval/audit, provider reconciliation and the idempotent Instagram publication executor.
7. The same tick also runs the once-per-day Foundation control after the worker batch; that daily control is durably deduplicated in PostgreSQL.
8. The daemon persists success/failure state and exposes private health/metrics endpoints.

Individual publication times remain exclusively in PostgreSQL. The global Cloud Scheduler trigger carries no content payload and is only a wake-up signal. The daemon may wake late, but it must never execute a future `run_at` early.

### Restart and retry safety

A claimed scheduler job is persisted as `RUNNING`. If the runtime terminates before that claim reaches a durable terminal/retry transition, a later tick recovers a claim whose `updated_at` has remained stale for the Foundation ten-minute safety window and reclaims the same logical job. Recovery does not create a second idempotency key or a second content schedule.

Retryable worker failures transition the same job atomically from `RUNNING` back to `SCHEDULED` with its next `run_at`, error evidence and existing idempotency key. This removes the former failure window in which a process could persist `FAILED` but terminate before creating a separate retry row.

When the retry budget is exhausted, the PostgreSQL dead-letter sink commits the dead-letter record and the source job's terminal `FAILED` state in one transaction. A legacy partial terminal state that already contains a dead-letter row but still has a stale `RUNNING` source is reconciled fail-closed to `FAILED`, never re-executed.

The publication handler remains responsible for provider reconciliation before repeating a provider mutation when local state may be stale. Scheduler recovery is therefore a durable execution recovery mechanism, not permission to blindly replay an uncertain provider write.

### Superseded heartbeat topology

The earlier **Cloud Run Job + Cloud Scheduler Job** heartbeat design is superseded and must not be recreated. The active `toca-managed-instagram-tick` is different: it is one global authenticated wake-up signal for the private request-driven service and contains no content-specific schedule or payload.

Per-content Cloud Scheduler jobs and always-on background polling remain forbidden.

## Scheduling transport

The normal scheduling and execution path is:

```text
ChatGPT / authorized MCP client
  -> TOCA Core / toca.execute
  -> instagram.toca_schedule.prepare
  -> explicit descriptor approval
  -> instagram.toca_schedule.create
  -> PostgreSQL scheduled_jobs
  -> global authenticated minute tick
  -> private daemon POST /tick
  -> claimDue()
  -> governed worker execution / reconciliation
```

A Git commit, control JSON file, GitHub Actions run or application redeploy is not required to create a routine schedule or to execute due daily operations. Deployment automation may deploy runtime code and reconcile the single infrastructure wake-up trigger, but it is not the scheduling API or the execution clock.

## Execution composition

At execution time the worker materializes a fresh short-lived delivery URL from the stable private GCS object reference, then invokes the existing idempotent Instagram publication executor. Temporary signed URLs are never part of the long-lived approval descriptor.

The runtime records provider state and only promotes to `PUBLISHED` after provider-backed confirmation. Before a write, it reconciles recent provider media when local state could be stale. A unique provider-backed match promotes local state without repeating `media_publish`. Ambiguous/unavailable evidence and overdue stale drafts fail closed for reconciliation.

## Activation gates

Production automatic execution is permitted only while all of the following remain true:

- scheduler and executor code are in `main` after repository quality validation;
- database migrations required by scheduler, audit and publication execution stores are applied;
- runtime identity can read the provider token secret and sign private GCS delivery URLs without static keys;
- the daemon remains private, max-one-instance and reachable only through the authenticated global tick/runtime boundary;
- a controlled provider-backed smoke has validated the publication path;
- kill-switch rollback is available through `TOCA_MANAGED_INSTAGRAM_EXECUTOR_ENABLED=false` without deleting scheduled content;
- provider reconciliation is executed before retry when local state may be stale.

## Reconciliation

Worker success is not equivalent to editorial reconciliation. TOCA OS must reconcile scheduler status, publication execution state and provider-backed media evidence before changing the canonical content item to `PUBLISHED`.

`PUBLISHING`, `PUBLISH_UNCERTAIN`, ambiguous provider matches and overdue stale drafts must not be converted to success or blindly retried.

## Safety

- No per-content ChatGPT Scheduled Task is the publication clock.
- No per-content GitHub Actions timer is the publication clock.
- No Git commit/redeploy is the routine scheduling transport.
- Schedule creation does not call Meta.
- Idempotency exists at both scheduler-job and provider-publication levels.
- Stale `RUNNING` scheduler claims are recovered by PostgreSQL state, not in-memory timers.
- Retry scheduling and terminal dead-letter finalization are durable transitions.
- `PREAPPROVED_CLASS` may only be used after TOCA OS governance formally enables it.
- The daemon contains no hard-coded per-content schedule.
- Infrastructure deployment and runtime publication execution remain separate trust boundaries.
