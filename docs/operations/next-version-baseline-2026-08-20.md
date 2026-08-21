# TOCA OS Next — Final Convergence Baseline — 2026-08-20

This document is a coordination snapshot, not provider, staging, production, or closeout evidence.

## Live baseline

- Revalidated `main`: `ec8a8e6a2eed9eba1181bc2c32fbcc8fed93845d`.
- Latest integrated platform replacement: PR #55, exact head `c3791176195edd392890fa02dbd93209b7bc785e`.
- PR #42 is historical and superseded by #55; do not merge it.
- PR #17 is historical coordination material and must not be merged as-is.
- Candidate SHA is **not frozen**.
- Staging, provider, production and final-closeout promotion are **not authorized by this snapshot**.

## Integrated ownership

The final integration must continue to reuse the existing authorities already present on `main`:

- one MCP/Core and one runtime registry;
- canonical CRM `ContactRecord`, `ConversationRecord`, `MessageRecord` and Sales stores;
- canonical Privacy governance;
- canonical Policy and Approval engines/stores;
- canonical Workflow/Scheduler;
- canonical AG-01 runtime;
- canonical Attribution/Revenue boundary;
- existing Email, WhatsApp, Meta and Google Ads provider implementations;
- existing Audit, Transactional Outbox and EventRecord paths.

No convergence fix may introduce a parallel authority for any of these domains.

## Shared hotspots

Every integration candidate that touches any item below requires semantic comparison against live `main`, not a blind rebase/merge:

- `src/server.ts`
- `src/http.ts`
- `src/registry.ts`
- `src/config.ts`
- `src/mcp/`
- `migrations/`
- governance/capability catalog/runtime contracts

## Migration baseline

Current Next migrations on `main` include:

- `022_meta_ads_geo_demand_intelligence.sql`
- `023_crm_sales_engine.sql`
- `024_email_provider_runtime.sql`
- `025_marketing_autopilot_r31_learning.sql`
- `026_ag01_orchestrator_runtime.sql`
- `028_attribution_revenue_feedback.sql`
- `029_asset_intelligence_content_supply.sql`
- `030_whatsapp_provider_runtime.sql`
- `031_multi_tenant_foundation.sql`
- `032_tenant_scoped_approvals.sql`

The missing numeric slot `027` is not a runtime migration gap. The migrator sorts `.sql` filenames and records the exact filename in `schema_migrations`. Renaming already merged migrations would cause the renamed file to appear unapplied. Therefore existing 028–032 filenames are frozen; assign any future migration only after re-reading live `main`.

## Exact-head source evidence for current platform replacement

PR #55 exact head `c3791176195edd392890fa02dbd93209b7bc785e`:

- Quality Gate: SUCCESS.
- Security Supply Chain: SUCCESS.
- Email Provider Gate: SUCCESS.
- M-FOUND-12 PostgreSQL E2E: not triggered by #55 because its permanent path filter does not include the readiness/HTTP/policy-only file set changed by #55.

The absence of a #55 PostgreSQL run must not be rewritten as PASS. Database/domain integration has prior PostgreSQL evidence; fresh migration/schema acceptance is still required in isolated staging before promotion.

## Canonical Drive reconciliation

The current TOCA_OS capability catalog contains the R28 Google Ads family, including customer discovery, account verification/inspection, campaigns, insights, prepare, targeting validation, create-paused, readback and manage operations. The R28 routing registry is provider-neutral for Meta Ads + Google Ads.

This resolves the historical Google Ads catalog/routing drift recorded by the old #46 text. It does **not** constitute Google Ads provider evidence. Current provider/production lifecycle states remain unpromoted.

A separate Omnichannel drift remains: the code manifest defines operational `whatsapp.*` and `email.*` capability IDs, but the current TOCA_OS CAPABILITIES sheet has no matching operational rows. Searches for WhatsApp/Email currently resolve only copy-generation capabilities. Because TOCA_OS is the canonical business catalog, Front B must reconcile the intended operational channel capability surface with Drive while it completes runtime composition.

For nurture, the reconciliation result is different: TOCA_OS already contains `sales.followup.create` and `sales.followup.schedule` in R10 as `IMPLEMENTED` DB-bound authorities. Therefore `nurture.sequence.*` must not be promoted into a parallel public capability family by default. Durable nurture should first be composed over those existing follow-up authorities plus the existing Workflow/Scheduler/NextAction state; only a genuinely uncovered semantic contract could justify an additional canonical ID.

## Active convergence blockers

### A — Provider Onboarding + Google Ads

The Google Ads API client supports `listAccessibleCustomers()` without customer ID, but canonical `src/config.ts`/`src/server.ts` still require customer-bound configuration before constructing the verifier used by `google_ads.customers.discover`. Credential-first discovery is therefore not yet reachable through the normal runtime composition.

Separately, controlled `google_ads.campaign.create_paused` remains intentionally non-executable through normal Core while its binding has not been side-effect validated and formal approval requests require a production-validated capability. Do not resolve this bootstrap by prematurely promoting lifecycle state.

Live Secret Manager/IAM/provider evidence and real Google Ads provider read/write/readback evidence are still absent.

### B — Omnichannel Outbound + Nurture

Email and WhatsApp provider engines exist and contain strong pre-send Privacy/readback/retry/idempotency behavior. However the current omnichannel capability manifest still marks WhatsApp, Email and Nurture capabilities `SPECIFIED`, `runtimeExposed=false`, and `productionExecutionAllowed=false`.

The remaining work is composition/exposure through the canonical AG-01/Workflow/Core path. WhatsApp/Email operational capability IDs must be reconciled to TOCA_OS. Durable nurture must reuse `sales.followup.create`, `sales.followup.schedule`, `NextActionRecord`, Workflow and Scheduler rather than introducing a second sequence engine. No second Omnichannel or scheduler is permitted.

### C — Platform Readiness

Source-level fail-closed staging isolation is implemented in #55. It requires dedicated/non-production project identity, Cloud SQL, database secret, Cloud Run services, runtime identities, deploy identity and WIF, and supports provider-disabled or isolated staging modes.

Actual GitHub Environment/GCP values have not yet been proven by this coordination snapshot, so staging is not verified.

### D — Governance / Closeout prep

This branch replaces obsolete #17 coordination content with live-state artifacts only. Google Ads catalog drift is reconciled; operational Omnichannel channel catalog drift is not. Nurture has existing canonical R10 follow-up authorities and should converge on them. Final closeout remains prohibited until runtime/catalog convergence plus production and reliability evidence exist.

## Freeze rule

Do not freeze a candidate SHA while A or B has unresolved code-composition or canonical-catalog blockers. After both converge and exact-head CI is green, re-read `main`, verify migration sequence and shared hotspots, then freeze exactly one candidate SHA for staging.
