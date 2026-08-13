# TOCA-managed Instagram Scheduler v1

## Purpose

Provide durable automatic publication timing inside `toca-mcp-server` while preserving a strict semantic distinction from Instagram provider-native scheduling.

## States

- `TOCA_SCHEDULED`: a publication time is persisted in TOCA Postgres and owned by the TOCA MCP scheduler.
- `SCHEDULED`: reserved exclusively for scheduling confirmed by the external provider itself.
- `PUBLISHED`: provider-backed publication confirmation exists.

`TOCA_SCHEDULED` must never populate `provider_schedule_id` or claim that Instagram has a native queued post.

## Source of truth

TOCA OS decides what should be published and at what editorial time. After an approved descriptor is accepted, `scheduled_jobs` in TOCA Postgres becomes the execution-time source of truth for that scheduled operation. TOCA OS mirrors the returned scheduler evidence and reconciles it through status reads.

## M1 — persistent scheduling control plane

M1 exposes prepare/create/reschedule/cancel/status/list operations. Creation stores an immutable approved descriptor in the existing Postgres scheduler. No Meta request is made by schedule creation itself.

Approval is bound to a SHA-256 descriptor containing content item, execution time, timezone, account, media type, stable asset identity/SHA, copy, correlation ID and publication idempotency key. Changing any of these fields requires a new descriptor hash and approval under the active policy.

## M2 — temporal executor

A single infrastructure heartbeat wakes the TOCA publication worker at a short fixed cadence. The heartbeat is not the source of individual publication times. The worker calls `claimDue()` against Postgres, using the existing transactional `FOR UPDATE SKIP LOCKED` implementation to claim only due jobs.

At execution time the worker materializes a fresh delivery URL from the stable private asset reference, then invokes the existing idempotent Instagram publication executor. Temporary signed URLs are never part of the long-lived approval descriptor.

The worker records provider state and only promotes to `PUBLISHED` after provider-backed confirmation. Uncertain publish outcomes remain fail-closed and require reconciliation instead of blind retries.

## Safety

- No per-content ChatGPT Scheduled Task is allowed as the publication clock.
- No per-content GitHub Actions timer is allowed as the publication clock.
- Schedule creation does not call Meta.
- M2 remains disabled until provider-backed smoke validation.
- Idempotency exists at both scheduler-job and provider-publication levels.
- `PREAPPROVED_CLASS` may only be used after TOCA OS governance formally enables it.
