# ALERTS — Production Verification — 2026-08-16

Status: **ALERTS — PRODUCTION_VERIFIED**

This document is the canonical closeout evidence for the 2026-08-16 ALERTS delivery gate. It supersedes only the earlier mailbox-readback caveats in `docs/operations/controlled-test-readiness-2026-08-16.md`, `docs/operations/foundation-reliability-provider-evidence.md`, and `docs/operations/reliability-slo-alerting-dr.md`. Those earlier documents remain preserved as historical evidence of the state before the final controlled delivery proof.

## Gate definition

ALERTS could be promoted only after all of the following were proven against real providers:

1. a controlled synthetic signal caused a Cloud Monitoring policy to enter firing;
2. the exact incident was readable from Cloud Monitoring with state/open timestamp evidence;
3. the existing email notification channel delivered a real message;
4. the message was read back from the actual `luizidebook@gmail.com` mailbox;
5. emission/firing and receipt timestamps were recorded;
6. only temporary test resources were removed;
7. the four permanent alert policies and the existing Gmail notification channel were unchanged after cleanup.

## Permanent configuration preserved

Existing notification channel reused:

- `projects/toca-mcp-production/notificationChannels/9216772763667438415` — `luizidebook@gmail.com`.

Permanent Foundation alert policies preserved:

- `projects/toca-mcp-production/alertPolicies/1233118609333698263` — `TOCA P0 Audit Ledger Integrity`;
- `projects/toca-mcp-production/alertPolicies/14464734765997818401` — `TOCA P1 Foundation Daily Control Failed`;
- `projects/toca-mcp-production/alertPolicies/3398047250843043934` — `TOCA P1 Stale Scheduler Jobs`;
- `projects/toca-mcp-production/alertPolicies/3398047250843045119` — `TOCA P1 Outbox Stalled`.

No permanent policy or notification channel was modified for the proof.

## Final controlled proof

GitHub Actions run:

- run ID: `31938048761`;
- workflow: `Alerts Email Final Proof v5 Metric 2026-08-16`;
- head SHA: `58b925208327da7b011f6ad1f19fef39183633f0`;
- conclusion: `success`.

Correlation:

`alerts-v5-31938048761-1`

Temporary resources used only for the proof:

- alert policy: `projects/toca-mcp-production/alertPolicies/15137347235286796147`;
- Cloud Run Job: `toca-alert-metric-v5-31938048761`.

The alert condition used the native Google Cloud metric:

`run.googleapis.com/job/completed_execution_count`

restricted to the exact temporary Cloud Run Job and `metric.labels.result="succeeded"`, with threshold `> 0` and 60-second DELTA alignment.

## Synthetic stimulus and metric readback

Initial controlled Cloud Run Job execution:

- start: `2026-08-16T09:06:06.633019Z`;
- end: `2026-08-16T09:06:21.535578Z`.

Native Monitoring metric readback:

- value: `1`;
- timestamp: `2026-08-16T09:07:00Z`;
- metric: `run.googleapis.com/job/completed_execution_count`;
- result: `succeeded`.

The same temporary job was then executed in additional controlled buckets to keep the DELTA signal present long enough for the Monitoring evaluator. No additional permanent or production application resource was created for this sustain phase.

## Cloud Monitoring firing proof

The provider API returned the exact incident:

`projects/toca-mcp-production/alerts/0.obi0tel279f7`

Provider state at firing:

- `state=OPEN`;
- `openTime=2026-08-16T09:12:19Z`;
- policy: `TOCA Alerts Email Final Proof v5 alerts-v5-31938048761-1`;
- resource type: `cloud_run_job`;
- job: `toca-alert-metric-v5-31938048761`;
- metric result: `succeeded`.

The first incident later closed at `2026-08-16T09:14:00Z`. A second controlled OPEN incident was observed at `2026-08-16T09:17:24Z` while the same temporary metric stimulus was intentionally sustained. Both belonged to the same temporary policy/job and were part of the same controlled proof.

## Real Gmail delivery and mailbox readback

The connected Gmail account was independently confirmed as:

`luizidebook@gmail.com`

Real message read back from the mailbox:

- Gmail message ID: `1a009d7e6979656a`;
- sender: `Google Cloud Alerting <alerting-noreply@google.com>`;
- recipient: `luizidebook@gmail.com`;
- received timestamp: `2026-08-16T09:12:19Z` (`2026-08-16 06:12:19 America/Bahia`);
- subject identifies `TOCA controlled Cloud Run completion metric`, project `toca-mcp-production`, and job `toca-alert-metric-v5-31938048761`.

The message body explicitly read back:

- `Alert firing`;
- value `1` above threshold `0`;
- start time `Aug 16, 2026 at 9:12AM UTC`;
- policy `TOCA Alerts Email Final Proof v5 alerts-v5-31938048761-1`;
- condition `TOCA controlled Cloud Run completion metric`;
- metric `run.googleapis.com/job/completed_execution_count`;
- `result=succeeded`;
- labels `email_final_proof=true`, `synthetic=true`, `toca_managed=true`.

The raw MIME `Received` headers also show mailbox receipt at `2026-08-16T09:12:19Z`.

Therefore the alert firing timestamp and real mailbox receipt timestamp are the same second at provider/mailbox timestamp resolution:

- alert emission/firing: `2026-08-16T09:12:19Z` (`06:12:19 America/Bahia`);
- Gmail receipt: `2026-08-16T09:12:19Z` (`06:12:19 America/Bahia`).

Mailbox delivery is proven by the actual Gmail message readback; absence of notification-channel error logs is not used as delivery evidence.

## Cleanup proof

Explicit finalizer run `31938591708` and the main proof run both performed idempotent cleanup/readback.

Finalizer evidence:

- temporary policy GET before cleanup: `200`;
- temporary policy DELETE: `200`;
- temporary policy GET after cleanup: `404`;
- temporary Cloud Run Job after cleanup: absent;
- all four permanent alert policies before/after: unchanged;
- Gmail notification channel before/after: unchanged;
- finalizer result: `ALERTS_V5_FINAL_CLEANUP=PASS`;
- cleanup completion: `2026-08-16T09:17:50.302995Z`.

The main proof run later repeated cleanup idempotently and recorded:

- `TEMP_POLICY_CLEANUP=PASS`;
- `TEMP_JOB_CLEANUP=PASS`;
- `PERMANENT_ALERT_CONFIG_UNCHANGED=PASS`.

No temporary Cloud Monitoring policy or Cloud Run Job from the final proof remains.

## Evidence artifacts

Primary proof artifact:

- ID: `9261443273`;
- SHA-256: `4b34d7004bc8584f842dfa1086ab25b7629024f7f352d9fda7e0968d01fc33d7`;
- retention: 90 days.

Independent finalizer artifact:

- ID: `9261387698`;
- SHA-256: `4bd1edac2bb875a622f2bd02231d0f7f072f94584500e897748d0681ab483d3e`;
- retention: 90 days.

GitHub issue `#163` records the prior blocker and the final success evidence and is closed with state reason `completed`.

## Final decision

The required chain is proven end to end:

`controlled native signal -> Cloud Monitoring metric -> incident OPEN -> Google Cloud Alerting email -> Gmail mailbox readback -> cleanup -> permanent-state readback`

**ALERTS = PRODUCTION_VERIFIED**.
