# TOCA OS Human Control Center

Status: **IMPLEMENTED — CI / provider evidence pending on this branch**

Baseline used for this implementation:

- repository: `luizanunciostoca/toca-mcp-server`;
- canonical `main` revalidated before branch creation: `cd99521c8842268c5e1fb9e5efe58f9f6680ddf0`;
- V1 deployed/production-verified release remains `abfb09b17e90c83790e803dcda091c8142c7407f`;
- feature branch: `feat/human-control-center-next-20260820`.

This document does not alter the V1 classification. The Control Center is post-V1 scope and must earn its own evidence states.

## Architecture

The Control Center preserves the canonical TOCA OS path:

`USER -> CHATGPT / AG-01 -> TOCA_OS / GOOGLE DRIVE -> ROUTE_ID -> AGENT(S) -> SOP / TEMPLATE -> QUALITY GATE -> APPROVAL / POLICY GATE -> TOCA MCP CORE -> PROVIDER -> READBACK -> AUDIT / OUTBOX / EVENT RECORD -> LEARNING`

The implementation is an MCP App resource (`ui://toca/human-control-center-v1.html`) registered on the **same** `McpServer` instance as the existing TOCA Core. It does not introduce a second HTTP service, MCP, CRM, scheduler, approval engine, policy engine, database, provider transport, outbox, or audit ledger.

The app view is read-only with respect to business state. It may call existing Core tools and executable Core capabilities. It never calls a provider endpoint directly.

## Human action boundary

The UI renders these human actions:

- `APPROVE`;
- `REJECT`;
- `PAUSE`;
- `RESUME`;
- `ESCALATE`.

A click does **not** mutate a provider, ApprovalRecord, workflow, CRM record, or scheduler row from the iframe. The view emits an `AG01_INTENT_ONLY` message carrying:

- action;
- target kind;
- target identifier when known;
- deterministic intent idempotency key;
- context;
- the mandatory governed execution path.

AG-01 must then resolve the canonical route/capability and execute it through the existing Core. A future action adapter may only become directly invokable from the UI after the corresponding canonical capability has a typed schema, identity/authorization contract, policy/risk evaluation, formal approval where required, idempotency, provider readback where applicable, and audit/outbox/event evidence.

This is intentional: creating a second admin mutation API merely to make buttons work would violate the Core boundary.

## Panel matrix

| Panel | Current source | State rule |
| --- | --- | --- |
| Pending approvals | `toca.approval.get` + future tenant-safe list | Partial until canonical list exists |
| Prepared campaigns | governed Meta/Google campaign READ/PREPARE capabilities | Dynamic |
| Publications | `instagram.toca_schedule.list`, `instagram.media.list` | Dynamic |
| Pipeline | advanced CRM/Sales | Dependency on PR #22 + Core READ exposure |
| Critical leads | advanced CRM/Sales scoring | Dependency on PR #22 + Core READ exposure |
| Next actions | advanced CRM/Sales next-action records | Dependency on PR #22 + Core READ exposure |
| Provider health | `toca.system.health` + provider READ probes | Dynamic |
| Dead letters | existing managed scheduler list/state | Dynamic; no second DLQ |
| Demand Index | `meta_ads.opportunity.detect`, `meta_ads.audience.inspect` | Dependency on PR #15 until merged |
| Budget recommendations | `meta_ads.budget.recommend` | Dependency on PR #15 until merged |
| Experiments | future canonical experiment list/read | Dependency pending |
| Incidents | typed observability/incident source | Dependency on PR #20 + Core READ exposure |
| SLO status | typed SLO catalog | Dependency on PR #20 + Core READ exposure |

A panel is `READY` only when every declared source is actually present in the Core tool surface or in both the capability registry and runtime resolver. A registry/catalog declaration without a runtime binding is not considered available.

## Pending approvals safety blocker

Current `main` exposes `toca.approval.get`, but it does not expose a tenant-safe `toca.approval.list`. The persisted ApprovalRecord schema currently has no tenant column suitable for safely broadening that read boundary.

Therefore this branch does **not** add a direct SQL query from the UI or a hidden admin endpoint. The panel reports the missing list capability explicitly and remains partial. A future canonical approval-list capability should be implemented only with an approved tenant-bound storage/read contract and normal Core authorization.

## Demand Intelligence dependency

PR #15 owns the recovered Meta Ads Demand Intelligence implementation and must remain the source of truth for:

- `meta_ads.audience.inspect`;
- `meta_ads.opportunity.detect`;
- `meta_ads.budget.recommend`.

This branch does not copy that implementation. It merely detects those capability IDs dynamically and consumes them when they are present in registry + runtime.

The Control Center preserves the Demand Intelligence semantic boundary: Meta delivery estimates are modeled aggregate MAU estimates, not exact counts of people, phones, or devices physically present in Morro de São Paulo. Budget recommendation is a READ operation and does not perform a provider write.

## CRM dependency

PR #22 owns the advanced CRM/Sales implementation for pipeline, critical leads and next actions. This branch intentionally does not add a second CRM model or store. Those cards remain dependency-pending until canonical governed Core READ capabilities are exposed from that domain.

## Incident / SLO dependency

PR #20 owns platform hardening and the typed SLO/incident contracts. The Control Center does not read those implementation files or infrastructure JSON directly. Cards remain dependency-pending until the data is exposed through a governed Core READ capability.

## Provider health

Provider health uses only bounded READs through the Core:

- `toca.system.health`;
- `meta_ads.accounts.list` when available;
- `instagram.media.list` when available.

No synthetic campaign, publication, payment, message, or other business side effect is executed to make a health card green.

## MCP App boundary

The embedded resource uses the MCP Apps postMessage lifecycle and calls host tools through `tools/call`. It does not embed provider credentials, account secrets, access tokens, or a custom authorization mechanism.

The same MCP authentication context and Core authorization therefore remain authoritative. The view also refuses to infer an advertising currency: a Meta account READ must return both account ID and currency before account-bound campaign/demand reads are attempted.

## Shared hotspots

Before implementation, parallel PRs were reviewed. PR #15 modifies:

- `src/server.ts`;
- `src/registry.ts`;
- `src/mcp/runtime-capability-resolver.ts`;
- `scripts/architecture-check.mjs`.

This Control Center does **not** modify registry/runtime resolver/architecture-check/package metadata. The only shared hotspot touched is `src/server.ts`, isolated as integration wiring so the same Core stores can be reused. If PR #15 merges first, this branch must be rebased and the small server wiring reapplied without overwriting Demand Intelligence construction.

## Migrations

None.

No parallel persistence has been added, so this branch does not create a new PostgreSQL migration.

## Evidence-state rules

The branch starts at `IMPLEMENTED` only.

Promotion rules:

- `CI_VERIFIED`: exact branch head passes format, architecture, lint, typecheck, unit tests, and build;
- `PROVIDER_VERIFIED`: only if real provider READ evidence is captured for the exact applicable read boundary without business writes;
- `PRODUCTION_VERIFIED`: only after merge/deploy and production readback of the exact deployed revision/resource, with no synthetic business side effect used solely for validation.

No lower evidence state implies a higher one.
