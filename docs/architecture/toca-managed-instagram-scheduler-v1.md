# TOCA-managed Instagram Scheduler v1

## Purpose

Provide durable automatic publication timing inside `toca-mcp-server` while preserving a strict semantic distinction from Instagram provider-native scheduling and enforcing TOCA Creative Truth at the final publication boundary.

## States

- `TOCA_SCHEDULED`: a publication time is persisted in TOCA PostgreSQL and owned by the TOCA scheduler.
- `SCHEDULED`: reserved exclusively for scheduling confirmed by an external provider.
- `PUBLISHED`: provider-backed publication confirmation exists.

`TOCA_SCHEDULED` must never populate a provider schedule identifier or claim that Instagram has a native queued post.

## Source of truth

TOCA OS decides what should be published and at what editorial time. After an approved descriptor is accepted, `scheduled_jobs` in PostgreSQL becomes the execution-time source of truth. TOCA OS mirrors returned scheduler evidence and reconciles it through status reads and provider evidence.

Creative asset truth remains governed by `TOCA_CREATIVE_TRUTH_POLICY_V1` and the canonical Drive Creative Truth registry. A schedule cannot weaken or replace the Brand Integrity, Venue Fidelity or Quality gates.

## M1 — persistent scheduling control plane

M1 exposes prepare/create/reschedule/cancel/status/list operations through the protected MCP surface.

Creation stores an immutable approved descriptor in PostgreSQL and does not call Meta. Approval is bound to a SHA-256 descriptor containing content item, execution time, timezone, account, media type, stable staged asset identity/SHA-256, copy, correlation ID, publication idempotency key and the final `CreativeTruthPublicationBinding`. Changing any field requires a new descriptor hash and approval.

The Creative Truth binding must contain:

- `policyId=TOCA_CREATIVE_TRUTH_POLICY_V1`;
- the canonical creative standard ID;
- the final creative ID;
- the final output SHA-256;
- Brand Integrity `PASSED`;
- Venue Fidelity `PASSED`;
- Quality `PASSED`;
- at least one stable provider/Drive asset locator;
- `exactAssetBinding=true`.

The scheduler rejects the descriptor when `creativeTruthBinding.outputSha256` differs from the staged asset SHA-256. This prevents an approved creative manifest from being paired with another staged object.

Schedule create/reschedule/cancel are application mutations. They must pass through the generic MCP execution policy/audit layer in addition to the descriptor-specific approval checks.

## M2 — temporal executor

The active production topology is a singleton private Cloud Run service named `toca-managed-instagram-daemon`.

1. The daemon is deployed with one minimum instance, one maximum instance and concurrency 1.
2. It polls at a short fixed cadence.
3. Each tick calls `claimDue()` against PostgreSQL for `internal.instagram.publication.toca-managed.execute` only.
4. `claimDue()` remains transactionally protected with `FOR UPDATE SKIP LOCKED` semantics.
5. Zero due jobs is a successful no-op.
6. Due jobs pass through per-job approval/audit, exact staged-byte verification, Creative Truth enforcement, provider reconciliation and the idempotent Instagram publication executor.
7. The daemon persists success/failure state and exposes private health/metrics endpoints.

Individual publication times remain exclusively in PostgreSQL. The daemon may wake late, but it must never execute a future `run_at` early.

### Superseded heartbeat topology

The earlier Cloud Scheduler + one-shot Cloud Run Job heartbeat design is superseded by the singleton daemon. Active infrastructure policy must not recreate that topology.

Legacy heartbeat artifacts may be retained only as historical evidence until their provider resources are safely decommissioned. They are not an active scheduling path.

## Scheduling transport

The normal scheduling path is:

```text
ChatGPT / authorized MCP client
  -> instagram.toca_schedule.prepare
  -> Creative Truth final-asset binding
  -> explicit descriptor approval
  -> instagram.toca_schedule.create
  -> PostgreSQL scheduled_jobs
  -> daemon claimDue()
```

A Git commit, control JSON file, GitHub Actions run or application redeploy must not be required to create a routine schedule. A deployment pipeline may deploy scheduler code, but it is not the scheduling API.

## Execution composition

At execution time the worker materializes a fresh short-lived delivery URL from the stable private GCS object reference. Before any Meta write, `GcsPublicationAssetDelivery.createVerifiedDeliveryUrl()` performs a full object read and verifies that the object bytes still hash to the approved final creative SHA-256. A mismatch fails closed.

Temporary signed URLs are intentionally not part of the long-lived approval descriptor because they expire. After byte equality is proven, the runtime replaces any stale `MEDIA_URL` locator with the freshly signed URL while preserving the approved final SHA-256 and stable non-URL locators. The production `InstagramPublicationExecutor` is instantiated with Creative Truth enforcement enabled and verifies that the exact runtime URL being sent to Meta is present in the runtime binding.

The runtime records provider state and only promotes to `PUBLISHED` after provider-backed confirmation. Before a write, it reconciles recent provider media when local state could be stale. A unique provider-backed match promotes local state without repeating `media_publish`. Ambiguous/unavailable evidence and overdue stale drafts fail closed for reconciliation.

## Activation gates

Production automatic execution is permitted only while all of the following remain true:

- scheduler and executor code are in `main` behind a green Quality Gate;
- Creative Truth architecture checks are green;
- database migrations required by scheduler, audit and publication execution stores are applied;
- runtime identity can read the provider token secret and sign/read private GCS delivery objects without static keys;
- the daemon runs privately as a singleton with the approved runtime identity;
- a controlled provider-backed smoke has validated the publication path using a Creative Truth-bound final asset;
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
- A schedule without a valid Creative Truth binding is invalid.
- Staged object bytes are rehashed before publication.
- The exact signed URL sent to Meta must be bound after byte verification.
- Idempotency exists at both scheduler-job and provider-publication levels.
- `PREAPPROVED_CLASS` may only be used after TOCA OS governance formally enables it.
- The daemon contains no hard-coded per-content schedule.
- Infrastructure deployment and runtime publication execution remain separate trust boundaries.
