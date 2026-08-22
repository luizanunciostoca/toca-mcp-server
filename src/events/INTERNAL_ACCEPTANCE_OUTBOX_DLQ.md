# INTERNAL ACCEPTANCE — OUTBOX / DLQ / IDEMPOTENCY

Test-only trigger for the frozen candidate `75c165a044c6e79e9545328dd04a2a3e73d2e910`.

- No executable runtime change.
- No production authorization.
- No external provider side effects.
- Purpose: trigger the canonical disposable PostgreSQL E2E workflow for Outbox / worker restart safety evidence.
