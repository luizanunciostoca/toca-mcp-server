# TOCA OS Next Version — Master Tracker

Status: **ACTIVE COORDINATION**  
Round: 2026-08-20 02:32 America/Bahia

## Baseline

- `V1_BASE_SHA=abfb09b17e90c83790e803dcda091c8142c7407f`
- observed `main=cd99521c8842268c5e1fb9e5efe58f9f6680ddf0`
- V1: `PRODUCTION_VERIFIED`
- Next Version baseline rule: re-read live `main`; never use this recorded SHA blindly after the round.
- Commercial `ConversationRecord` / `MessageRecord` authority: **PR #22**.
- Intended WhatsApp owner: **PR #31**, after unique-behavior reconciliation from #25.

## Feature PR map — live round snapshot

| PR | Feature | Head observed | State | Migration | Current disposition |
| --- | --- | --- | --- | --- | --- |
| #14 | Creative Truth | `de3ec2f6f208efea9ce8fb1146c92abcfd9e8f7c` | `CI_VERIFIED` | none | mergeable, non-Draft; Quality `32335049796`, PG `32335049795` |
| #15 | Demand Intelligence | `ee7cb048b01e6859beb949b9d049f218b8e31f56` | `PROVIDER_VERIFIED` READ only | `022_meta_ads_geo_demand_intelligence.sql` | Quality `32333934188`, PG `32333934183`, provider READ `32333785052`; no write |
| #16 | Photo-to-Video | `c0b23b573bec4de42746de2915e92daa36532a7b` | `CI_VERIFIED` | none | stacked on #14; Quality `32335823551`; retarget/revalidate after #14 merge |
| #17 | Coordinator | `cb04de63e51da88ab68df2aa44cb814a797cb724` before this round | `CI_VERIFIED` historical exact head | none | control-plane artifacts are being refreshed in this round |
| #18 | Asset Intelligence | `1bfa2680b1d661d865c7901303bf3c3d75dc6235` | `CI_VERIFIED` | `022_asset_intelligence_content_supply.sql` | Quality `32334357073`, PG `32334357088`; blocked by `022` collision with #15 |
| #19 | Privacy / LGPD | `a63458971fc6971c97c7221da02c61b8bb085e21` | `CI_VERIFIED` | none | exact validator `32334687755`, integration Quality `32334417380`; canonical consent/suppression authority |
| #20 | Platform Hardening | `ccfde23ebe55b3fcf76b661fe1d9f9603e4cb494` | `IMPLEMENTED` | none | Quality `32334666158` green; Security `32334666190` red at container scan + dependency review |
| #21 | AG-01 runtime | `20d55bf0de8368378380dcb3b3ba65b460b26b0e` | `CI_VERIFIED`, merge hold | `026_ag01_orchestrator_runtime.sql` | Quality `32335887999`, PG `32335888008`; forbidden repair workflow remains; depends #20/#22/#26 |
| #22 | CRM / Sales / Conversation / Message | `8fa24ba0e5dfb3708f77dab1596d609d37d10755` | `CI_VERIFIED`, merge hold | `023_crm_sales_engine.sql` | Quality `32336063124`, PG `32336063161`; forbidden one-shot workflow remains; canonical message owner |
| #23 | Email / SendGrid | `5aa954c82912cb48e022575e64b0ec7aa6d9443f` | `IMPLEMENTED` | `024_email_provider_runtime.sql` | PG `32335836596` green; Email Gate `32335836602` red only at stacked repo typecheck; stale parent; external provider config missing |
| #24 | Social Engagement → CRM | `dedcf3d78786ab35c5b0fdb25e76f15bdbb8497b` | `CI_VERIFIED` | none | Quality `32334785013`, PG `32334784974`; activation waits #19/#22 |
| #25 | WhatsApp duplicate candidate | `d36fde463f89f9ad49fcf1858097501ed7815674` | `CI_VERIFIED` but architecture hold | `024_crm_communication_records.sql` | defines duplicate Conversation/Message model; compare unique behavior then supersede in favor of #31 |
| #26 | R31 / Learning / Experimentation | `0e58fd3f109c31986d0ef854f88bfa02ecf01c16` | `IMPLEMENTED` | `025_marketing_autopilot_r31_learning.sql` | PG `32336012300` green; Quality `32336012297` fails Format |
| #27 | Analytics / Capacity | `9639cc8056d62551ceb298488eabefd213cfa11d` | `IMPLEMENTED` | none | base PG `32336060639` green; Quality `32336060637` fails Format; dedicated analytics PG `32336060638` fails functional test |
| #28 | Paid Media / Google Ads | `579e6e402e860c20ce428277c836f5ae9488a857` | `IMPLEMENTED` snapshot | none | mergeable false at readback; Quality `32336319196` and PG `32336319232` were still in progress; provider evidence pending |
| #29 | Human Control Center | `6976825a18b5cc1179ef8e73d72e135705508030` | `CI_VERIFIED` | none | Quality `32335977430`; same MCP server; dependency panels fail closed |
| #30 | Multi-tenant foundation | `7677495c0d54c63354645c78ee86a0d502ced924` | `IMPLEMENTED` | `027_multi_tenant_foundation.sql` | PG `32336071284` green; Quality `32336071267` fails Format; `027` collision with #31 |
| #31 | WhatsApp intended owner | `5eee722e2589b746786906fd3bd9eebc1032295a` | `IMPLEMENTED` | `027_whatsapp_provider_runtime.sql` | PG `32336105114` green; Quality `32336105089` fails Format; temp workflow + stale #22 stack + `027` collision + provider blocker |

All evidence belongs only to the exact listed head. A later commit invalidates merge-readiness evidence until fresh gates pass.

## Canonical ownership decisions

### CRM Conversation / Message

PR #22 owns commercial `ConversationRecord` / `MessageRecord`, their persistence and sales-engine integration. Channel/provider PRs may persist transport sidecars keyed to canonical CRM IDs, but must not define a second commercial Conversation/Message ledger.

This makes PR #25 unsuitable as the canonical WhatsApp merge source in its current form because `src/crm/communication-records.ts` introduces overlapping Conversation/Message records.

### WhatsApp

PR #31 is the intended WhatsApp owner because it is stacked on #22 and its provider-specific persistence is a transport sidecar referencing canonical CRM IDs. PR #25 is a **superseded candidate**, not yet disposable: compare and preserve any unique provider/webhook/throttle/retry behavior before closing it or removing its branch from consideration.

## Current dependency graph

- #16 → #14.
- #18 → #14 logically for live Creative Truth readback.
- #21 → #20 + #22 + #26 integration boundaries.
- #23 → #22 + #19.
- #24 activation → #22 + #19.
- #26 consumes evidence contracts from #14/#15/#18 and integrates with #21; these are enrichment/integration dependencies, not permission to copy code.
- #27 consumes #15 Demand input, #22 CRM sources and #20 observability contracts.
- #28 consumes #15 Demand and attribution/revenue inputs; Google Ads provider promotion remains separate.
- #29 panels consume #15/#22/#20/#26 when executable.
- #30 reuses #22/#21/#14/#18 domains and must preserve same-tenant boundaries without cloning them.
- #31 → #22 + #19; provider verification additionally requires real WhatsApp scopes/WABA/phone binding/readback.

## Migration inventory and collision control

Observed `main` still ends at `021_r29_video_artifacts.sql`.

Current branch reservations:

| Number | PR | File | Coordination state |
| --- | --- | --- | --- |
| 022 | #15 | `022_meta_ads_geo_demand_intelligence.sql` | canonical current owner for next migration |
| 022 | #18 | `022_asset_intelligence_content_supply.sql` | **collision; must renumber before merge** |
| 023 | #22 | `023_crm_sales_engine.sql` | reserved by canonical CRM workstream |
| 024 | #23 | `024_email_provider_runtime.sql` | stacked Email reservation |
| 024 | #25 | `024_crm_communication_records.sql` | duplicate-domain collision; #25 is superseded candidate |
| 025 | #26 | `025_marketing_autopilot_r31_learning.sql` | current reservation |
| 026 | #21 | `026_ag01_orchestrator_runtime.sql` | current reservation |
| 027 | #30 | `027_multi_tenant_foundation.sql` | current reservation |
| 027 | #31 | `027_whatsapp_provider_runtime.sql` | **collision; must reserialize** |

Do not renumber blindly while the merge queue is moving. Immediately before each migration-bearing PR enters integration, re-read live `main` plus all earlier queued migrations and assign a monotonically correct number. A renumber is a material commit and requires fresh exact-head Quality + PostgreSQL E2E.

## Temporary / one-shot workflow blockers

The following current PR diffs violate the final-tree rule:

- #21: `.github/workflows/ag01-type-repair.yml` — `contents: write`, source mutation, commit/push.
- #22: `.github/workflows/crm-sales-catalog-one-shot.yml` — `contents: write`, source/test mutation, commit/push.
- #31: `.github/workflows/format-whatsapp-stack-once.yml` — branch-formatting helper.

They must be removed before a merge-ready head is claimed. Historical green runs obtained while those files are present do not prove final-tree hygiene.

PR #23 current file list contains only its permanent `email-provider-gate.yml`; the earlier branch formatting helper is no longer in the current diff.

## Shared-hotspot conflict matrix

High-risk hotspots currently include:

- #15: `src/server.ts`, `src/registry.ts`, `src/mcp/runtime-capability-resolver.ts`, `scripts/architecture-check.mjs`.
- #22: `src/server.ts`, `src/registry.ts`, `src/mcp/runtime-capability-resolver.ts`, `src/mcp/core-execution.ts`, `quality.yml`.
- #29: `src/server.ts` integration wiring.
- #25: `src/http-server.ts` plus CRM/provider overlap; do not merge as canonical source.
- #14/#16: parent-child overlap in Creative Truth registry and package/runtime behavior; preserve stack lineage.

Any PR touching these after an earlier merge must recompute the diff against the new `main` and isolate integration commits where possible.

## Recommended governed merge order — current round

No automatic merge is authorized. The queue is dependency-based, not simply PR-number order:

1. **#17 coordinator control plane** after this refreshed exact head is green.
2. **#19 Privacy** — transversal prerequisite for outbound communication.
3. **#14 Creative Truth** — current exact head is CI green.
4. **#15 Demand Intelligence** — provider-verified READ boundary, migration 022.
5. **#20 Platform Hardening** only after Security Supply Chain is fully green.
6. **#22 CRM/Sales** only after removing the one-shot workflow and revalidating its clean exact head; migration 023.
7. **#16 Photo-to-Video** after #14 is merged, retargeted/rebased to resulting main and exact-head Quality reruns.
8. **#23 Email** after #19/#22, restacked on the final #22 head and full repository gates rerun; provider promotion remains separately blocked.
9. **#24 Social Engagement** after #19/#22, refreshed onto resulting main and activation wiring remains canonical.
10. **#26 R31/Learning** after Format is fixed and the exact final head is green; integration with evidence producers remains reference-based.
11. **#21 AG-01** after #20/#22/#26, repair workflow removal and fresh exact-head gates.
12. **#27 Analytics/Capacity** after Format plus its dedicated PostgreSQL functional failure are fixed and dependencies are refreshed.
13. **#28 Paid Media** after its current head gates complete green and attribution/provider prerequisites are respected.
14. **#29 Human Control Center** after dependency cards are reconciled against the then-current Core; rerun if `main` changed.
15. **#18 Asset Intelligence** only after resolving migration numbering and reconciling #14; exact-head gates must rerun after renumber.
16. **#30 Multi-tenant foundation** after global migration serialization and dependency integration; current head is format-red.
17. **#31 WhatsApp** after preserving unique #25 behavior, cleaning #31, refreshing on final #22/#19, migration serialization and provider prerequisites.
18. Dependabot #1–#6 remain a separate maintenance lane.

This order must be recomputed after every merge or material head change. A feature can move earlier only if all hard dependencies, migration order, hotspot conflicts and exact-head evidence permit it.

## Current blockers

- #14: no current CI blocker; revalidate after `main` changes.
- #15: no current CI/provider-READ blocker; `PRODUCTION_VERIFIED` still requires deployment/readback after merge.
- #16: parent #14 must merge first; then retarget/revalidate.
- #18: migration `022` collision with #15.
- #20: Security Supply Chain failure at candidate-container scan and dependency review.
- #21: forbidden repair workflow + #20/#22/#26 integration dependencies.
- #22: forbidden one-shot workflow despite green Quality/PG.
- #23: stale parent #22; stacked repository typecheck failure; external SendGrid configuration absent.
- #24: activation dependencies #19/#22.
- #25: duplicate WhatsApp/CRM model; candidate superseded after preservation review.
- #26: Quality Format failure.
- #27: Quality Format failure plus dedicated analytics PostgreSQL E2E functional failure.
- #28: live head was mergeable false and its newest Quality/PG runs were still in progress at snapshot.
- #30: Quality Format failure and `027` migration collision.
- #31: Quality Format failure, temp workflow, stale stack, `027` collision and external provider prerequisites.
- Drive security: canonical master manual still records `anyone with link — reader` on the TOCA_OS root / `00_COMECE_AQUI`; this remains a security-governance item.

## Parallel-start lanes

Safe parallel work remains limited to non-conflicting boundaries:

- conversion/ticketing/checkout evidence contracts;
- capability/data-governance reconciliation;
- read-only attribution/revenue adapters that reuse existing Measurement/CRM roots;
- observability/DR tests that extend #20 rather than introducing another observability plane;
- provider configuration/evidence preparation for Email/WhatsApp without sending anything solely for testing;
- reconciliation tests between #22 canonical messages and downstream Email/WhatsApp/Social consumers.

Do **not** start another CRM, Conversation/Message model, WhatsApp provider branch, Email provider branch, scheduler, Policy Engine, Approval Engine or parallel persistence authority.

## Per-round coordinator checklist

1. Re-read `main` SHA.
2. List open PRs and exact current heads.
3. Recompute intended base / stack relationships.
4. Recompute file and migration overlap.
5. Reject stale/superseded branches as merge sources.
6. Inspect final-tree workflows, not only CI conclusions.
7. Verify exact-head Quality/PG/provider evidence.
8. Update Feature Registry and Evidence Index.
9. Publish PR map, dependencies, merge order, blockers, parallel starts and conflict risks.
10. Do not merge automatically.
