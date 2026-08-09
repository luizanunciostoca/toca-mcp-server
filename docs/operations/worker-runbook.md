# TOCA MCP Worker Runbook

## Purpose

This runbook defines the operational behavior for scheduled jobs before any external Meta write capability is promoted to CONNECTED.

## Execution model

Workers are one-shot batch processors. A worker claims due jobs using the Scheduler interface, executes only registered handlers, records success/failure, schedules bounded exponential retries, and writes exhausted failures to the dead-letter store.

## Retry policy

Default policy:
- maximum attempts: 5
- base delay: 30 seconds
- exponential backoff
- maximum delay: 30 minutes

Retries use a derived idempotency key in the form `<original>:retry:<attempt>` so the original idempotency contract is preserved while each attempt remains traceable.

## Dead-letter behavior

When a job reaches the maximum attempt count, it is not silently discarded. A row is written to `dead_letter_jobs` with original job id, tool name, normalized payload, attempt count, final error and failure timestamp.

Dead-letter replay must be an explicit operator action after the root cause is understood. Never automatically replay financial or external-write jobs without policy re-evaluation.

## Health probes

`GET /healthz` is liveness only: it confirms the process is responsive.

`GET /readyz` is readiness: configured dependency checks must pass. Failure details are intentionally not returned to the caller to avoid leaking credentials or provider internals.

## Observability

Worker lifecycle events are emitted as structured JSON with severity, event name and correlation fields. Metrics include claimed jobs, successes, failures, retry scheduling, dead-letter events and execution duration.

Raw secrets, access tokens, database credentials and authorization headers must never be logged.

## Incident flow

1. Confirm `/healthz`.
2. Confirm `/readyz` and dependency status.
3. Inspect structured logs by job id / correlation id.
4. Check `scheduled_jobs` for FAILED or repeatedly retried jobs.
5. Check `dead_letter_jobs` for exhausted retries.
6. Resolve provider, permission, payload or infrastructure cause.
7. Re-run validation and policy checks.
8. Replay only through an explicit operator-controlled path.

## Promotion gate

The existence of worker, retry and dead-letter infrastructure does not promote Instagram or Meta Ads capabilities. Real-provider validation, ChatGPT-to-MCP validation, account authorization and policy approval remain mandatory.
