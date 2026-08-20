# TOCA OS Next Version — Master Tracker

Status: **ACTIVE COORDINATION**  
Round: 2026-08-20 / America-Bahia

## Baseline

- `V1_BASE_SHA=abfb09b17e90c83790e803dcda091c8142c7407f`
- round-start `main=cd99521c8842268c5e1fb9e5efe58f9f6680ddf0`
- V1: `PRODUCTION_VERIFIED`
- Next Version baseline rule: re-read live `main`; never use this recorded SHA blindly after the round.

## Feature PR map

| PR | Feature | Base | Head at round start | Relationship | CI evidence on that head | Behind round-start main | Merge disposition |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| #14 | Creative Truth / Venue Fidelity | `main` | `6bc92c6e652da7732ae663ccb1e0e752c35349f6` | parent of #16 | Quality `32322022410` PASS; PostgreSQL E2E `32322022475` PASS | 1 | refresh from live main, fresh Quality, then candidate for merge |
| #15 | Morro Demand Intelligence | `main` | `a1dd29a640daf7ba7a58364ce1f7c9fce8226643` | independent | Quality `32323105456` PASS; PostgreSQL E2E `32323105453` PASS | 1 | refresh from live main, recheck migration/hotspots, fresh Quality + PostgreSQL E2E |
| #16 | Photo-to-Video | `recovery/creative-truth-20260819` | `8a99c9059627c76eec59f259308138758177d303` | stacked on #14 | Quality `32324805271` PASS | parent is 1 behind | refresh only after refreshed #14; never merge independently |

All three PRs remain Draft. Their historical CI evidence is valid for the recorded heads only and does not satisfy the merge gate after any branch synchronization.

## Current dependencies

- #14 has no feature-PR dependency.
- #15 has no feature-PR dependency.
- #16 depends on #14 and must follow the refreshed #14 head.
- #15 may proceed in parallel with the #14/#16 stack.

## Current overlap / conflict matrix

| Files / concern | #14 | #15 | #16 | Coordination action |
| --- | --- | --- | --- | --- |
| `package.json` | yes | no | yes | expected parent/child overlap; #16 must inherit refreshed #14 |
| `src/providers/google-sheets/creative-truth-registry.ts` | yes | no | yes | child extension; never resolve by replacing parent wholesale |
| `src/server.ts` | no | yes | no | #15 hotspot; compare against live main immediately before refresh |
| `src/registry.ts` | no | yes | no | #15 hotspot; compare against parallel work before final commit |
| `src/mcp/runtime-capability-resolver.ts` | no | yes | no | #15 hotspot; isolate integration conflict fixes |
| `scripts/architecture-check.mjs` | no | yes | no | #15 hotspot; preserve all existing checks |
| migrations | none | `022_meta_ads_geo_demand_intelligence.sql` | none | re-read migration directory before finalizing #15 |
| GCS publication asset boundary | no | no | yes | reuse existing boundary; no second staging system |
| Instagram publication boundary | yes | no | inherited via parent context | publication remains separate governed side effect |

## Maintenance PR lane

Open Dependabot PRs observed in the repository:

| PR | Change | Coordination classification |
| --- | --- | --- |
| #1 | `pnpm/action-setup` 4.3.0 -> 6.0.10 | maintenance; workflow/tooling change; keep outside feature merge stack until dedicated validation |
| #2 | Vitest 3.2.7 -> 4.1.10 | major test-framework change; do not interleave with feature recovery without a dedicated compatibility pass |
| #3 | `@types/node` 24.x -> 26.x | major type-surface change; defer until feature heads are stable or validate separately |
| #4 | `globals` 16.x -> 17.x | major lint/runtime-global metadata change; validate separately |
| #5 | `typescript-eslint` 8.66 -> 8.67 | maintenance; may affect lint; validate independently |
| #6 | `tsx` 4.23.11 -> 4.23.12 | low-risk maintenance; still requires exact-head Quality |

These PRs are not part of the Next Version feature merge order and must not be allowed to obscure feature-regression attribution.

## Recovery branch governance

Active merge candidates are only the branches referenced by current PRs plus the coordinator branch:

- `recovery/creative-truth-20260819` -> #14
- `recovery/meta-ads-demand-intelligence-20260819` -> #15
- `recovery/photo-to-video-20260819` -> #16
- `coord/next-version-control-plane-20260820` -> coordinator artifacts

The following observed recovery auxiliaries are **not merge candidates** while the corresponding open PR head exists and must be treated as stale/superseded unless a deliberate compare proves unique required commits:

- `recovery/creative-truth-20260819-ci`
- `recovery/creative-truth-20260819-draftbase`
- `recovery/creative-truth-20260819-pr`
- `recovery/creative-truth-draft-pr-20260819`
- `recovery/creative-truth-finalize-20260819`
- `recovery/creative-truth-ready-20260819`
- `recovery/meta-ads-demand-intelligence-20260819-ci`
- `recovery/meta-ads-demand-intelligence-20260819-pr`
- `recovery/meta-ads-demand-intelligence-auto3way-20260819`
- `recovery/meta-ads-demand-intelligence-finalize-20260819`
- `recovery/meta-ads-demand-intelligence-noserver-20260819`
- `recovery/meta-ads-demand-intelligence-ready-20260819`
- `recovery/meta-ads-demand-intelligence-staging-20260819`
- `recovery/meta-demand-draft-pr-20260819`

V1 recovery branches such as `recovery/foundation-runtime-restart-safety-20260819` and `recovery/v1-instagram-direct-publication-20260819` are historical after formal V1 closeout; they are not Next Version merge sources.

## Recommended merge order — current round

1. Coordinator control-plane PR (documentation/registry only), after exact-head Quality.
2. #14 Creative Truth, after refresh + exact-head Quality.
3. #16 Photo-to-Video, after it is rebuilt/refreshed on the merged-or-final #14 lineage and exact-head Quality is green.
4. #15 Demand Intelligence may be inserted before #14, between #14/#16, or after #16 **only if** its refreshed diff remains independent; default preference is to merge it after #14 and before #16 only when #16 is still stacked and no hotspot conflict is introduced. Otherwise merge #14 -> #16, then #15.
5. Maintenance PRs only in a separate validation lane after the feature stack is stable.

The coordinator must recompute this order after every merge or material head change.

## Blockers at round start

- #14: 1 commit behind round-start `main`; fresh exact-head Quality required after refresh.
- #15: 1 commit behind round-start `main`; fresh Quality + PostgreSQL E2E; live Meta delivery-estimate provider evidence remains pending for promotion beyond CI.
- #16: parent #14 is behind `main`; child must wait for refreshed parent; real OpenAI video provider path remains blocked until canonical rights/likeness/approval evidence permits execution.
- Drive security: canonical manual records an `anyone with link — reader` exposure on TOCA_OS root / `00_COMECE_AQUI`; this is a Next Version security-governance item, not a reason to rewrite application architecture.

## Parallel-start lanes

Safe to start concurrently when each uses its own branch and avoids shared hotspot commits:

- Privacy/LGPD policy expansion.
- Security/supply-chain review.
- Capability/data governance.
- CRM/Sales domain design on existing records.
- Conversation/Message contract design.
- Attribution data-contract design.

Do not start WhatsApp/Email provider writes or Google Ads real writes before the required privacy, identity, CRM/message and attribution dependencies are concretely satisfied.

## Per-round coordinator checklist

1. Re-read `main` SHA.
2. List open PRs and changed heads.
3. Recompute behind/ahead and stack relationships.
4. Recompute file/migration overlap.
5. Reject stale/superseded branches as merge sources.
6. Verify exact-head CI runs.
7. Verify provider evidence only where required.
8. Update Feature Registry and Evidence Index.
9. Publish PR map, dependencies, merge order, blockers, parallel starts and conflict risks.
10. Do not merge automatically.