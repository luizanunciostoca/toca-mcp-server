# TOCA OS — Agent Development Contract / PRO+ v2

This repository uses one development authority with multiple isolated workers and a machine-readable PRO+ v2 control plane.

## Canonical truth

- GitHub live `main` is canonical for code and current technical state.
- TOCA_OS Google Drive is canonical for approved architecture, business policy, SOPs and operational rules.
- Provider readback is canonical for external side effects.
- Evidence belongs to the exact SHA/runtime contract that produced it.

Canonical protocol: `TOCA_OS — ORQUESTRACAO_DE_DESENVOLVIMENTO_PARALELO_GITHUB_COPILOT_PRO_PLUS_v2.0`, Drive ID `17DLQXnLkhVRfN2ina4WDcE-fjQL6AHqH2x6UzhXZxUw`.

## PRO+ v2 control plane

Before material work, read `control/pro-plus/README.md`, the static policies in `control/pro-plus/`, and the mutable state-plane issue pointers in `control/pro-plus/state-plane.json`.

Routine lane/lock/queue/evidence state belongs in issues #639–#642, not in commits to `main`. Only the Control Tower or an explicitly delegated control-plane worker may mutate those issues.

## Before editing

1. Revalidate live `main` and freeze exact `BASE_SHA`.
2. Reconcile related code, issues, PRs and branches before creating duplicate work.
3. Read Lane Registry/locks (#639) and declare a Lane Contract.
4. Acquire required hotspot/migration locks before editing.
5. Work only in the assigned isolated branch/worktree and owned paths.

One lane = one owner = one canonical PR. Never silently expand ownership.

## Hotspots

Treat migrations, package manifests/lockfiles, shared contracts/schemas, registries, config/env contracts, CODEOWNERS, workflows, provider interfaces, policy/approval/authorization and production controllers as lock-required. Migrations are globally serialized and require a reserved slot.

## Quality and integration

CI/acceptance is exact-HEAD evidence. A sync, rebase, conflict resolution or new commit requires fresh checks.

A PR becomes integration-ready only through the Integration Queue (#640): `READY_FOR_INTEGRATION → FROZEN → CI_RUNNING → MERGE_RESERVED → MERGED → POST_MERGE_ACCEPTANCE → ACCEPTED`.

Before a main-changing merge, verify current production SHA-bound watches/authorizations/evidence. After every merge, re-read main, invalidate stale downstream evidence, recalculate the DAG and release the next lanes.

## Main stability and Build Broker

Do not start expensive SHA-bound runtime builds/evidence merely because CI is green. Recompute #640 and require `MAIN_STABILITY=PASS`, `EVALUATED_MAIN_SHA=<current main>` and `MERGE_RESERVATION=NONE`.

Artifact reuse is allowed only for exact tree + runtime-contract equivalence. Subjective claims that a change is “non-functional” are insufficient.

## Backlog and promotion

Use #642 to classify historical work before duplicating implementation. Prefer on-demand promotion materialization from current main after prerequisites; long-lived promotion drafts are exceptions.

## Safety

- Never hardcode secrets or raw provider/user data.
- Never execute an external side effect merely to manufacture evidence.
- Fail closed on ambiguous provider outcomes; no blind retry.
- Workers never push/merge directly to `main`.
- PRO+ v2 does not grant production/provider/deployment/database/autonomy authority.

## Handoff

Return exact BASE_SHA/HEAD_SHA, files changed, checks, risks, blockers, dependencies, lock status, evidence validity and next integration action.
