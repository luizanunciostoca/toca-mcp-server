# Analytics Read Models + Operational Capacity Intelligence

Status: `IMPLEMENTED — AWAITING CI EVIDENCE`

## Purpose

This module adds read-only analytical projections over the existing TOCA Core PostgreSQL truth. It does **not** introduce a warehouse, a second CRM, a second telemetry store, a parallel scheduler, or a provider write path.

Canonical source chain:

`Measurement / CRM / Ticketing / Publication / Audit Ledger -> PostgreSQL read model -> derived KPI / capacity assessment / alert -> consumer`

Consumers may include AG-01, Marketing Autopilot, Paid Media recommendations and the future Human Control Center. A consumer must still use the governed Core for every side effect.

## Existing tables reused

No migration is introduced by this feature.

- `measurement_events` — normalized marketing observations and attribution dimensions.
- `crm_leads` / `crm_opportunities` — lead, qualification, pipeline and current outcome state.
- `ticketing_sales_snapshots` — authoritative event sales/revenue snapshots.
- `ticketing_inventory_snapshots` — capacity, sold, available and held inventory.
- `provider_publications` — publication reliability when the record is tenant-bound.
- `audit_ledger_events` — provider success/failure evidence when `connected_account` is present.

The feature intentionally avoids a migration because the current parallel program already has serialized migration ownership. Read models remain additive and can survive later schema integration.

## KPI semantics

The executive snapshot exposes:

- reach;
- engagement;
- spend;
- CPL = spend / captured leads;
- qualified lead rate = qualified leads / captured leads;
- opportunity rate = created opportunities / qualified leads;
- win rate = WON / (WON + LOST) for the opportunity cohort;
- CAC = spend / distinct WON customers;
- realized revenue from latest `ticketing_sales_snapshots` only;
- ROAS = realized revenue / spend, only when currencies match;
- response SLA compliance when a canonical SLA activity source is supplied;
- current OPEN pipeline value;
- average OPEN opportunity age;
- creative performance observations;
- Demand Index when supplied by the governed Demand Intelligence adapter;
- capacity assessment;
- publication reliability;
- provider failure rate.

A missing source is `UNAVAILABLE`, not zero. Currency ambiguity is never silently aggregated. Revenue is never inferred from a click, DM, lead or opportunity value.

## Measurement observation convention

`measurement_events` remains the canonical normalized event table. Analytics adapters may add these properties to a normalized event:

- `analyticsMetric`: `reach`, `engagement`, `spend`, `conversion`, or `attributed_revenue`;
- `analyticsValue`: non-negative numeric value for count-like observations;
- `creativeId`: provider/canonical creative reference when known;
- `adId`: provider ad reference when known.

`spend` and `attributed_revenue` use the existing `value_minor` + ISO currency columns instead of embedding money in JSON.

Creative `attributed_revenue` is an attribution observation for creative analysis. It does **not** replace realized revenue, which remains ticketing/order/payment evidence.

## Drilldown contract

The PostgreSQL store supports:

`result -> opportunity -> lead -> measurement touchpoints -> campaign -> ad -> creative/content`

Touchpoints are only attached when `measurement_events.subject_id` binds to the canonical contact/lead/opportunity. The read model does not guess identity relationships.

## Operational capacity

Capacity thresholds are explicit policy input. There are no hidden business thresholds in code.

States:

- `UNKNOWN` — capacity source is unavailable; positive media growth fails closed.
- `OPEN` — capacity is below the configured watch threshold.
- `WATCH` — positive growth is clamped to the configured maximum.
- `NEAR_CAPACITY` — positive growth is blocked.
- `SOLD_OUT` — positive growth is blocked.
- `BLOCKED` — an explicit operational constraint blocks growth regardless of ticket inventory.

Negative/de-risking media changes remain allowed because capacity pressure must not prevent reducing spend.

## Parallel integration boundaries

### Demand Intelligence / PR #15

This feature does not import the unmerged Demand branch. It accepts a typed `DemandSignalInput` (`index`, `confidence`, timestamp, evidence). After Demand Intelligence is merged, its read-only output can be adapted without changing the analytics schema.

### CRM Sales Engine / PR #22

Current V1 CRM has no canonical Conversation/Message first-response activity timeline. Therefore response SLA returns `UNAVAILABLE` unless a typed `ResponseSlaAggregate` is supplied. After #22 is merged, an adapter can populate this field from canonical SalesActivity/Message evidence. No SLA is fabricated before that dependency exists.

### Platform hardening / PR #20

`AnalyticsAlert` is a derived domain signal only. This feature does not create alert transport, dashboards or a second observability backend. PR #20 remains owner of SLO/alert routing infrastructure.

## Paid-media safety

`applyPaidMediaCapacityGuardrail` is pure and read-only. It never mutates Meta Ads or Google Ads.

A later paid-media workflow must still follow:

`READ -> PREPARE -> governed recommendation -> explicit approval when required -> provider write capability -> READBACK -> audit/outbox`.

High demand cannot override `NEAR_CAPACITY`, `SOLD_OUT`, `BLOCKED` or unknown capacity.

## Evidence gates

Promotion requires:

1. repository Quality Gate on the exact head;
2. PostgreSQL E2E on the exact head using canonical migrations;
3. no temporary workflow in the final tree;
4. no provider write executed for validation;
5. later provider READ evidence only when a concrete consumer/provider integration is promoted.
