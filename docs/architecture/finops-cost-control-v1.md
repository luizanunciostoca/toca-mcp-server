# TOCA OS FinOps Cost Control v1

Status: IMPLEMENTATION_CANDIDATE / ADVISORY_ONLY

## Purpose

Introduce cost observability and pre-execution cost controls without creating a second Policy Engine, Approval Engine, scheduler, CRM, billing system or provider executor.

Stable flow:

`INTENT -> PLAN -> COST ESTIMATE -> COST GATE -> CORE POLICY/APPROVAL -> EXECUTION -> PROVIDER USAGE/READBACK -> ACTUAL COST -> RECONCILIATION`

A Cost Gate may only add restrictions. `ALLOW` means only that the estimate is within the supplied financial threshold; it does not authorize a capability or provider side effect.

## Cost ledger

Migration `041_finops_cost_ledger.sql` adds `finops_cost_events` as an append-only evidence ledger. Every event is tenant/workspace/organization scoped and carries stable execution/correlation IDs. Monetary values are stored as integer micro-USD to avoid floating-point money. Updates and deletes are rejected by a database trigger.

The PostgreSQL boundary enforces non-empty scoped identifiers, JSON-object storage for usage/metadata and safe-integer monetary bounds. Correlation reads require tenant, workspace and organization scope in addition to `correlationId`, preventing cross-tenant reads when correlation IDs collide.

The ledger supports ESTIMATE, ACTUAL and RECONCILIATION events. Provider/business-specific usage remains evidence, not authority. A repeated `eventId` is idempotent only when its canonical SHA-256 is identical; canonicalization includes persisted metadata defaults and normalized timestamps so a read/replay remains stable. A conflicting payload fails closed.

`metadata` is deliberately not an arbitrary JSON sink. It accepts only a strict allowlist of bounded opaque evidence/reference identifiers and rejects free-form provider/user payloads. Database rows with non-object usage or metadata fail closed instead of being silently coerced.

A `DATABASE_URL`-gated PostgreSQL E2E suite covers migration application, scoped reads, row round-tripping, idempotent replay/conflict, append-only mutation rejection and database constraint enforcement.

## Pricing catalog

`src/finops/pricing-catalog.ts` pins a versioned provider price catalog. v1 was verified against the official Google Cloud generative-AI pricing page on 2026-09-15. Historical CostEvents always carry the catalog version used for their calculation.

Provider prices are technical inputs. Business budgets, automatic-spend limits and approval ceilings must remain canonical business policy supplied to the Cost Gate; they are deliberately not hard-coded into this module.

All monetary arithmetic remains integer micro-USD. Per-component and aggregate totals fail closed on `Number.MAX_SAFE_INTEGER` overflow before reaching the Cost Gate.

## AI Cost Router

`routeAiCost()` is advisory and performs no provider call. It recommends:

1. deterministic execution when a deterministic path exists and language generation is unnecessary;
2. Gemini 2.5 Flash Lite for routine classification/extraction/summary/FAQ/copy work;
3. Gemini 2.5 Flash for high-complexity, high-ambiguity, planning and strategy work;
4. Flex/Batch pricing only when the caller explicitly marks work as background-batch eligible.

The router also returns route-specific output-token caps. It never bypasses runtime capability binding, Core Policy, Approval, privacy, idempotency or provider readback.

## Rollout boundary

v1 lands in advisory mode. It must not silently replace the production AG-01 model binding. Production enforcement requires separate exact-head validation, a canonical TOCA OS cost policy/budget binding, provider usage readback, PostgreSQL migration evidence and controlled rollout.

No billing mutation, campaign budget mutation, Meta/Instagram publication, provider activation or AG-01 recovery action is part of this change.
