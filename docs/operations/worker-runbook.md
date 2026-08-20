# TOCA MCP Worker Runbook

## Purpose

This runbook defines the operational behavior for scheduled jobs before any external provider write is promoted or executed outside its normal governance boundary.

## Execution model

Workers are one-shot batch processors. A worker claims due jobs using the Scheduler interface, executes only registered handlers, records success/failure, schedules bounded exponential retries, and writes exhausted failures to the dead-letter store.

Production scheduling state is durable in PostgreSQL. A claim moves a due job from `SCHEDULED` to `RUNNING` and increments its persisted attempt count. A process restart must not create a second logical schedule merely because the previous process died after claiming work.

## Retry policy

Default policy:

- maximum attempts: 5;
- base delay: 30 seconds;
- exponential backoff;
- maximum delay: 30 minutes.

On the PostgreSQL production path, a retry transitions the **same durable job row** atomically from `RUNNING` back to `SCHEDULED`, updates `run_at` to the bounded backoff time, records the normalized error, and preserves the original job ID and idempotency key. Retry attempts therefore remain traceable through the persisted `attempts`, `last_error`, `run_at` and worker telemetry fields without creating a second logical schedule.

The worker still understands historical `:retry:<attempt>` idempotency suffixes for compatibility with older persisted rows/adapters, but new PostgreSQL retries must not create child retry jobs.

## Restart recovery

A claimed job that remains `RUNNING` without progress beyond the Foundation stale-running safety window is eligible for recovery by a later authenticated daemon tick. Recovery returns the same logical row to scheduler control and then reclaims it using the normal transactional claim path.

Recovery is not permission to blindly repeat an uncertain external provider mutation. Provider-backed handlers must still reconcile provider state before repeating a side effect when local state may be stale or ambiguous.

If a stale `RUNNING` source already has a durable dead-letter row from a legacy partial terminal transition, recovery fails closed by terminalizing the source as `FAILED`; it must not re-execute that job.

## Dead-letter behavior

When a job reaches the maximum attempt count, it is not silently discarded. On the PostgreSQL production path, the `dead_letter_jobs` row and the source job's terminal `FAILED` transition are committed in one database transaction. The record contains original job ID, tool name, normalized payload, attempt count, final error and failure timestamp.

Dead-letter replay must be an explicit operator action after the root cause is understood. Never automatically replay financial or external-write jobs without policy re-evaluation and provider reconciliation.

## Health probes and heartbeat

`GET /healthz` is liveness only: it confirms the process is responsive.

`GET /readyz` is readiness: configured dependency checks must pass. Failure details are intentionally not returned to the caller to avoid leaking credentials or provider internals.

The active production heartbeat is the single authenticated global Cloud Scheduler minute tick to the private daemon `POST /tick`. The tick contains no content payload. It wakes the request-driven daemon, which executes the due worker batch and then the once-per-day Foundation control. Routine execution does not depend on GitHub Actions, commits or redeploys.

The older Cloud Run Job heartbeat design and per-content Cloud Scheduler jobs remain superseded/forbidden.

## Observability

Worker lifecycle events are emitted as structured JSON with severity, event name and correlation fields. Metrics include claimed jobs, successes, failures, retry scheduling, stale-claim recovery, dead-letter events and execution duration.

Raw secrets, access tokens, database credentials and authorization headers must never be logged.

## Incident flow

1. Confirm `/healthz` and runtime reachability.
2. Confirm readiness/dependency status.
3. Inspect structured logs by job ID / correlation ID.
4. Check `scheduled_jobs` for stale `RUNNING`, repeatedly retried, terminal `FAILED` or unexpectedly old `SCHEDULED` jobs.
5. Check `dead_letter_jobs` for exhausted retries and verify terminal source state.
6. Reconcile provider state before deciding whether any external mutation can be repeated.
7. Resolve provider, permission, payload or infrastructure cause.
8. Re-run validation, authorization, policy and approval checks.
9. Replay only through an explicit operator-controlled Core path.

## Promotion gate

The existence of worker, retry and dead-letter infrastructure does not promote provider capabilities. Real-provider validation, ChatGPT-to-MCP validation, account authorization, policy approval, deterministic idempotency and provider/store readback remain mandatory.
