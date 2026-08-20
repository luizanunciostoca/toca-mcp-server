# TOCA OS Next Version — Master Tracker

Status: **ACTIVE COORDINATION**  
Round: 2026-08-20 03:40 America/Bahia

## Baseline

- `V1_BASE_SHA=abfb09b17e90c83790e803dcda091c8142c7407f`
- observed `main=cd99521c8842268c5e1fb9e5efe58f9f6680ddf0`
- V1 remains `PRODUCTION_VERIFIED`.
- Live `main` is the dynamic Next Version baseline; re-read it before any merge/rebase/renumber decision.
- PR #22 is the sole commercial `ConversationRecord` / `MessageRecord` authority.
- PR #36 is the sole converged WhatsApp merge source; PR #31 is closed unmerged and superseded; #25 remains closed unmerged and superseded.
- PR #33 is the canonical Attribution + Revenue Intelligence workstream.

## Live PR map

| PR  | Feature                              | Exact current/observed head                | Evidence state                 | Migration                                               | Disposition                                                                                                   |
| --- | ------------------------------------ | ------------------------------------------ | ------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| #14 | Creative Truth                       | `de3ec2f6f208efea9ce8fb1146c92abcfd9e8f7c` | `CI_VERIFIED`                  | none                                                    | Quality `32335049796`, PG `32335049795`; mergeable/non-Draft                                                  |
| #15 | Demand Intelligence                  | `ee7cb048b01e6859beb949b9d049f218b8e31f56` | `PROVIDER_VERIFIED` READ only  | `022_meta_ads_geo_demand_intelligence.sql`              | Quality `32333934188`, PG `32333934183`, provider READ `32333785052`; `writeExecuted=false`                   |
| #16 | Photo-to-Video                       | `c0b23b573bec4de42746de2915e92daa36532a7b` | `CI_VERIFIED`                  | none                                                    | stacked on #14; retarget/revalidate after #14 merges                                                          |
| #17 | Coordinator                          | branch moves only for control-plane docs   | exact-head CI required         | none                                                    | no runtime/provider change; no auto-merge                                                                     |
| #18 | Asset Intelligence                   | `1bfa2680b1d661d865c7901303bf3c3d75dc6235` | `CI_VERIFIED`                  | conflicting `022_asset_intelligence_content_supply.sql` | blocked by #15 `022`; renumber then rerun Quality+PG                                                          |
| #19 | Privacy / LGPD                       | `a63458971fc6971c97c7221da02c61b8bb085e21` | `CI_VERIFIED`                  | none                                                    | canonical transversal consent/suppression authority                                                           |
| #20 | Platform Hardening                   | `ccfde23ebe55b3fcf76b661fe1d9f9603e4cb494` | `IMPLEMENTED`                  | none                                                    | Quality `32334666158` green; Security `32334666190` red at container scan + dependency review                 |
| #21 | AG-01 runtime                        | `e741198f2050f70bde7707fb9c13a1250c613e96` | `CI_VERIFIED`                  | `026_ag01_orchestrator_runtime.sql`                     | Quality `32337705724`, PG `32337705682`; waits #20/#22/#26 integration                                        |
| #22 | CRM / Sales / Conversation / Message | `be97c0a6249876ff306a67158ae35e94c217bd6d` | `CI_VERIFIED`                  | `023_crm_sales_engine.sql`                              | Quality `32336854798`, PG `32336854963`; temp workflows removed; canonical message owner                      |
| #23 | Email / SendGrid                     | `036bbec4aff0f77eede4ae36fb347b12967b0ada` | `CI_VERIFIED provider-pending` | `024_email_provider_runtime.sql`                        | Quality `32337132353`, PG `32337132190`, Email Gate `32337132201` PASS; provider config/evidence still absent |
| #24 | Social Engagement → CRM              | `dedcf3d78786ab35c5b0fdb25e76f15bdbb8497b` | `CI_VERIFIED`                  | none                                                    | Quality `32334785013`, PG `32334784974`; activation waits #19/#22                                             |
| #25 | obsolete WhatsApp                    | `d36fde463f89f9ad49fcf1858097501ed7815674` | historical                     | obsolete `024_crm_communication_records.sql`            | **closed unmerged / superseded**; never a merge source                                                        |
| #26 | R31 / Learning                       | `7675bd734d0c11bdff8357656b9b0a1a6253a8b7` | `CI_VERIFIED`                  | `025_marketing_autopilot_r31_learning.sql`              | Quality `32336459217`, PG `32336459216`; final diff clean                                                     |
| #27 | Analytics / Capacity                 | `d77b0921cf8bb54f04921608d3b6f0d54ce6d8e3` | `IMPLEMENTED`                  | none                                                    | Quality `32337191793` fails Format; base PG `32337191835` and dedicated analytics PG `32337191832` pass       |
| #28 | Paid Media / Google Ads              | `f900c125e5aee65057dbf2048ce5bb13b847a2d8` | `CI_VERIFIED provider-pending` | none                                                    | Quality `32337044377` and PG `32337044338` PASS; Google Ads provider evidence pending                         |
| #29 | Human Control Center                 | `6976825a18b5cc1179ef8e73d72e135705508030` | `CI_VERIFIED`                  | none                                                    | Quality `32335977430`; same MCP server; governed intent only                                                  |
| #30 | Multi-tenant foundation              | `2fce39b05f99185a3db0763be82097b272561b35` | `CI_VERIFIED`                  | `027_multi_tenant_foundation.sql`                       | Quality `32336878038`, base PG `32336878082`, tenancy PG `32336878062`; collides with WhatsApp `027`          |
| #31 | WhatsApp candidate A                 | closed unmerged / superseded               | `CLOSED_UNMERGED`              | `027_whatsapp_provider_runtime.sql`                     | PR #31 was superseded; safe semantics were converged into sole source #36                                     |
| #32 | Email sync-only                      | closed                                     | n/a                            | none                                                    | **closed unmerged**, temporary sync only                                                                      |
| #33 | Attribution / Revenue                | `7e8df19ae23da2193ddb6e4e64d127b86b49729a` | `CI_VERIFIED`                  | `028_attribution_revenue_feedback.sql`                  | Quality `32336942395`, PG `32336942409`; canonical attribution/revenue workstream                             |
| #34 | Email rebase sync-only               | closed                                     | n/a                            | none                                                    | **closed unmerged**, temporary sync only                                                                      |
| #35 | Email hardening test-only            | closed                                     | n/a                            | none                                                    | **closed unmerged**, explicitly do not merge                                                                  |
| #36 | WhatsApp sole converged source       | `510d0202a9746ef53e42e10cdb3c8a5607000d73` | `CI_VERIFIED provider-pending` | `027_whatsapp_provider_runtime.sql`                     | Quality `32339737876`, PG `32339737890` PASS; migration 027 collision with #30; provider evidence pending     |

Evidence is exact-head scoped. A later commit invalidates merge-readiness evidence until fresh applicable gates pass.

## Ownership decisions

### Commercial Conversation / Message

PR #22 owns canonical CRM `ConversationRecord`, `MessageRecord`, `crm_conversations` and `crm_messages`. Email, WhatsApp, Social Engagement and AG-01 may reference these records. Provider-specific sidecar tables may store transport/readback state but must not become a second commercial message ledger.

PR #25 is closed unmerged because it violated that ownership by carrying an obsolete parallel communication model.

### WhatsApp convergence

PR #36 is now the sole converged WhatsApp merge source, stacked on canonical #22; PR #31 is closed unmerged and superseded.

Semantic comparison found useful behavior on both sides:

- preserve from #31 unless deliberately proven unnecessary: explicit runtime `AuditSink` writes, canonical recipient-to-Contact channel validation, CRM sales resolution with ambiguity handling, and sales activity append for human handoff;
- preserve from #36: provider media metadata readback and unmatched status workflow handoff;
- preserve from both: canonical CRM IDs, Privacy/Policy/Approval gate, durable throttle/retry/idempotency, 24h service-window rule, approved templates, callback readback, dead-letter/human handoff, existing Meta HMAC boundary and existing Outbox/Audit persistence.

After semantic convergence there must be exactly one WhatsApp merge source and one `027_whatsapp_provider_runtime.sql` lineage. Real provider promotion remains blocked on WABA/scopes/Phone Number ID/template/callback/readback evidence.

### Attribution / Revenue

PR #33 is the canonical Next Version attribution/revenue workstream. Revenue evidence is limited to provider-backed `TICKETING | CHECKOUT | PAYMENT | ORDER` evidence; clicks, DMs, UTMs and opportunity values do not establish realized revenue. PR #26 and #21 are downstream learning/orchestration consumers.

## Migration coordination

Observed live `main` still ends at `021_r29_video_artifacts.sql`.

| Number | PR      | Migration                                   | Coordination status                                                          |
| ------ | ------- | ------------------------------------------- | ---------------------------------------------------------------------------- |
| 022    | #15     | `022_meta_ads_geo_demand_intelligence.sql`  | current first owner in proposed queue                                        |
| 022    | #18     | `022_asset_intelligence_content_supply.sql` | **collision; must renumber after predecessor queue is fixed**                |
| 023    | #22     | `023_crm_sales_engine.sql`                  | canonical CRM reservation                                                    |
| 024    | #23     | `024_email_provider_runtime.sql`            | Email reservation; old #25 collision disappeared because #25 closed unmerged |
| 025    | #26     | `025_marketing_autopilot_r31_learning.sql`  | current reservation                                                          |
| 026    | #21     | `026_ag01_orchestrator_runtime.sql`         | current reservation                                                          |
| 027    | #30     | `027_multi_tenant_foundation.sql`           | **collision with WhatsApp**                                                  |
| 027    | #31/#36 | `027_whatsapp_provider_runtime.sql`         | **duplicate front + collision with #30**                                     |
| 028    | #33     | `028_attribution_revenue_feedback.sql`      | unique in snapshot, but depends on final predecessor serialization           |

Do not renumber by PR number or creation time. Immediately before integration: read live `main`, establish the approved predecessor queue, assign monotonic numbers, update all references and rerun exact-head Quality + PostgreSQL E2E after every renumber.

## Current dependency graph

- #16 → #14.
- #18 logically → #14 and must follow the final migration predecessor chain after #15.
- #23 → #22 + #19.
- #24 activation → #22 + #19.
- #33 → canonical CRM/Measurement foundation; strict Conversation/Message FK integration, if desired, follows #22.
- #26 consumes canonical evidence from #33 and optional #14/#15/#18 evidence producers.
- #21 → #20 + #22 + #26 for final governed learning handoff.
- #27 consumes #15 Demand, #22 CRM and #20 observability contracts.
- #28 consumes #15 Demand + #33 Attribution/Revenue + #27 Capacity when available.
- #29 consumes #15/#22/#20/#26 through governed Core reads.
- #30 reuses #22/#21/#14/#18 domain identities and must preserve tenant isolation without cloning them.
- WhatsApp #31/#36 → #22 + #19, plus provider credentials/scopes/readback for promotion.

## Current blockers

- **#18:** `022` migration collision with #15.
- **#20:** Security Supply Chain `32334666190` red; container scan + dependency review failed.
- **#21:** code/CI clean now; held on #20 plus final #22/#26 integration/revalidation.
- **#23:** current newer head requires exact-head gates; real SendGrid configuration/evidence absent.
- **#27:** Quality Format failure despite both PostgreSQL suites green.
- **#28:** Quality Format failure; Google Ads provider evidence absent.
- **#30:** `027` migration collision with WhatsApp lane.
- **#36:** sole converged WhatsApp source is CI/PG green; migration 027 collides with #30 and provider prerequisites remain absent. #31 is closed unmerged.
- **Drive security:** canonical manuals still record `anyone with link — reader` exposure on TOCA_OS root / `00_COMECE_AQUI`; remains a governance item.

## Recommended governed integration order

No automatic merge is authorized. Current dependency-oriented order:

1. #17 coordinator control plane after its refreshed exact head is green.
2. #19 Privacy.
3. #14 Creative Truth.
4. #15 Demand Intelligence (`022`).
5. #20 only after Security Supply Chain is green.
6. #22 CRM/Sales (`023`) after rebase/revalidation if #15 or another hotspot predecessor moves `main`.
7. #16 after #14 merges, retarget/rebase to resulting `main`, then fresh Quality.
8. #23 Email (`024`) after #19/#22 and exact current-head gates; provider promotion remains external-evidence gated.
9. #33 Attribution/Revenue after #22 as needed and global migration serialization.
10. #26 R31/Learning after #33 integration if its canonical revenue/feedback input is wired in the merge chain.
11. #21 AG-01 after #20/#22/#26 and migration serialization.
12. #24 Social Engagement after #19/#22 and refresh against resulting `main`.
13. #27 Analytics/Capacity after Format is fixed and predecessor reads are refreshed.
14. #28 Paid Media/Google Ads after #15/#33/#27 inputs and exact-head Quality; provider verification remains separate.
15. #29 Human Control Center after dependency cards are reconciled with merged Core state.
16. #18 Asset Intelligence only after resolving its `022` collision and reconciling Creative Truth; rerun after renumber.
17. #30 Multi-tenant foundation after predecessor migration order stabilizes; renumber/revalidate if required.
18. PR #36 WhatsApp after #22/#19, serialize migration 027 against #30, then pursue provider evidence.
19. Dependabot #1–#6 remain a separate maintenance lane.

Recompute this order after every merge, rebase, migration renumber or material head change.

## Safe parallel starts

- capability/data-governance reconciliation;
- provider configuration/read-only preflight preparation for Email and WhatsApp without sends solely for testing;
- conversion/ticketing/checkout provider-evidence adapters feeding #33 through existing Measurement/CRM roots;
- observability/DR tests that extend #20 rather than create a second plane;
- integration tests proving #22 canonical MessageRecord reuse across Email/WhatsApp/Social/AG-01;
- migration serialization tooling/checks that inspect the actual approved queue without mutating branches automatically.

Do not start another CRM, Conversation/Message model, WhatsApp provider branch, Email provider branch, scheduler, Policy Engine, Approval Engine, attribution system or parallel persistence authority.
