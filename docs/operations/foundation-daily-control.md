# Foundation Daily Control — Real TOCA OS Operating Process

Status: **DAILY OPERATIONS — PRODUCTION_VERIFIED**

Final deployed runtime SHA: `ac0ba469a57f12c801148b5821e14e34fd86d281`.

Canonical ratification: `docs/operations/foundation-slo-production-verification-2026-08-16.md`.

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

The production activation gate is closed and was ratified only after the final canonical R29 workflow completed.

Final runtime/deployment chain:

- final production deploy `31938116522` on `ac0ba469a57f12c801148b5821e14e34fd86d281` — **SUCCESS**;
- canonical final R29 run `31938375409` — **SUCCESS**;
- R29 post-cleanup full Quality — **PASS**;
- post-R29 Production Assessment `31938670357` — **SUCCESS**.

At the final post-R29 assessment:

- durable daily-control correlation: `foundation:daily-control:2026-08-15`;
- durable value: `1`;
- completion: `2026-08-15T23:56:01.439Z`;
- age: approximately `9.39h`, within the 36-hour health window;
- managed scheduler success: `879/879`;
- Transactional Outbox pending/claimed/retryable: `0`;
- oldest pending Outbox age: `0s`;
- Audit Ledger integrity: valid;
- canonical SLO alerts: none;
- canonical SLO assessment: `healthy=true`.

Final ratification artifact:

- ID `9261408650`;
- SHA-256 `b1c4ceb6da7bb0eb3a49e260296ff3bc870635ffa357eea0daae3ac43e7da819`.

Therefore Daily Operations is **PRODUCTION_VERIFIED** for the current Foundation scope.
