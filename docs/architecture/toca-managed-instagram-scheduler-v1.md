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

### M2a — executor composition

M2a provides the fail-closed runtime composition: private GCS asset delivery through short-lived signed URLs, per-job approval auditing, persistent publication execution state and reuse of the existing idempotent Instagram publication executor. `TOCA_MANAGED_INSTAGRAM_EXECUTOR_ENABLED` defaults to `false` and must never be implicitly enabled by deployment.

### M2b — heartbeat deployment contract

M2b uses one infrastructure heartbeat for the entire publication domain. The target topology is:

1. Cloud Scheduler triggers a dedicated Cloud Run Job at a fixed short cadence.
2. The Cloud Run Job starts a one-shot TOCA-managed publication worker.
3. The worker reads the current time and calls `claimDue()` for `internal.instagram.publication.toca-managed.execute` only.
4. Zero due jobs is a successful no-op.
5. Claimed jobs execute through the M2a runtime and then the process exits.

The heartbeat must not carry content IDs, captions, asset URLs, publication times or approval data. Individual publication timing remains exclusively in Postgres. The heartbeat may wake late, but it must never cause a job with `run_at` in the future to execute early.

The production Cloud Scheduler resource and Cloud Run Job must be infrastructure-controlled resources, not application-created resources. Provisioning must be allowlisted through the infrastructure control plane, require the `infrastructure-admin` environment, use Workload Identity/OIDC rather than service-account keys, and remain impossible from pull-request CI.

The Cloud Run Job must run with the existing runtime service account, use the same private database and Secret Manager boundaries as the publication executor, and receive `TOCA_MANAGED_INSTAGRAM_EXECUTOR_ENABLED=false` until provider-backed smoke validation explicitly authorizes activation.

### M2b activation gates

Production heartbeat activation is permitted only when all of the following are true:

- M1 and M2a are present in `main` with a green Quality Gate.
- The worker entrypoint is buildable and exits successfully when the executor flag is disabled.
- The infrastructure policy explicitly allowlists only the dedicated worker job and heartbeat scheduler resources.
- No GitHub Actions cron and no ChatGPT per-content schedule is used as a publication clock.
- Database migrations required by scheduler, audit and publication execution stores are applied.
- Runtime identity can read the publication token secret and sign private GCS delivery URLs without static keys.
- A controlled provider-backed smoke test confirms one approved job from `TOCA_SCHEDULED` through provider confirmation.
- Kill-switch rollback is verified by setting `TOCA_MANAGED_INSTAGRAM_EXECUTOR_ENABLED=false` without deleting scheduled content.

### Reconciliation after heartbeat execution

Worker success is not equivalent to editorial reconciliation. TOCA OS must reconcile scheduler status, publication execution state and provider-backed media evidence before changing the canonical content item to `PUBLISHED`. Failed or uncertain jobs must remain observable and must not be converted to success from scheduler timing alone.

## Safety

- No per-content ChatGPT Scheduled Task is allowed as the publication clock.
- No per-content GitHub Actions timer is allowed as the publication clock.
- Schedule creation does not call Meta.
- M2 remains disabled until provider-backed smoke validation.
- Idempotency exists at both scheduler-job and provider-publication levels.
- `PREAPPROVED_CLASS` may only be used after TOCA OS governance formally enables it.
- The heartbeat contains no content-specific payload and cannot override `run_at`.
- Infrastructure provisioning and runtime publication execution remain separate trust boundaries.
