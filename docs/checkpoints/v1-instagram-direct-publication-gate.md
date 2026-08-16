# V1 Instagram direct-publication gate

This checkpoint records the final V1 integration gate for the existing Instagram direct-publication capabilities.

Scope:
- `instagram.publish.image`
- `instagram.publish.carousel`
- `instagram.publish.reel`
- `instagram.publish.story`
- `instagram.toca_schedule.reschedule`

Safety invariants remain unchanged: explicit production opt-in, canonical Instagram account allowlist, `WRITE_EXTERNAL` authorization, formal ApprovalRecord, deterministic idempotency, durable persistence, provider readback, audit evidence, and fail-closed behavior. No real publication is executed by this documentation commit.

The PR must not merge without a successful canonical `Quality Gate` on the exact head SHA. Historical/deleted `BuildFailed` workflow registrations are not accepted as Quality evidence.
