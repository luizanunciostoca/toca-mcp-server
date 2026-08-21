# TOCA OS Next — Observability and Incident Runbook

Status: **IMPLEMENTED CONTRACT / PROVIDER ACTIVATION NOT CLAIMED**

Routes: `R25 OBSERVABILITY_AND_INCIDENT_RESPONSE`, `R31 PERFORMANCE_FEEDBACK_OPTIMIZATION`.

The existing V1 source plane remains canonical: structured JSON logs, `operational_signals`, correlation/execution IDs, Audit Ledger, workflow/approval persistence, Transactional Outbox and EventRecord. This runbook adds next-version SLO coverage without creating a second telemetry system.

Machine-readable contracts:

- `src/core/platform-slo-catalog.ts`;
- `infra/observability/platform-hardening-dashboard.json`;
- `infra/observability/platform-hardening-alerts.json`;
- `infra/observability/platform-hardening-synthetics.json`.

## Correlation and structured logging

Every signal used for incident triage must preserve the existing correlation chain whenever available: `correlation_id`, `execution_id`, `tenant_id`, `route_id`, provider and terminal status. Logs remain structured JSON. Secret values and raw access tokens are forbidden log fields.

## SLO coverage

### Publication

`publication.verified_terminal_success_ratio >= 99.5% / 60m`. A successful external publication without provider verification is not a success and follows the existing P0 unverified-write invariant.

### Workflow

`workflow.terminal_success_ratio >= 99.5% / 60m`. Inspect durable workflow state before attempting recovery. Never skip approval/policy/idempotency to clear an incident.

### Provider readback

`provider.readback_verified_ratio = 100%` for terminal external write successes. Any gap is P0. Reconcile provider truth before retrying an ambiguous mutation.

### Lead ingestion

`lead.ingestion_success_ratio >= 99.5% / 60m`. Confirm webhook acceptance, durable identity/idempotency and CRM write path separately.

### First response

`lead.first_response_p95_seconds <= 300s / 60m`. Separate ingestion delay from worker/provider response delay using correlation IDs.

### Webhook

`webhook.accepted_success_ratio >= 99.9% / 60m`. Duplicate delivery is expected provider behavior and must be collapsed by the existing idempotency path, not treated as a second business event.

### Outbox

`outbox.oldest_pending_age_seconds <= 300s`. Classify pending/claimed/retryable/dead-letter state before intervention. Do not delete business events to make the SLO green.

### Retry and dead-letter

`retry.exhausted_count = 0` and `dead_letter.pending_count = 0` in the 15-minute operational window. A non-zero value opens an incident; recovery must preserve original execution/idempotency/audit identity.

### CRM

`crm.durable_write_success_ratio >= 99.9% / 60m`. The existing CRM persistence is the only CRM source; do not create a parallel CRM or reconciliation database.

### Attribution

`attribution.durable_write_success_ratio >= 99.9% / 60m`. Preserve source identifiers and immutable evidence required to explain attribution changes.

### Future providers

WhatsApp and Email SLO contracts are declared at `>=99% / 60m` but remain disabled until each provider reaches the required implementation/provider evidence. Declaring an SLO must not be interpreted as provider availability.

### R31

`r31.feedback_loop_success_ratio >= 99% / 24h` is declared for the future R31 feedback/optimization loop. It remains inactive until R31 is implemented and its source signals exist.

## Alert triage

Severity rules remain aligned with the V1 taxonomy:

- P0: audit integrity failure or unverified external write/readback invariant;
- P1: active user/business workflow degradation, Outbox/retry/dead-letter stall, material SLO breach;
- P2: optimization/readiness degradation without current governed-path integrity loss.

For every alert:

1. identify the first bad correlation/execution ID and exact time window;
2. inspect durable workflow, approval, idempotency, Outbox/EventRecord and Audit evidence;
3. inspect provider readback when the incident involves external truth;
4. determine whether state is failed, retryable, blocked, ambiguous or already completed at provider;
5. use only the existing governed recovery/reconciliation path;
6. verify recovery using the same correlation/execution chain;
7. close only after metric recovery and durable/provider readback agree;
8. record cause, impact, mitigation and prevention action.

## Notification delivery, firing and readback evidence

A policy is not considered operational merely because its definition exists. Release validation must prove the complete alert path without creating a business side effect:

1. select a versioned policy and its incident/runbook correlation;
2. inject or trigger only the safe synthetic control-plane signal declared in `platform-hardening-synthetics.json`;
3. read back the Cloud Monitoring incident in the firing/open state;
4. prove delivery to the configured notification channels, with at least two independent channel families when required by the alert contract;
5. record the alert policy ID, incident ID, synthetic execution/correlation reference, notification delivery evidence and this runbook reference;
6. clear the synthetic condition, read back incident recovery/closure and remove any temporary synthetic control-plane resource.

A missing notification, missing firing readback, missing correlation or missing runbook association is a failed release-validation result. Provider write/send operations must never be used only to force an alert.

## Synthetic checks

Synthetic checks are deliberately non-destructive. They may perform authenticated health/readiness inspection, internal durable-state verification and provider READ/readback, but cannot publish, activate campaigns, pay, send future WhatsApp/Email messages, or perform another external mutation solely as proof.

## Dashboard and alert provider activation

The JSON files in `infra/observability` are canonical declarative contracts. They become `PROVIDER_VERIFIED` only after the managed monitoring provider has been provisioned from the contract and independently read back. Until then the evidence state is `IMPLEMENTED` or `CI_VERIFIED` only.

## Postmortem minimum

A P0/P1 postmortem records: incident ID, start/end, affected route/tenant/provider, detection signal, correlation/execution IDs, provider truth, durable truth, root cause, recovery action, whether any duplicate side effect occurred, Quality/security run IDs, notification/readback evidence and prevention actions.
