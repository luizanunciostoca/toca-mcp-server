# Commerce Provider Onboarding — 2026-08-20

## Status

`BOUNDARY_TECHNICALLY_STABILIZED / ACTIVE_SALES_SURFACE_CONFIRMED / UNDERLYING_PROVIDER_UNRESOLVED / API_CONTRACT_UNAVAILABLE / CREDENTIALS_UNAVAILABLE / PROVIDER_VERIFIED=false / PRODUCTION_VERIFIED=false`

Final integration baseline revalidated and synchronized before exact-head gates: `main@47348e0608bd3936fc1419fa495e8b6761489934`.

The provider-neutral boundary was stabilized at `cf9abdd73f5a13f30efca9da12f0a3e40d4327d1`; its exact-head Quality Gate, Security Supply Chain and PostgreSQL E2E were green before this provider-discovery documentation update.

No provider adapter is registered in runtime by this change. No provider credential is assumed, no webhook endpoint is exposed, and no synthetic fixture is production evidence.

## Canonical reuse

This workstream reuses, and must continue to reuse:

- `src/measurement/adapters.ts` — existing `TicketingReadOnlyAdapter` plus the provider-neutral commerce readback boundary;
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

## Current operational sales surface

Confirmed on 2026-08-20:

- the official Toca do Morcego domain currently exposes active ticket/event products under `https://tocadomorcego.com.br/produtos/...`;
- the current product flow exposes event date, ticket lot/quantity, price, terms acceptance and customer login/registration in the Toca domain;
- the canonical TOCA_OS paid-media registry contains historical advertising that already landed directly on `https://tocadomorcego.com.br/produtos/experiencia-por-do-sol-3822.html`;
- the visible current storefront does not identify PIXTA, IngressoLive or TurSites as the underlying provider.

The Toca-owned domain is therefore confirmed as the **active sales surface**, not as proof of the underlying commerce provider identity.

A similar storefront interaction pattern is publicly visible on unrelated tourism/event sites. That is only a technical fingerprint hypothesis and is explicitly insufficient to select a provider.

## Provider discovery revalidation

### PIXTA

Revalidation result:

- no PIXTA credential/configuration was found in the repository;
- no PIXTA artifact was found in the canonical Drive searches used for this workstream;
- the previously reported public Toca/PIXTA business signal could not be independently reproduced during this revalidation;
- no official organizer API contract, signed webhook contract, read-only credential model or order/payment readback contract was verified.

Result: **unverified candidate only; not selected**.

### IngressoLive

Confirmed evidence:

- historical Toca do Morcego assets exist in the canonical Drive folder `Ingresso Live`;
- public IngressoLive event pages prove that Toca do Morcego used IngressoLive for ticket sales in 2023;
- the historical pages identify Toca do Morcego / Toca do Morcego LTDA as organizer and IngressoLive as the licensed online platform.

Not established:

- that IngressoLive is the active 2026 provider behind the Toca-owned storefront;
- an official organizer REST/API contract;
- a signed webhook contract/signature scheme;
- a read-only API credential model;
- an order/payment readback endpoint contract suitable for the canonical Commerce boundary.

Result: **historical provider evidence, not current provider evidence; not selected**.

### TurSites

Confirmed public capability evidence:

- TurSites exposes product publishing and online sales capabilities including `Ingressos`;
- TurSites documents supplier/API integrations used by agency sites for consultation and/or purchase flows.

Not established:

- any contractual, account, DNS, source-code, credential or operator evidence binding Toca do Morcego to TurSites;
- that the Toca storefront is operated by TurSites;
- an organizer commerce API providing signed webhooks plus authoritative order/payment readback for this use case.

Result: **compatible technology hypothesis only; not selected**.

## Credential and deployment revalidation

Repository/configuration evidence checked on 2026-08-20:

- `.env.example` contains Meta/Instagram/SendGrid/runtime configuration but no PIXTA, IngressoLive, TurSites or generic production Commerce provider credential;
- the current GCP deploy workflow injects database and Meta secrets, but no ticketing/checkout/payment/order provider secret;
- repository searches did not reveal an active PIXTA, IngressoLive or other concrete commerce provider adapter/configuration;
- no commerce provider credential was found or committed by this workstream.

The absence of a committed secret is correct security behavior. The blocker is the absence of a verified provider identity plus an approved Secret Manager credential/configuration path, not a request to put secrets in Git.

## Exact blocker

The current blocking state is:

`ACTIVE_SALES_SURFACE_CONFIRMED / UNDERLYING_PROVIDER_UNRESOLVED / OFFICIAL_READBACK_API_UNVERIFIED / SIGNED_WEBHOOK_CONTRACT_UNVERIFIED / APPROVED_CREDENTIAL_UNAVAILABLE / PROVIDER_VERIFIED=false / PRODUCTION_VERIFIED=false`

A concrete provider adapter MUST NOT be implemented or registered until the active provider is proven by operator/account evidence and the provider exposes an official integration path capable of authoritative order/payment readback.

If the active storefront uses multiple layers (for example, site platform plus a separate payment/ticketing backend), the selected `CommerceProviderReadbackAdapter` must bind to the layer that can authoritatively prove the commercial state. A website CMS/template provider is not sufficient merely because it renders checkout UI.

## Evidence required to unblock implementation

Before implementing a concrete provider adapter, the business owner/operator must provide or obtain all of the following for the provider that is actually used today:

1. active production provider/vendor identity from the organizer/admin account, contract, invoice or equivalent operator evidence;
2. organizer/account identifier;
3. official API access or an official export/integration contract supporting order/payment readback;
4. a least-privilege read credential/token provisioned through the existing secret/configuration boundary;
5. official webhook signing secret or documented signature-verification contract;
6. one non-sensitive real event/order/payment identifier for staging readback validation;
7. webhook event types for paid/pending/canceled/refunded and chargeback when supported;
8. fields for order ID, payment ID, amount, currency, customer email/phone and event ID;
9. confirmation whether checkout metadata/custom fields can carry TOCA `opportunityId`, `contactId`, `conversationId`, UTM/campaign/ad/content references;
10. authorization of a staging callback URL only after signature verification and anti-replay are implemented.

Secrets must be provisioned through the existing secret/configuration boundary and must never be committed to Git.

## Concrete adapter acceptance gate

A provider-specific adapter may be promoted only when all items below pass against the real provider:

- official signature verification;
- anti-replay enforcement;
- paid provider readback;
- pending readback that produces no revenue;
- cancellation readback;
- refund readback;
- chargeback readback when supported;
- duplicate webhook/idempotent retry;
- reconciliation against authoritative provider state;
- unknown-contact fail-closed behavior;
- matching Contact/Opportunity behavior;
- attribution-known and attribution-unknown behavior;
- process restart followed by deterministic retry;
- provider readback after webhook delivery;
- PostgreSQL E2E proving durable `RevenueEvidenceRecord`, EventRecord lineage, CRM WON gate, outbox/audit and R31 feedback.

Provider-shaped fixtures can validate contracts but **do not** satisfy `PROVIDER_VERIFIED` or `PRODUCTION_VERIFIED`.

## Intended final runtime path

`provider webhook -> signature -> anti-replay -> provider adapter -> provider readback -> reconciliation -> canonical CRM match -> Attribution touchpoint (only when signals exist) -> RevenueEvidenceRecord -> governed Opportunity WON -> Audit/Event/outbox -> Marketing/Sales feedback -> R31 learning input`

If the provider cannot expose an API, authoritative signed callback, or another official machine-readable readback mechanism, do not scrape authenticated panels and do not infer revenue. Escalate for an official export/integration path or select another approved source of provider-backed order/payment evidence.
