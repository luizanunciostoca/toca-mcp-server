# TOCA OS Next Version — Master Tracker

Status: **ACTIVE COORDINATION**  
Round: 2026-08-20 / America-Bahia

## Baseline

- `V1_BASE_SHA=abfb09b17e90c83790e803dcda091c8142c7407f`
- observed `main=cd99521c8842268c5e1fb9e5efe58f9f6680ddf0`
- V1: `PRODUCTION_VERIFIED`
- Next Version baseline rule: re-read live `main`; never use this recorded SHA blindly after the round.

## Feature PR map — current exact heads

| PR | Feature | Intended base | Current head | Relation | Exact-head CI | Current disposition |
| --- | --- | --- | --- | --- | --- | --- |
| #14 | Creative Truth / Venue Fidelity | `main` | `2843e9544c0bb0eb15affeba6d7abdc0b286f515` | 0-behind observed `main` | Quality `32333328028` PASS; PostgreSQL E2E `32333328092` PASS | technically synchronized; Draft; no provider side effect required for CI claim |
| #15 | Morro Demand Intelligence | `main` | `84e96652db604a8ac1ea258d868c4f5ce2994ad8` | 0-behind observed `main` | Quality `32333311073` PASS; PostgreSQL E2E `32333311077` PASS | synchronized; Draft; provider READ evidence still pending for promotion beyond CI |
| #16 | Photo-to-Video | `recovery/creative-truth-20260819` | `99edf42d06dc70958ac9791a79c00e877e82c4ad` | 0-behind refreshed #14 head | Quality `32333405034` PASS | correctly stacked; Draft; provider validation blocked by canonical rights/likeness/approval prerequisites |

All evidence above is scoped to the exact listed head. If any head or intended base changes, recompute and re-run gates.

## Current dependencies

- #14 has no feature-PR dependency.
- #15 has no feature-PR dependency.
- #16 depends on #14 and must never merge independently.
- #15 may proceed in parallel with the #14/#16 stack.

## Current overlap / conflict matrix

| Files / concern | #14 | #15 | #16 | Coordination action |
| --- | --- | --- | --- | --- |
| `package.json` | yes | no | yes | expected parent/child overlap; #16 inherits #14 and must be restacked after any parent change |
| `src/providers/google-sheets/creative-truth-registry.ts` | yes | no | yes | child extension only; never replace parent implementation wholesale |
| `src/server.ts` | no | yes | no | #15 hotspot; recompare after every earlier merge |
| `src/registry.ts` | no | yes | no | #15 hotspot; isolate future integration conflict changes |
| `src/mcp/runtime-capability-resolver.ts` | no | yes | no | #15 hotspot; preserve all other route bindings |
| `scripts/architecture-check.mjs` | no | yes | no | #15 hotspot; never remove existing checks to make CI pass |
| migrations | none | `022_meta_ads_geo_demand_intelligence.sql` | none | observed `main` ends at 021; no competing 022 in #14/#16; re-read before merge |
| GCS publication asset boundary | no | no | yes | reuse existing boundary; no second staging system |
| Instagram publication boundary | yes | no | inherited through parent | publication remains a separate governed side effect |

## Migration inventory

Observed `main` contains migrations through:

- `020_content_item_versioning_video.sql`
- `021_r29_video_artifacts.sql`

PR #15 adds:

- `022_meta_ads_geo_demand_intelligence.sql`

At this round there is no migration-number collision among #14, #15 and #16. Because migrations are globally serialized, every future persistence PR must inspect live `main` and all open persistence PRs before claiming the next number.

## Maintenance PR lane

Open Dependabot PRs observed in the repository:

| PR | Change | Coordination classification |
| --- | --- | --- |
| #1 | `pnpm/action-setup` 4.3.0 -> 6.0.10 | workflow/tooling change; keep outside feature stack until dedicated validation |
| #2 | Vitest 3.2.7 -> 4.1.10 | major test-framework change; do not interleave with recovery stack |
| #3 | `@types/node` 24.x -> 26.x | major type-surface change; validate separately |
| #4 | `globals` 16.x -> 17.x | major lint/global metadata change; validate separately |
| #5 | `typescript-eslint` 8.66 -> 8.67 | lint maintenance; validate independently |
| #6 | `tsx` 4.23.11 -> 4.23.12 | low-risk maintenance but still exact-head Quality scoped |

These PRs are not in the Next Version feature merge order and must not obscure regression attribution.

## Recovery branch governance

Active merge candidates are only current PR branches plus the coordinator branch:

- `recovery/creative-truth-20260819` -> #14
- `recovery/meta-ads-demand-intelligence-20260819` -> #15
- `recovery/photo-to-video-20260819` -> #16
- `coord/next-version-control-plane-20260820` -> coordinator artifacts

Auxiliary recovery branches observed during migration/recovery are **not merge candidates** while the corresponding current PR head exists. Treat them as stale/superseded unless a deliberate compare demonstrates a unique required commit:

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

V1 recovery branches are historical after formal V1 closeout and are not Next Version merge sources.

## Recommended merge order — current round

1. Coordinator control-plane PR, after its own exact-head Quality is green.
2. #14 Creative Truth.
3. #16 Photo-to-Video, preserving the parent-child lineage.
4. #15 Demand Intelligence can be merged before or after the #14/#16 stack only after recomputing its hotspot diff against the then-current `main`. Current default is **#14 -> #16 -> #15** to keep the Creative Truth stack contiguous and then reconcile #15 hotspots once.
5. Maintenance PRs only in a separate validation lane after feature integration is stable.

This order is not permanent. Recompute after every merge/material head change.

## Current blockers

- #14: no technical CI blocker at current observed base; still Draft and must be revalidated if `main` moves.
- #15: no CI/migration-number blocker at current observed base; provider verification remains pending for live `delivery_estimate` READ, accepted canonical targeting, durable sample readback and proof of no write.
- #16: no CI/stack blocker at current parent head; provider path must remain blocked until canonical source-rights, likeness and explicit approval prerequisites exist. No real generation/publication may be executed solely for testing.
- Coordinator: exact-head Quality pending until the coordinator PR is opened/current head is tested.
- Drive security: canonical master manual records `anyone with link — reader` on TOCA_OS root / `00_COMECE_AQUI`; this is a security-governance work item, not permission to redesign the architecture.

## Parallel-start lanes

Safe to begin concurrently on separate branches with integration hotspots isolated:

- Privacy/LGPD policy expansion.
- Security/supply-chain hardening.
- Capability/data governance.
- CRM/Sales expansion using existing Contact/Lead/Opportunity records.
- Conversation/Message contract design.
- Attribution data-contract design.

Do not start uncontrolled WhatsApp/Email sends or real Google Ads writes before privacy, identity, CRM/message and attribution dependencies are concretely satisfied.

## Per-round coordinator checklist

1. Re-read `main` SHA.
2. List open PRs and current heads.
3. Recompute behind/ahead and stack relationships.
4. Recompute file/migration overlap.
5. Reject stale/superseded branches as merge sources.
6. Verify exact-head CI runs.
7. Verify provider evidence only where required.
8. Update Feature Registry and Evidence Index.
9. Publish PR map, dependencies, merge order, blockers, parallel starts and conflict risks.
10. Do not merge automatically.