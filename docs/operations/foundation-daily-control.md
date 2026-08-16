# Foundation Daily Control — Real TOCA OS Operating Process

Status: **DAILY OPERATIONS — PRODUCTION_VERIFIED**

This process makes daily TOCA OS execution explicit without adding another scheduler, workflow engine or provider-write path.

## Runtime

The existing private `toca-managed-instagram-daemon` is invoked by the authenticated Cloud Scheduler minute trigger. After 08:00 in `America/Bahia`, the daemon attempts the Foundation daily control during its normal tick.

Completion is persisted in `operational_signals` under:

- name: `foundation.daily_control.completed`
- correlation: `foundation:daily-control:<YYYY-MM-DD>`
- durable attribute: `dayKey=<YYYY-MM-DD>`

Therefore warm/cold runtime restarts do not turn the daily process into a second logical completion. Concurrent attempts are serialized at completion through a PostgreSQL advisory transaction lock.

## What it does

The daily control is read-only with respect to providers. It checks:

1. Transactional Outbox pending/claimed/retryable count and age;
2. scheduler jobs stuck in `RUNNING` beyond ten minutes;
3. up to the 100 most recently updated Audit Ledger executions from the previous 24 hours using the canonical cryptographic ledger verifier;
4. structured telemetry and durable operational evidence for the result.

Current finding policy:

- `AUDIT_LEDGER_INTEGRITY_FAILED` → P0;
- `OUTBOX_STALLED` (>300 seconds) → P1;
- `STALE_SCHEDULER_JOBS` → P1.

The daily control never publishes, sends a message, activates an ad, mutates a provider resource or infers that a write succeeded.

## Failure semantics

A daily-control query failure does not rewrite an already completed provider mutation into a failure/timeout result. The sweep emits its own error telemetry/evidence so operators can decide whether subsequent provider writes should be disabled.

An unhealthy completed sweep is persisted with `value=0`; a healthy one is persisted with `value=1`. Findings remain visible in structured logs and operational telemetry.

## External checks that remain outside the application process

The runtime sweep intentionally does not grant itself infrastructure-admin permissions. These checks remain owned by GCP operations/monitoring:

- Cloud SQL latest backup age;
- PITR enabled state;
- Cloud Run/Cloud Scheduler infrastructure health;
- alert-notification delivery;
- isolated restore/PITR drills.

This preserves least privilege. The application must not receive broad GCP administrative permissions merely to claim operational completeness.

## Production verification

The production activation gate is closed.

Final evidence is recorded in `docs/operations/foundation-slo-production-verification-2026-08-16.md`.

At the final assessment:

- authenticated production deploy and scheduler smoke passed;
- `operational_signals` contained a healthy durable daily completion with correlation `foundation:daily-control:2026-08-15` and `value=1`;
- the completion was ~9.13 hours old, within the 36-hour health window;
- managed scheduler success was 880/880;
- Transactional Outbox pending/claimed/retryable count was 0;
- oldest pending Outbox age was 0 seconds;
- SLO assessment returned `healthy=true` with no alerts;
- Audit Ledger integrity was valid.

Therefore Daily Operations is **PRODUCTION_VERIFIED** for the current release.
