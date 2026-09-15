# TOCA OS FinOps Billing Reconciliation and Budget Intelligence v1

Status: IMPLEMENTATION_CANDIDATE / ADVISORY_ONLY

## Purpose

Extend W-FINOPS-01 and W-FINOPS-02 from runtime metering into durable external billing evidence, scoped ledger-to-billing reconciliation and budget utilization intelligence.

Stable flow:

`COST LEDGER -> VERIFIED BILLING SNAPSHOT -> READ-ONLY RECONCILIATION -> BUDGET BAND -> ADVISORY EVIDENCE`

This wave does not settle invoices, mutate billing, alter campaign spend or authorize provider effects. Core Policy/Approval remains authoritative for all business effects.

## External billing snapshots

Migration 042 adds `finops_billing_snapshots` as an append-only evidence table. Each snapshot carries tenant/workspace/organization scope, provider, optional model/campaign scope, cost category, an explicit billing window, billed cost in integer micro-USD and an opaque evidence reference.

Snapshots are USD-only in this wave. `NO_FX_CONVERSION` is a hard boundary: BRL, EUR or any other currency must fail closed until a separately governed canonical FX source and conversion policy are approved. This avoids silently mixing Meta Ads local-currency spend with the existing USD FinOps ledger.

The snapshot store uses deterministic SHA-256 hashing and event-style idempotency. The same snapshot ID with the same canonical payload is an idempotent replay; the same ID with a different payload is rejected. UPDATE and DELETE are rejected at the PostgreSQL layer.

This wave does not add a provider billing fetcher. A caller may persist a snapshot only after it has independently verified provider/billing evidence. Raw invoices, credentials and arbitrary provider payloads are not stored by this contract.

## Ledger-to-billing reconciliation

`PostgresFinopsReadModel` aggregates only `ACTUAL` CostEvents inside the same tenant/workspace/organization scope and half-open billing window. Optional provider, model, category, route, agent and campaign filters remain parameterized.

Billing reconciliation compares a persisted/provider-backed billed amount against the scoped ledger aggregate and returns one of:

- `MATCHED`;
- `WITHIN_TOLERANCE`;
- `MISSING_LEDGER_COST`;
- `BILLING_EXCEEDS_LEDGER`;
- `LEDGER_EXCEEDS_BILLING`.

Tolerance is explicit integer micro-USD. No reconciliation result changes provider state, budgets, routing or authorization.

## Cost intelligence dimensions

The read model can aggregate ACTUAL cost by a fixed allowlist of dimensions:

- provider;
- category;
- route;
- agent;
- campaign.

Dynamic SQL identifiers are never accepted from callers. Dimension selection is mapped from the fixed `FinopsCostDimension` enum, while all scope/filter values remain query parameters.

## Budget intelligence

`evaluateBudgetUtilization` is deterministic and advisory. It classifies an explicit cost total against an explicit budget using the canonical alert bands:

- below 50% -> `BELOW_50`;
- 50% -> `NOTICE_50`;
- 70% -> `WARNING_70`;
- 85% -> `CRITICAL_85`;
- 100% or above -> `EXCEEDED_100`.

The function reports remaining and overage micro-USD plus utilization basis points. Large-ratio basis-point output is capped safely while the band decision itself is calculated with BigInt comparisons. Every assessment carries `advisoryOnly: true` and `sideEffects: false`.

## Safety boundary

W-FINOPS-03 performs no billing mutation, no automatic budget change, no campaign spend mutation, no automatic model switch, no provider write, no publication, no deploy and no AG-01 recovery action.

Provider billing evidence is observational. Budget alerts are advisory evidence only. This wave cannot activate, pause, scale, publish, route or spend.

## PostgreSQL acceptance

The dedicated PostgreSQL E2E applies migrations 041 and 042, verifies billing snapshot idempotency and tenant isolation, proves append-only enforcement, rejects non-USD persistence, aggregates scoped ACTUAL cost, groups cost by a fixed dimension and reconciles the ledger against the billing snapshot.

The canonical PostgreSQL workflow must execute this E2E with a real `DATABASE_URL`; a skipped local test is not sufficient acceptance evidence.
