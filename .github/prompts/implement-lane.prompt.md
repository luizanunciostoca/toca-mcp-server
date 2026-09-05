# TOCA OS — Implement One Lane

Implement exactly the supplied Lane Contract.

Before editing, validate `BASE_SHA`, issue, branch, `FILES_OWNED`, `FILES_FORBIDDEN`, locks, dependencies, and current competing PRs. If the base or ownership no longer matches reality, stop the conflicting portion and report the exact drift.

Do not widen scope silently. Do not touch migrations/shared hotspots without an assigned lock/slot. Do not perform unrelated cleanup.

For a bug, add a regression test first when practical. Implement the smallest compatible fix. Run all checks applicable to the lane. Do not merge to main or trigger ungoverned external writes.

Finish with:
- BASE_SHA / HEAD_SHA
- changed files
- implementation summary
- tests/checks and results
- assumptions
- blockers/dependencies
- migration/security/compatibility impact
- evidence still required
- recommended next integration action.
