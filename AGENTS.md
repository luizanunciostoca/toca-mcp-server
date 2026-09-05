# TOCA OS — Agent Development Contract

This repository uses a single development authority with multiple isolated workers.

## Canonical truth
- GitHub live `main` is the source of truth for code and current technical state.
- TOCA_OS Google Drive is the source of truth for approved architecture, business policy, SOPs, and operational rules.
- Provider readback is the source of truth for external side effects.
- Evidence is bound to the exact commit SHA that produced it. Never reuse CI or acceptance evidence after the HEAD changes.

Canonical parallel-development protocol: `TOCA_OS — ORQUESTRACAO_DE_DESENVOLVIMENTO_PARALELO_GITHUB_COPILOT_PRO_PLUS_v1.0`, Drive ID `18sOEv4GFrpSNjJg0Pbn8cR3RsiHlbiNhNEa0d_Jp9oQ`.

## Before doing material work
1. Read live `main` and freeze `BASE_SHA`.
2. Read the canonical issue/task and relevant current PRs/branches.
3. Search for existing or competing implementation before writing new code.
4. Declare a lane contract: `LANE_ID`, `BASE_SHA`, `ISSUE`, `BRANCH`, `FILES_OWNED`, `FILES_FORBIDDEN`, `HOTSPOT_LOCKS`, `DEPENDS_ON`, `MIGRATION_SLOT`, and `ACCEPTANCE`.
5. Stop or request a lock if the work expands outside ownership.

## Parallelism
Parallelize only non-overlapping work. One lane = one owner = one isolated branch/worktree = one canonical PR.

Treat these as serialized/shared hotspots unless the Control Tower explicitly assigns a lock:
- migrations and migration numbering;
- package manifests and lockfiles;
- shared schemas and core contracts;
- capability/route registries;
- config/env contracts;
- CI/deploy/security/release workflows;
- provider interfaces;
- policy/approval/authorization contracts;
- production authorization/watch controllers;
- any file already owned by another active lane.

Migrations are globally serialized. Never independently choose a migration number when another migration lane is active.

## Implementation rules
- Make the smallest architecturally correct change for the assigned lane.
- Do not perform opportunistic unrelated refactors.
- Reproduce bugs with a regression test when practical.
- Preserve existing contracts unless contract change is explicitly in scope.
- Never create a second MCP, CRM, scheduler, Policy Engine, Approval Engine, or parallel source of truth.
- Never hardcode secrets or copy real credentials into tests/docs.
- Fail closed on ambiguous provider outcomes and avoid blind retry of uncertain writes.
- Never execute an external side effect only to manufacture evidence.
- Workers must not push or merge directly to `main`.

## Quality and acceptance
Run the checks relevant to the lane. The repository's required CI is authoritative for merge acceptance. Typical gates include format, architecture, lint, typecheck, tests, build, migration/PostgreSQL E2E when applicable, and security/supply-chain checks.

A missing check, startup failure, zero-job run, or CI from another SHA is not PASS.

## Integration
The integration coordinator compares merge-base, ahead/behind, file overlap, dependency order, and migration collisions before recommending merge order. Newer PRs do not automatically win. Preserve unique useful code from competing branches before superseding them.

After every merge: re-read `main`, invalidate stale bases/evidence, recalculate dependencies, and release the next safe lanes.

Before any main-changing merge, check whether active production authorization/watch/runtime evidence is bound to the current main SHA. Do not silently invalidate a live production evidence chain.

## Required handoff
Every worker returns:
- exact `BASE_SHA` and final `HEAD_SHA`;
- files changed;
- tests/checks executed and results;
- assumptions and unresolved blockers;
- migration/security/compatibility impact;
- dependencies introduced or released;
- evidence still required before integration or production.

Never claim provider-verified or production-verified state from code/CI alone.