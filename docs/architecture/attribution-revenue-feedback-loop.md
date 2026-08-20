# Attribution + Revenue Intelligence — Marketing ↔ Sales Feedback Loop

Status: **IMPLEMENTED** on the feature branch. Promotion requires exact-head CI evidence. No provider write is introduced by this foundation.

## Canonical architecture

This implementation extends the existing CRM, Measurement, PostgreSQL, Transactional Outbox and Audit Ledger. It does not create a second CRM, MCP, scheduler, Approval Engine, Policy Engine, event bus or database.

Execution lineage remains:

`AG-01 / TOCA_OS → ROUTE_ID → identity → typed contract → authorization → policy/approval when applicable → canonical Core store/service → provider/readback evidence when applicable → PostgreSQL → Transactional Outbox + Audit Ledger → feedback/learning`

The implementation is intentionally internal to the canonical R31 measurement/performance boundary. It does not add a direct provider path or expose a parallel MCP surface.

## AttributionTouchpoint

`AttributionTouchpointRecord` captures durable, deduplicated lineage for:

- source, medium, campaign, content and term;
- Meta campaign, ad set, ad and creative IDs;
- reserved Google campaign, ad group, ad and creative IDs;
- generic click ID plus `fbclid`, `gclid`, `gbraid` and `wbraid`;
- landing URL and session;
- lead source;
- existing CRM Contact, Lead and Opportunity references;
- Conversation and Message references without creating a second conversation model;
- ticket, checkout, order and payment references when already known;
- message/copy reference, intent and Demand context.

Conversation/Message IDs are opaque references in this PR because the canonical CRM `ConversationRecord` / `MessageRecord` implementation is owned by parallel PR #22. After #22 merges, an integration change may add foreign keys only if its final canonical table contract remains compatible; this PR does not duplicate those records.

### Dedupe

Touchpoints use a deterministic SHA-256 key over tenant + attribution source + source event ID. The service also derives deterministic record IDs from the operation idempotency key when an explicit ID is not supplied. PostgreSQL enforces scoped uniqueness. Replays with the same idempotency key return the same response, and a second idempotency key for the same business source event resolves to the already persisted record instead of duplicating it.

## Configurable attribution windows

`AttributionWindowPolicy` versions three independent lookback windows:

- first touch;
- last touch;
- assisted touch.

`resolveAttributionRoles()` evaluates only touchpoints at or before the conversion time and assigns deterministic `FIRST_TOUCH`, `LAST_TOUCH` and `ASSISTED` roles. This coexists with the pre-existing aggregate attribution calculator; it adds durable CRM-linked touchpoint lineage rather than replacing the older analytics primitive.

## Revenue evidence boundary

Revenue evidence is fail-closed. The only accepted sources are:

- `TICKETING`;
- `CHECKOUT`;
- `PAYMENT`;
- `ORDER`.

Every record requires provider identity, provider event ID, provider evidence/readback reference, external commerce reference, provider readback timestamp and the source-specific ticket/checkout/payment/order reference.

**Clicks, UTMs, sessions, DMs, Conversation records, campaign IDs and creative IDs are never accepted as revenue evidence.** They establish acquisition/intent lineage only.

The revenue engine handles:

- provider-event dedupe;
- confirmation;
- refunds;
- cancellations;
- ISO currency consistency;
- gross/net/realized revenue;
- contribution margin when cost is available.

A cancellation invalidates a prior confirmation only when it occurs at or after that confirmation. A full refund also invalidates that confirmation; a partial refund reduces realized revenue while preserving the remaining conversion value. A later independent provider confirmation may restore an active commerce reference.

## WON gate

The canonical CRM remains the only Opportunity store. `AttributionRevenueService.confirmOpportunityWon()` calls the existing `CrmCoreStore.transitionOpportunity()` only after reliable persisted commerce evidence exists.

Migration `028_attribution_revenue_feedback.sql` also installs a PostgreSQL trigger on `crm_opportunities` that rejects an `OPEN → WON` persistence transition unless there is at least one active, non-canceled and not fully refunded confirmed `TICKETING/CHECKOUT/PAYMENT/ORDER` readback record for that Opportunity. This prevents a caller from bypassing the service and marking WON directly through the CRM store or SQL update.

The CRM lifecycle contract itself is not duplicated or replaced. The database gate adds the evidence invariant required for a WON transition.

## Marketing ↔ Sales feedback

Each materialized `MarketingSalesFeedbackSnapshot` returns:

### Sales → Marketing

- lead quality/score;
- qualification;
- WON/LOST/CANCELED/OPEN outcome;
- reason lost;
- realized revenue;
- contribution margin when available;
- currency;
- sales-cycle duration.

### Marketing → Sales

- campaign;
- creative;
- message/copy reference;
- source;
- intent;
- Demand context;
- selected attribution touchpoint and its first/last/assisted roles.

Snapshots are append-only, idempotent, emitted through the existing Transactional Outbox and written to the existing hash-chained Audit Ledger in the same PostgreSQL transaction.

## Persistence and audit

Migration `028_attribution_revenue_feedback.sql` adds only same-database domain tables:

- `attribution_window_policies`;
- `attribution_touchpoints`;
- `revenue_evidence_records`;
- `marketing_sales_feedback_snapshots`;
- `measurement_intelligence_idempotency`.

History tables are append-only. Business mutation + idempotency completion + existing Transactional Outbox event + existing Audit Ledger append are atomic.

The pre-existing CRM audit helper remains backwards-compatible. A fixed `core.measurement` wrapper is added to the same helper so measurement mutations cannot invent arbitrary audit namespaces.

## Parallel-work / migration coordination

At implementation start, current `main` was `cd99521c8842268c5e1fb9e5efe58f9f6680ddf0`.

Latest parallel reservations observed before PR creation:

- PR #15: `022_meta_ads_geo_demand_intelligence.sql`;
- PR #18: a different `022_asset_intelligence_content_supply.sql` — unresolved collision with #15;
- PR #22: `023_crm_sales_engine.sql`;
- PR #23: `024` for Email / CRM communication provider state;
- PR #26: `025_marketing_autopilot_r31_learning.sql`;
- PR #21: `026_ag01_orchestrator_runtime.sql` in its current integration sequence;
- PR #30 and PR #31 currently both declare `027_*` migrations — unresolved collision between those two fronts.

This PR therefore reserves `028_attribution_revenue_feedback.sql` in the current snapshot. The integration coordinator must still globally reserialize migrations immediately before merge if predecessor ordering changes; this PR will not force another branch around a stale reservation.

## Evidence state

The feature begins at `IMPLEMENTED`.

Promotion rules:

- `CI_VERIFIED`: exact final HEAD has green Format, Architecture, Lint, Typecheck, Unit Tests, Build and PostgreSQL E2E;
- `PROVIDER_VERIFIED`: a real approved ticketing/checkout/payment/order provider readback is captured through the canonical provider boundary and read back from this new evidence path without a provider side effect solely for testing;
- `PRODUCTION_VERIFIED`: requires production migration/runtime rollout plus production readback and operational evidence.

Synthetic PostgreSQL tests may prove the gate and durability but cannot promote provider or production evidence states.
