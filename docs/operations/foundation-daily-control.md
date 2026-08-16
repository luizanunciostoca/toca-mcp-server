# Foundation Daily Control — Real TOCA OS Operating Process

Status: **PRODUCTION_VERIFIED**

Production runtime source: `3977d2f20ec0fb55c2f3b6b99f9ab006b7c10732`.

Canonical closeout: `docs/operations/foundation-production-verification-2026-08-16.md`.

This process makes daily TOCA OS execution explicit without adding another scheduler, workflow engine or provider-write path.

## Runtime

The existing private `toca-managed-instagram-daemon` is invoked by the authenticated Cloud Scheduler minute trigger. After 08:00 in `America/Bahia`, the daemon attempts the Foundation daily control during its normal tick.

Completion is persisted in `operational_signals` under:

- name: `foundation.daily_control.completed`;
- correlation: `foundation:daily-control:<YYYY-MM-DD>`;
- durable attribute: `dayKey=<YYYY-MM-DD>`.

Warm/cold runtime restarts therefore do not turn the daily process into a second logical completion. Concurrent attempts are serialized at completion through a PostgreSQL advisory transaction lock.

## What it does

The daily control is read-only with respect to providers. It checks:

1. Transactional Outbox pending/claimed/retryable count and age;
2. scheduler jobs stuck in `RUNNING` beyond ten minutes;
3. up to the 100 most recently updated Audit Ledger executions from the previous 24 hours using the canonical cryptographic ledger verifier;
4. structured telemetry and durable operational evidence for the result.

Finding policy:

- `AUDIT_LEDGER_INTEGRITY_FAILED` → P0;
- `OUTBOX_STALLED` (>300 seconds) → P1;
- `STALE_SCHEDULER_JOBS` → P1.

The daily control never publishes, sends a message, activates an ad, mutates a provider resource or infers that a write succeeded.

## Failure semantics

A daily-control query failure does not rewrite an already completed provider mutation into a failure/timeout result. The sweep emits its own error telemetry/evidence so operators can decide whether subsequent provider writes should be disabled.

An unhealthy completed sweep is persisted with `value=0`; a healthy one is persisted with `value=1`. Findings remain visible in structured logs and operational telemetry.

## External infrastructure checks

The runtime sweep intentionally does not grant itself infrastructure-admin permissions. GCP operations/monitoring retains ownership of:

- Cloud SQL latest backup age;
- PITR enabled state;
- Cloud Run/Cloud Scheduler infrastructure health;
- alert-notification delivery;
- isolated restore drills.

This preserves least privilege.

## Production verification

The former deployment/activation gate is closed.

Final SLO Production Assessment run `31937982829` read the real production database and proved:

- durable daily-control correlation `foundation:daily-control:2026-08-15`;
- durable value `1`;
- completion at `2026-08-15T23:56:01.439Z`;
- age at assessment approximately `9.12h`;
- scheduler ticks `880`;
- scheduler failures `0`;
- Transactional Outbox pending/claimed/retryable `0`;
- oldest pending Outbox age `0s`;
- Audit Ledger integrity valid;
- canonical SLO assessment `healthy=true`.

The canonical production deployment run `31937475975` and R29 post-cleanup run `31937724476` both passed on runtime source `3977d2f20ec0fb55c2f3b6b99f9ab006b7c10732`, including full Quality after cleanup.

Final assessment artifact:

- ID `9261211173`;
- SHA-256 `984ee6bf3f6dac4559cbcdb7636695dd285b57fbe00d7d27bfd0a6653fd266e3`.

Daily Operations is therefore **PRODUCTION_VERIFIED**.
