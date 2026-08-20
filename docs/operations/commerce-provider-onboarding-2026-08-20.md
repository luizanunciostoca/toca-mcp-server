# Commerce Provider Onboarding — 2026-08-20

## Status

`BOUNDARY_IMPLEMENTED / PROVIDER_NOT_SELECTED / PROVIDER_VERIFIED=false / PRODUCTION_VERIFIED=false`

Final integration baseline revalidated and synchronized before exact-head gates: `main@47348e0608bd3936fc1419fa495e8b6761489934`.

No provider adapter is registered in runtime by this change. No provider credential is assumed, no webhook endpoint is exposed, and no synthetic fixture is production evidence.

## Canonical reuse

This workstream reuses, and must continue to reuse:

- `src/measurement/adapters.ts` — existing `TicketingReadOnlyAdapter` plus the new provider-neutral commerce readback boundary;
- `src/measurement/service.ts` — existing EventRecord-bound ticketing identity, sales summary, inventory, webhook receipt and reconciliation flows;
- `src/measurement/attribution-revenue-*` — existing touchpoints, provider-backed revenue evidence, refund/cancellation accounting, WON fail-closed gate and Marketing ↔ Sales feedback;
- `src/crm/crm-records.ts` — canonical Contact/Lead/Opportunity records and channel lookup;
- `src/events/event-record.ts` — canonical event identity/external references;
- `src/learning/*` — R31 recommendation-only learning runtime.

There is no new CRM, finance system, payment ledger, attribution engine, Opportunity model or event bus.

## Revenue invariant

DM, click, UTM, campaign, conversation, lead, Opportunity value, ticketing aggregate sales, or a webhook payload alone do **not** prove revenue.

Revenue evidence is accepted only after:

1. webhook signature verification;
2. provider event normalization;
3. provider readback;
4. canonical Contact/Opportunity matching;
5. persistence through the existing `AttributionRevenueService.recordRevenueEvidence()` using one of `TICKETING | CHECKOUT | PAYMENT | ORDER`.

`PENDING` never becomes revenue. `PAID` maps to `CONFIRMED`; `CANCELED` maps to `CANCELED`; `REFUNDED` and `CHARGEBACK` map to `REFUNDED`. Refund/chargeback requires a positive provider-backed refund amount.

WON remains a separate governed call through `AttributionRevenueService.confirmOpportunityWon()` and is only exposed by the coordinator after a persisted `PAID` readback.

## Provider discovery

### PIXTA

Evidence found:

- recent public Toca do Morcego organizer/event presence on PIXTA;
- PIXTA producer documentation exposes event management, real-time sales/payment-status visibility and checkout operations.

Not found in public documentation during this workstream:

- organizer REST/API contract;
- webhook contract/signature scheme;
- read-only API credential model;
- order/payment readback endpoint contract.

Result: **candidate/current-business signal, not yet a technical provider decision**.

### IngressoLive

Evidence found:

- historical Toca do Morcego assets in the canonical Drive folder `Ingresso Live` (2022);
- current IngressoLive organizer product exposes sales/transaction reporting by order, buyer and payment method.

Not found in public documentation during this workstream:

- organizer REST/API contract;
- webhook contract/signature scheme;
- read-only API credential model;
- order/payment readback endpoint contract.

Result: **historical-business signal, not yet a technical provider decision**.

## Human action required

Before implementing a concrete provider adapter, the business owner/operator must provide or obtain all of the following for the provider that is actually used today:

1. confirm the active production provider name (PIXTA, IngressoLive, or another provider);
2. provide the organizer/account identifier;
3. request/enable official API access from the provider if it is not self-service;
4. provide a **read-only** API credential/token for event/order/payment readback;
5. provide the official webhook signing secret or signature-verification contract;
6. provide one non-sensitive real event/order/payment identifier for staging readback validation;
7. confirm webhook event types for paid/pending/canceled/refunded and chargeback when supported;
8. confirm fields for order ID, payment ID, amount, currency, customer email/phone and event ID;
9. confirm whether checkout metadata/custom fields can carry TOCA `opportunityId`, `contactId`, `conversationId`, UTM/campaign/ad/content references;
10. authorize a staging callback URL only after signature verification is implemented.

Secrets must be provisioned through the existing secret/configuration boundary and must never be committed to Git.

## Concrete adapter acceptance gate

A provider-specific adapter may be promoted only when all items below pass against the real provider:

- signature verification with the provider's official algorithm;
- paid readback;
- pending readback that produces no revenue;
- cancellation readback;
- refund readback;
- chargeback readback when supported;
- duplicate webhook/idempotent retry;
- unknown-contact fail-closed behavior;
- matching-contact/Opportunity behavior;
- attribution-known and attribution-unknown behavior;
- process restart followed by deterministic retry;
- provider readback after webhook delivery;
- PostgreSQL E2E proving durable `RevenueEvidenceRecord`, EventRecord lineage, CRM WON gate, outbox/audit and R31 feedback.

Provider-shaped fixtures can validate contracts but **do not** satisfy `PROVIDER_VERIFIED` or `PRODUCTION_VERIFIED`.

## Intended final runtime path

`provider webhook -> signature -> provider adapter -> provider readback -> canonical CRM match -> Attribution touchpoint (only when signals exist) -> RevenueEvidenceRecord -> governed Opportunity WON -> Marketing/Sales feedback -> R31 learning input`

If the provider cannot expose an API or signed webhook, do not scrape authenticated panels or infer revenue. Escalate for an official export/integration path or select another approved source of provider-backed order/payment evidence.
