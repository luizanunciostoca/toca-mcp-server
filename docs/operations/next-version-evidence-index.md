# TOCA OS Next Version — Evidence Index

Status: **ACTIVE / EXACT-HEAD SCOPED / CHAT 16 READBACK**
Round: 2026-08-20 16:30 America/Bahia

## Evidence rules

`IMPLEMENTED -> CI_VERIFIED -> PROVIDER_VERIFIED -> PRODUCTION_VERIFIED`. Evidence belongs only to the exact SHA that produced it. Rebase, retarget, merge, conflict resolution, migration renumber or workflow change requires fresh applicable gates. Provider-shaped fixtures never equal provider evidence. No side effect is executed solely to manufacture evidence.

## Frozen V1

V1 remains `PRODUCTION_VERIFIED` at immutable `V1_BASE_SHA=abfb09b17e90c83790e803dcda091c8142c7407f`; the current `main` baseline is `cd99521c8842268c5e1fb9e5efe58f9f6680ddf0`.

## Current Next Version matrix

| PR  | HEAD          | Evidence state                | Exact gates                                                                        | Provider/merge caveat                                                                    |
| --- | ------------- | ----------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| #14 | `de3ec2f6...` | CI_VERIFIED                   | Quality `32335049796`, PG `32335049795` PASS                                       | parent of #16                                                                            |
| #15 | `ee7cb048...` | PROVIDER_VERIFIED (READ-only) | Quality `32333934188`, PG `32333934183`, READ `32333785052` PASS                   | `ads_read`, `providerReadOnly=true`, `writeExecuted=false`                               |
| #16 | `c0b23b57...` | CI_VERIFIED                   | Quality `32335823551` PASS                                                         | stacked on #14; retarget/revalidate after parent merge; rights/likeness evidence pending |
| #17 | `b84cce9...`  | CI_VERIFIED                   | Quality `32337525360` PASS                                                         | coordinator docs; no auto-merge                                                          |
| #18 | `e475a954...` | CI_VERIFIED                   | Quality `32342689685`, PG `32342689677` PASS                                       | migration `029`; renumber complete                                                       |
| #19 | `a6345897...` | CI_VERIFIED                   | Quality `32334417380` PASS                                                         | Privacy authority                                                                        |
| #20 | `0da69a1e...` | CI_VERIFIED                   | Quality `32342129929`, Security `32342129938` PASS                                 | hardening gate green; external Drive ACL review remains                                  |
| #21 | `e741198f...` | CI_VERIFIED                   | Quality `32337705724`, PG `32337705682` PASS                                       | hard dependency #20 plus final predecessor revalidation                                  |
| #22 | `be97c0a6...` | CI_VERIFIED                   | Quality `32336854798`, PG `32336854963` PASS                                       | sole CRM Conversation/Message authority                                                  |
| #23 | `036bbec4...` | CI_VERIFIED                   | Quality `32337132353`, Email `32337132201`, PG `32337132190` PASS                  | SendGrid external evidence pending                                                       |
| #24 | `dedcf3d7...` | CI_VERIFIED                   | Quality `32334785013`, PG `32334784974` PASS                                       | activation depends on #19/#22; no parallel ledger                                        |
| #26 | `7675bd73...` | CI_VERIFIED                   | Quality `32336459217`, PG `32336459216` PASS                                       | recommendation-only, `financialWriteAllowed=false`                                       |
| #27 | `9aa2d62d...` | CI_VERIFIED                   | Quality `32343861166`, canonical PG `32343861116`, Analytics PG `32343861120` PASS | format blocker resolved                                                                  |
| #28 | `f900c125...` | CI_VERIFIED                   | Quality `32337044377`, PG `32337044338` PASS                                       | Google Ads live READ evidence pending; no activation                                     |
| #29 | `6976825a...` | CI_VERIFIED                   | Quality `32335977430` PASS                                                         | same MCP/Core; UI emits AG-01 intents only                                               |
| #30 | `2fce39b0...` | CI_VERIFIED                   | Quality `32336878038`, PG `32336878082`, Tenancy PG `32336878062` PASS             | migration `027`; #36 is now `030`                                                        |
| #33 | `7e8df19a...` | CI_VERIFIED                   | Quality `32336942395`, PG `32336942409` PASS                                       | revenue provider evidence not promoted                                                   |
| #36 | `efe2e2f8...` | CI_VERIFIED                   | Quality `32343377890`, PG `32343377877` PASS                                       | sole WhatsApp source; migration `030`; WABA/readback evidence pending                    |

No active Next Version PR is `PRODUCTION_VERIFIED`. #15 is the only active capability with a `PROVIDER_VERIFIED` READ-only state.

## Stacks and superseded lanes

#14→#16, #22→#23 and #22→#36 are intended stacks. Retarget/rebase each child after parent merge and rerun exact-head gates. #31, #25, #32, #34 and #35 are closed unmerged/superseded/temporary lanes and must not be merge sources.

## Final migration queue

`021` is the current main tip. Proposed integration order: `022 #15`, `023 #22`, `024 #23`, `025 #26`, `026 #21`, `027 #30`, `028 #33`, `029 #18`, `030 #36`. The 022 and 027 collisions are resolved on current branches; post-integration rebases still require fresh gates.

## Provider evidence

#15 has sanitized Meta READ evidence with `providerReadOnly=true` and `writeExecuted=false`. #23 SendGrid, #24 Social, #28 Google Ads, #33 Revenue, #36 WhatsApp and provider-facing portions of #21 remain CI-verified or provider-pending; no activation/send/payment/write was executed.

## Coordinator

PR #17 HEAD `b84cce9e20e06638801100973776ecc1cbeab7df` is Draft, based on main, contains the five coordination artifacts and has Quality `32337525360` PASS.
