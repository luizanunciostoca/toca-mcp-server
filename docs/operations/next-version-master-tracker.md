# TOCA OS Next Version — Master Tracker

Status: **ACTIVE COORDINATION / CHAT 16 RELEASE READBACK**
Round: 2026-08-20 16:30 America/Bahia

## Baseline and invariants

- `V1_BASE_SHA=abfb09b17e90c83790e803dcda091c8142c7407f`; V1 remains `PRODUCTION_VERIFIED`.
- Live `main=cd99521c8842268c5e1fb9e5efe58f9f6680ddf0` is the only Next Version baseline.
- PR #22 is the sole commercial `ConversationRecord` / `MessageRecord` authority.
- PR #36 is the sole WhatsApp merge source; #31 is closed unmerged/superseded.
- No automatic merge is authorized. No provider write/send/activation/payment is authorized as a validation technique.
- No second MCP, CRM, scheduler, workflow store, approval/policy engine, attribution system, or persistence authority may be introduced.

## Live PR map

| PR  | Head                                       | Base / state                 | Evidence and gates                                                                               | Migration / disposition                                                              |
| --- | ------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| #14 | `de3ec2f6f208efea9ce8fb1146c92abcfd9e8f7c` | main / non-Draft / clean     | CI, Quality `32335049796`, PG `32335049795` PASS                                                 | no migration; parent of #16                                                          |
| #15 | `ee7cb048b01e6859beb949b9d049f218b8e31f56` | main / non-Draft / clean     | Provider READ `32333785052`, Quality `32333934188`, PG `32333934183` PASS; `writeExecuted=false` | `022_meta_ads_geo_demand_intelligence.sql`; `PROVIDER_VERIFIED` READ-only            |
| #16 | `c0b23b573bec4de42746de2915e92daa36532a7b` | base #14 / non-Draft / clean | Quality `32335823551` PASS                                                                       | stacked child; retarget/revalidate after #14 merge                                   |
| #17 | `b84cce9e20e06638801100973776ecc1cbeab7df` | main / Draft / clean         | Quality `32337525360` PASS                                                                       | coordinator docs only; no auto-merge                                                 |
| #18 | `e475a95498bd71f76c483e305e2c4c8fccdd76c5` | main / non-Draft / clean     | Quality `32342689685`, PG `32342689677` PASS                                                     | `029_asset_intelligence_content_supply.sql`; renumbered and revalidated              |
| #19 | `a63458971fc6971c97c7221da02c61b8bb085e21` | main / non-Draft / clean     | Quality `32334417380` PASS                                                                       | Privacy authority; no migration                                                      |
| #20 | `0da69a1e2dc261938e1c7d67e9367be0bd5a7dc4` | main / non-Draft / clean     | Quality `32342129929`, Security `32342129938` PASS                                               | security prerequisite cleared                                                        |
| #21 | `e741198f2050f70bde7707fb9c13a1250c613e96` | main / Draft / clean         | Quality `32337705724`, PG `32337705682` PASS                                                     | `026_ag01_orchestrator_runtime.sql`; depends on #20/#22/#26 integration              |
| #22 | `be97c0a6249876ff306a67158ae35e94c217bd6d` | main / non-Draft / clean     | Quality `32336854798`, PG `32336854963` PASS                                                     | `023_crm_sales_engine.sql`; canonical CRM owner                                      |
| #23 | `036bbec4aff0f77eede4ae36fb347b12967b0ada` | base #22 / Draft / clean     | Quality `32337132353`, Email `32337132201`, PG `32337132190` PASS                                | `024_email_provider_runtime.sql`; external SendGrid evidence pending                 |
| #24 | `dedcf3d78786ab35c5b0fdb25e76f15bdbb8497b` | main / Draft / clean         | Quality `32334785013`, PG `32334784974` PASS                                                     | reuses #19/#22; no parallel CRM ledger                                               |
| #26 | `7675bd734d0c11bdff8357656b9b0a1a6253a8b7` | main / Draft / clean         | Quality `32336459217`, PG `32336459216` PASS                                                     | `025_marketing_autopilot_r31_learning.sql`; recommendation-only                      |
| #27 | `9aa2d62dca218dee41ad1aff69904a7944c03cae` | main / Draft / clean         | Quality `32343861166`, canonical PG `32343861116`, Analytics PG `32343861120` PASS               | CI-verified; no format blocker remains                                               |
| #28 | `f900c125e5aee65057dbf2048ce5bb13b847a2d8` | main / non-Draft / clean     | Quality `32337044377`, PG `32337044338` PASS                                                     | provider READ/config pending; no activation                                          |
| #29 | `6976825a18b5cc1179ef8e73d72e135705508030` | main / non-Draft / clean     | Quality `32335977430` PASS                                                                       | same MCP/Core; UI emits governed AG-01 intents                                       |
| #30 | `2fce39b05f99185a3db0763be82097b272561b35` | main / Draft / clean         | Quality `32336878038`, canonical PG `32336878082`, Tenancy PG `32336878062` PASS                 | `027_multi_tenant_foundation.sql`; no collision after #36→030                        |
| #33 | `7e8df19ae23da2193ddb6e4e64d127b86b49729a` | main / Draft / clean         | Quality `32336942395`, PG `32336942409` PASS                                                     | `028_attribution_revenue_feedback.sql`; provider-shaped fixtures only                |
| #36 | `efe2e2f818454a0974e4caf0a03ec5d4ca9e5942` | base #22 / Draft / clean     | Quality `32343377890`, PG `32343377877` PASS                                                     | `030_whatsapp_provider_runtime.sql`; sole WhatsApp source, provider evidence pending |

## Closed/superseded/temp lanes

PR #25 is obsolete duplicate CRM communication and closed unmerged. PR #31 is superseded by #36 and closed unmerged. PRs #32 and #34 are Email synchronization-only and #35 is a test-only hardening runner; none is a merge source.

## Migration serialization

The live main ends at 021. The final proposed monotonic integration queue is: `022 #15`, `023 #22`, `024 #23`, `025 #26`, `026 #21`, `027 #30`, `028 #33`, `029 #18`, `030 #36`. #14/#16/#19/#20/#24/#27/#28/#29/#17 have no migration. All renumbered branches (#18 and #36) have fresh exact-head Quality/PG evidence.

## Real conflict map and semantic resolution

- #15 vs #18: workflow content conflict only; migration was renumbered and the permanent PostgreSQL workflow must union both trigger/test paths.
- #26 vs #21: workflow content conflict only; integrate #26 first, then retarget/rebase #21 and union the permanent R31/AG-01 paths.
- #33 vs #26: permanent PostgreSQL workflow plus `postgres-internal-audit-ledger.ts`; retain #33’s typed `core.measurement` wrapper and #26’s learning record types/error-prefix behavior through one shared hash-chained ledger, not two ledgers.
- #14→#16, #22→#23 and #22→#36 are intended stacks; retarget/rebase children after parent merge and rerun exact-head gates.
- Hotspots `src/server.ts`, `src/registry.ts` and `src/mcp/runtime-capability-resolver.ts` are composition/registration layers. #22/#23/#36 share the canonical CRM stack; #15 and #28 add distinct typed paid-media capabilities; #29 adds the governed UI surface. No parallel authority was detected.

## Recommended no-auto-merge order

1. #17 coordinator docs refresh, after its Quality gate.
2. #19 Privacy; #14 Creative Truth; #15 Demand (`022`).
3. #20 Security, now green; then refresh/revalidate #22 CRM (`023`).
4. Retarget/revalidate #16 after #14; then #23 Email (`024`) after #19/#22.
5. #33 Attribution (`028`); #26 Learning (`025`) and #21 AG-01 (`026`) after their predecessor integration is refreshed.
6. #24 Social Engagement; #27 Analytics; #28 Paid Media; #29 Human Control Center.
7. #30 Multi-Tenant (`027`); #18 Asset Intelligence (`029`); #36 WhatsApp (`030`) after #22/#19 and fresh exact-head gates.

Recompute after each merge/rebase/retarget or migration change.
