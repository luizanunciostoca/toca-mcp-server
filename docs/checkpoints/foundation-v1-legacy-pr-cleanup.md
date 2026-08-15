# Foundation v1 — Legacy PR Cleanup Audit

Baseline: `main@b0d067e9cc6b469fdb1421ab7a25a25a3b0f1f47`.

Status: **RECOMMENDATIONS ONLY — NO PR CLOSED OR MERGED BY THIS AUDIT**.

The purpose is to avoid spending GitHub Actions minutes on branches whose useful behavior is already present or whose architecture predates M-FOUND.

## Summary

| PR | Primary classification | Recommended action | Preserve before close? |
|---|---|---|---|
| #46 | `PARTIALLY_SUPERSEDED` | `SHOULD_CLOSE` after accepting preservation note below | underlying local Story Composer is already in `main`; standalone CLI is unique but should not be resurrected as an alternate execution boundary |
| #47 | `FULLY_SUPERSEDED` | `SHOULD_CLOSE` | no; Meta Ads ad-set/ad READ provider methods already exist in `main` |
| #53 | `PARTIALLY_SUPERSEDED` | `SHOULD_CLOSE` | scheduling semantics are preserved in current architecture docs; if an executable probe becomes necessary, reimplement it under current capability/lifecycle contracts |
| #78 | `NEEDS_CLEAN_REIMPLEMENTATION` | keep open only as temporary source/evidence until the unique settled-readiness hardening is ported cleanly; then `SHOULD_CLOSE` | **yes**: provider settlement/readiness logic, account/pixel preflight and associated tests/workflow gates |

## PR #46 — Marketing Autopilot Story production hardening

**Classification:** `PARTIALLY_SUPERSEDED` -> recommended `SHOULD_CLOSE`.

Evidence:

- Old base `75cddccb...`; current `main` is 286 commits ahead of that base.
- The PR introduced `src/providers/local/local-story-composer.ts`; current `main` already contains a later local Story Composer implementation with explicit template types, 1080x1920 output, SHA lineage, master Drive file lineage, JPEG validation and fail-closed errors.
- Current `main` also has the matching `test/local-story-composer.test.ts` and later Marketing Autopilot lifecycle/scheduling architecture.
- The PR's `src/marketing-autopilot-story-compose.ts` CLI is not present in current `main` and is therefore unique.

Preservation decision:

The unique CLI should **not** block closing #46. It is an ad-hoc operational entrypoint built against the older composer input contract (`headline/body/cta`), while current `main` uses the newer template contract. The durable/workflow/Core architecture now provides the correct execution boundary. If a human/local composition CLI is still desired later, reimplement a thin CLI against the current `LocalStoryComposer` contract without creating a second workflow, registry or MCP path.

Do not rebase #46: that would reintroduce obsolete package/CLI assumptions and spend CI on already-landed functionality.

## PR #47 — Meta Ads ad set/ad READ expansion

**Classification:** `FULLY_SUPERSEDED` -> `SHOULD_CLOSE`.

Evidence:

- Same old base `75cddccb...`; current `main` is 286 commits ahead.
- `MetaAdsReadProvider.listAdSets()` and `.listAds()` are already present on current `main` with the intended provider fields.
- Current `main` also contains the corresponding read tool registrations; therefore the functional READ expansion is already preserved.
- The PR changes `src/registry.ts`, `src/tools/register-meta-ads-read.ts`, `scripts/architecture-check.mjs` and a temporary workflow `.github/workflows/format-paid-media-read-temp.yml`.

Architecture decision:

Do not preserve the temporary workflow. Do not preserve direct-public-tool expansion as a reason to merge: M-FOUND-11's Core facade is explicitly intended to keep provider services internal and expose a small governed MCP surface. Once M-FOUND-11 merges, Meta Ads execution/discovery should be reached through the Core facade/runtime binding rather than using #47 as a competing public-surface authority.

## PR #53 — Instagram provider-native scheduling probe

**Classification:** `PARTIALLY_SUPERSEDED` -> recommended `SHOULD_CLOSE`.

Evidence:

- Old base `6d68f18e...`; current `main` is 276 commits ahead.
- The PR's only file is a standalone `src/instagram-native-scheduling-capability.ts` matrix/assertion.
- Current `docs/architecture/instagram-scheduling-semantics.md` already captures the critical semantics: TOCA target time is distinct from provider-native scheduling, `SCHEDULED` requires provider evidence, and unsupported Instagram provider-native scheduling must fail closed rather than being simulated by a hidden timer.
- The current provider publication registry remains conservative; external Instagram publication is not promoted by this audit.

Preservation decision:

The conceptual safety rule is preserved. The standalone helper function itself is not necessary for Foundation v1 because no current canonical runtime contract requires this legacy module. If executable provider-native scheduling discovery becomes necessary, implement it as a current capability/provider-support check governed by `CapabilityLifecycleEvidence`, not as a permanent standalone truth table copied from an old branch.

## PR #78 — Meta Ads account/pixel and settled delivery readiness

**Classification:** `NEEDS_CLEAN_REIMPLEMENTATION`.

Do **not** close yet solely because it is old.

Evidence:

- Base `ea4430dc...`; current `main` is 254 commits ahead.
- The PR contains unique `meta-ads-smoke-readiness.ts` logic that treats `IN_PROCESS`, `PENDING_REVIEW` and `PREAPPROVED` as transient rather than success; rejects `WITH_ISSUES`, unsafe configured states, `issues_info` and `failed_delivery_checks`; and requires settled paused state.
- It also introduces provider preflight for account/pixel/ad-set validation and updates provider smoke/diagnostic workflows.
- A search of current `main` did not find the equivalent settled-status/failed-delivery implementation.
- The PR itself records that an earlier smoke appeared green before provider propagation settled, and that a later provider state exposed a pixel-access problem. It also records an unresolved billing/payment gate for validate-only Ad proof.

Preservation plan before close:

1. Start from then-current `main`, not #78 history.
2. Port only provider-settlement/readiness primitives and their focused tests.
3. Reconcile account/resource binding with the current Meta Ads guardrail/config model; do not hard-code a new global business truth into generic runtime code.
4. Update existing current smoke/diagnostic workflows rather than restoring branch-era copies wholesale.
5. Route any future public execution through the merged M-FOUND-11 Core facade and current R27 approval semantics.
6. Keep all write enablement fail-closed; no activation and no spend in tests.
7. Run the official exact-head Quality Gate after Actions returns.
8. Only after the clean replacement preserves the unique behavior should #78 be closed as superseded.

## Cleanup order when Actions returns

1. Revalidate current `main` and open PR heads first.
2. Close #47 without rerunning CI; functionality is already preserved and its temporary workflow should not consume minutes.
3. Close #46 after retaining this explicit note that only the obsolete standalone CLI is intentionally not ported.
4. Close #53 after retaining this explicit note that semantics are preserved and any future executable probe must use current lifecycle/provider-support contracts.
5. Clean-reimplement the unique #78 readiness logic on a fresh current-main branch; validate it once, then close #78.
6. Do not spend CI on rebasing the old legacy branches.

No action in this document authorizes merging M-FOUND-11, closing an unpreserved PR, activating a provider write, or promoting any lifecycle state.
