# TOCA OS Next — Observability and Incident Runbook

Status: **IMPLEMENTED CONTRACT / NEXT RELEASE REVALIDATION REQUIRED**

Routes: `R25 OBSERVABILITY_AND_INCIDENT_RESPONSE`, `R31 PERFORMANCE_FEEDBACK_OPTIMIZATION`.

The existing V1 source plane remains canonical: structured JSON logs, `operational_signals`, correlation/execution IDs, Audit Ledger, workflow/approval persistence, Transactional Outbox and EventRecord. Cloud Run native request metrics are consumed for transport rate/error/latency; no second application telemetry database is introduced.

Machine-readable contracts:

- `src/core/platform-slo-catalog.ts`;
- `infra/observability/platform-hardening-dashboard.json`;
- `infra/observability/platform-hardening-alerts.json`;
- `infra/observability/platform-hardening-synthetics.json`.

The production alert-delivery baseline is already provider verified by `docs/operations/alerts-production-verification-2026-08-16.md`. That evidence proves controlled firing, Cloud Monitoring incident readback, real notification delivery, mailbox readback and cleanup. Next must preserve that baseline and revalidate the changed policy/signal surface before release promotion; it must not manufacture business-provider side effects merely to test alerting.

## Telemetry source planes

### Cloud Run native

Use Google Cloud managed metrics for:

- `http.request_rate`;
- `http.request_error_ratio`;
- `http.request_p95_seconds`;
- revision and instance health required to correlate incidents with a deployment.

### Canonical application signals

Use the existing `operational_signals` plane for:

- webhook success/failure;
- Outbox lag;
- retry exhaustion;
- dead-letter backlog;
- queue backlog;
- provider errors/readback verification;
- AG-01 failures;
- approval decision latency;
- CRM durable-write success/errors;
- attribution durable-write success and revenue-attribution errors;
- publication/workflow/lead/R31 signals already defined by the platform SLO catalog.

## Correlation and structured logging

Every signal used for incident triage must preserve the existing correlation chain whenever available: `environment`, `revision`, `correlation_id`, `execution_id`, `tenant_id`, `route_id`, provider and terminal status. Logs remain structured JSON. Secret values, credentials, raw access tokens, provider request authorization headers and decrypted Secret Manager values are forbidden log fields.

## SLO and operational objectives

The following are initial Next release thresholds. They are release-control defaults and may be tightened only with evidence; changing a threshold must not be used to hide an incident.

### HTTP runtime

- request rate is observed without a fixed minimum target;
- `http.request_error_ratio <= 1% / 15m`;
- `http.request_p95_seconds <= 2s / 15m`.

Cloud Run candidate revisions must pass authenticated `/healthz` and `/readyz` before traffic promotion. `/healthz` proves process liveness only. `/readyz` is the dependency gate and must return non-2xx when any mandatory dependency is not ready.

### Publication

`publication.verified_terminal_success_ratio >= 99.5% / 60m`. A successful external publication without provider verification is not a success and follows the existing P0 unverified-write invariant.

### Workflow

`workflow.terminal_success_ratio >= 99.5% / 60m`. Inspect durable workflow state before attempting recovery. Never skip approval/policy/idempotency to clear an incident.

### Provider readback and errors

`provider.readback_verified_ratio = 100%` for terminal external write successes. Any gap is P0. `provider.error_count > 0 / 15m` is P1 unless the error proves an unverified/ambiguous external mutation, which is P0. Reconcile provider truth before retrying an ambiguous mutation.

### Lead ingestion and first response

- `lead.ingestion_success_ratio >= 99.5% / 60m`;
- `lead.first_response_p95_seconds <= 300s / 60m`.

Confirm webhook acceptance, durable identity/idempotency, CRM write path and response worker/provider latency separately.

### Webhook

- `webhook.accepted_success_ratio >= 99.9% / 60m`;
- `webhook.failure_count = 0 / 15m`.

Duplicate delivery is expected provider behavior and must be collapsed by the existing idempotency path, not treated as a second business event.

### Outbox, retry, dead-letter and queue

- `outbox.oldest_pending_age_seconds <= 300s`;
- `retry.exhausted_count = 0 / 15m`;
- `dead_letter.pending_count = 0 / 15m`;
- `queue.backlog_count <= 100 / 15m` as the initial Next backlog envelope.

Classify pending/claimed/retryable/dead-letter state before intervention. Do not delete business events or reset counters merely to make a metric green. Recovery must preserve original execution/idempotency/audit identity.

### AG-01

`ag01.failure_count = 0 / 15m`. Separate planning/runtime failure from Core/provider failure through correlation and causation IDs. Never bypass Core, Policy or Approval as an incident workaround.

### Approval

`approval.decision_p95_seconds <= 900s / 60m` is the initial operational latency objective. Approval latency is not permission to auto-approve; incidents are resolved through the existing Approval Store/control-center path.

### CRM

- `crm.durable_write_success_ratio >= 99.9% / 60m`;
- `crm.error_count = 0 / 15m`.

The existing CRM persistence is the only CRM source; do not create a parallel CRM or reconciliation database.

### Attribution / revenue

- `attribution.durable_write_success_ratio >= 99.9% / 60m`;
- `revenue_attribution.error_count = 0 / 15m`.

Preserve source identifiers and immutable evidence required to explain attribution changes.

### Future providers

WhatsApp and Email delivery SLO contracts are declared at `>=99% / 60m` but remain disabled until each provider reaches `PROVIDER_VERIFIED`. Google Ads provider synthetic readback also remains disabled until that gate. Declaring an SLO or a future check must not be interpreted as provider availability.

### R31

`r31.feedback_loop_success_ratio >= 99% / 24h` remains the canonical R31 objective. It stays inactive until its source signals exist.

## Alert routing and escalation

The machine-readable contract requires at least two notification channels from redundant channel families. A second integration that shares the same underlying delivery failure mode does not count as full redundancy.

Initial escalation objective:

- P0: acknowledge/escalate within 5 minutes;
- P1: acknowledge/escalate within 15 minutes;
- P2: acknowledge/escalate within 60 minutes.

Severity rules remain aligned with the V1 taxonomy:

- P0: audit integrity failure, unverified external write/readback invariant, or evidence of uncontrolled duplicate mutation;
- P1: active user/business workflow degradation, Outbox/retry/dead-letter stall, provider errors, material SLO breach;
- P2: optimization/readiness degradation without current governed-path integrity loss.

For every alert:

1. identify the first bad correlation/execution ID, environment, revision and exact time window;
2. inspect durable workflow, approval, idempotency, Outbox/EventRecord and Audit evidence;
3. inspect provider readback when the incident involves external truth;
4. determine whether state is failed, retryable, blocked, ambiguous or already completed at provider;
5. use only the existing governed recovery/reconciliation path;
6. verify recovery using the same correlation/execution chain;
7. close only after metric recovery and durable/provider readback agree;
8. record cause, impact, mitigation and prevention action.

## Controlled alert firing, real delivery and readback

A release-level alert validation is complete only when the evidence chain is proven end to end:

`controlled synthetic signal -> Cloud Monitoring metric -> intended policy incident OPEN -> real notification delivery -> independent channel/readback -> cleanup -> permanent-state readback`.

Required evidence:

- exact release SHA and environment;
- synthetic correlation ID and metric/time series;
- alert policy/condition and incident ID;
- incident OPEN timestamp;
- notification channel IDs and delivery timestamps;
- independent readback from the destination, not merely absence of provider errors;
- routing/severity/escalation classification;
- temporary-resource cleanup;
- readback proving permanent policies/channels were not unintentionally mutated.

The verified 2026-08-16 baseline may be reused for unchanged provider capability and notification-channel delivery capability. A Next release still needs controlled revalidation for new/changed policy definitions or routes.

## Synthetic checks

Synthetic application checks are non-destructive. They may perform authenticated health/readiness inspection, internal durable-state verification and provider READ/readback, but cannot publish, activate campaigns, pay, send WhatsApp/Email messages, or perform another business-provider mutation solely as proof.

A controlled monitoring-plane notification is allowed only for the explicit alert-delivery gate. It must use a temporary/synthetic signal and perform cleanup/readback; it is not authorization to mutate a business provider.

## Dashboard and managed-provider activation

The JSON files in `infra/observability` are canonical declarative contracts. Existing alert delivery has historical production-provider evidence, but any newly declared policy is `IMPLEMENTED`/`CI_VERIFIED` until provisioned and independently read back from Cloud Monitoring. WhatsApp, Email and Google Ads monitoring entries remain inactive until their own provider verification gates are satisfied.

## Postmortem minimum

A P0/P1 postmortem records: incident ID, start/end, affected environment/revision/route/tenant/provider, detection signal, correlation/execution IDs, provider truth, durable truth, root cause, recovery action, whether any duplicate side effect occurred, Quality/security/deploy run IDs, alert delivery/readback evidence and prevention actions.
