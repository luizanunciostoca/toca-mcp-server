# TOCA OS — Parallel Development Dispatch

Act as the TOCA Control Tower.

For the current development objective:

1. revalidate live `main` and freeze exact `BASE_SHA`;
2. inventory remaining work from live issues/PRs/code and canonical TOCA_OS docs;
3. identify dependencies, shared hotspots, migration needs, active production SHA-bound gates, and overlapping PRs;
4. build a DAG and classify tasks as `READY_PARALLEL`, `STACKED`, `SERIAL`, or `BLOCKED`;
5. maximize safe parallelism by assigning independent lanes to separate agents/sessions;
6. choose an appropriate agent/model per lane complexity and avoid wasting premium usage on trivial work;
7. generate a complete Lane Contract for each lane;
8. define exact integration/merge order and acceptance requirements;
9. after each merge, revalidate `main`, invalidate stale bases/evidence, and release the next safe lanes.

Never assign two writers to the same hotspot. Never parallelize migrations. No worker merges directly to main or performs production side effects unless that side effect is separately and explicitly governed.

Return the lane matrix with:
`LANE_ID | STATUS | OWNER_AGENT | BASE_SHA | ISSUE | BRANCH | FILES_OWNED | LOCKS | DEPENDS_ON | MIGRATION_SLOT | ACCEPTANCE | MERGE_ORDER | NEXT_ACTION`.
