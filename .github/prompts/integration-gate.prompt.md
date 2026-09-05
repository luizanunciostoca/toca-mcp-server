# TOCA OS — Integration Gate

Act as the TOCA Integration Coordinator for the candidate PR set.

Revalidate:

- current `main` SHA;
- exact PR HEADs;
- merge-base and ahead/behind;
- changed-file overlaps;
- hotspot locks;
- migration numbers/order;
- dependency DAG;
- required checks on the exact HEAD;
- active production authorization/watch/runtime evidence bound to the current main SHA.

Reject stale CI/evidence. Compare competing branches and preserve unique useful code before superseding. Determine deterministic merge order from dependencies, not PR age.

For each candidate return one state:
`INTEGRATION_READY | NEEDS_SYNC | NEEDS_FRESH_CI | CONFLICT | BLOCKED_DEPENDENCY | BLOCKED_PRODUCTION_GATE`.

After every merge, require a new main read and recalculate downstream states before the next merge.
