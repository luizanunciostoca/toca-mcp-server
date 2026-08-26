# Repository Governance — Foundation V1

Status: **LOCAL CONTROLS VERIFIED / HOST ENFORCEMENT UNVERIFIED / REMOTE CI PENDING**

Repository: `luizanunciostoca/toca-mcp-server`

Autonomy/readiness audit baseline: `main@904210f2ed000ac1f99783d5f210e58da938e775` on 2026-08-26.

## Current observed state

- `.github/CODEOWNERS` assigns the repository and governance-sensitive paths to `@luizanunciostoca`.
- The canonical Quality workflow remains `.github/workflows/quality.yml` (`Quality Gate`).
- Security Supply Chain remains mandatory for dependency, secret, filesystem, container, SBOM and CodeQL evidence.
- `.github/workflows/autonomy-safety.yml` adds an exact-candidate gate for policy, readiness, scheduler, approval, rollout, fault injection and provider-backed lifecycle contracts.
- `control/github-main-branch-protection.v1.json` is the canonical desired state; its offline validator passes with five required contexts.
- Hosted enforcement is not claimed because this task has no authenticated GitHub integration or administrative branch-protection readback.
- Historical hosted-control evidence remains historical evidence only and must not be restated as current enforcement without a fresh readback.

## ACL baseline

The target ACL and review baseline is:

- retain only explicitly trusted administrators and do not add broad organization/team write access;
- provider/service credentials belong in GitHub/GCP managed secret stores, never repository files containing raw secrets;
- production deploy identities remain separate from developer identities and scoped to minimum resources;
- CODEOWNERS identifies governance-sensitive paths;
- every merge to `main` requires at least one approving review, required CODEOWNERS review, stale-review dismissal and approval of the last push;
- lack of a second maintainer is an operational staffing blocker, not permission to reduce the desired protection policy.

## Target hosted `main` protection / ruleset

The canonical desired state is versioned in `control/github-main-branch-protection.v1.json` and requires:

1. pull request before merge and a branch updated with current `main`;
2. `Quality Gate / quality`;
3. `Security Supply Chain / dependency-review`;
4. `Security Supply Chain / vulnerability-secret-container-sbom`;
5. `Security Supply Chain / codeql`;
6. `Autonomy Safety / autonomy-safety`;
7. one approving review, CODEOWNERS review, stale-review dismissal and last-push approval;
8. conversation resolution and linear history;
9. no force-push, branch deletion or normal-development bypass;
10. merge only from the exact head SHA that passed all required checks.

These remain **target hosted controls**, not a statement that GitHub currently enforces them. Closure requires `node scripts/apply-main-branch-protection.mjs --apply` with administrator credentials followed by `BRANCH_PROTECTION_READBACK=PASS`.

## CI truth

Historical green runs remain evidence only for their exact SHAs. The autonomy/readiness branch passed the full local `pnpm quality` gate with 999 tests, but local success does not certify hosted controls or provider-backed production.

Current closeout state:

`LOCAL_CI_VERIFIED = TRUE`

`REMOTE_CI_VERIFIED = PENDING_AUTHENTICATED_PR`

When GitHub Actions becomes available, the final exact head must pass every required hosted check before remote CI can become true. Startup failure, missing jobs, skipped required jobs or absent check-runs are not success.

## Supply-chain baseline

Every versioned workflow under `.github/workflows/*.yml` or `.github/workflows/*.yaml` is required to:

- declare explicit least-privilege top-level `permissions` before `jobs`;
- pin third-party actions to immutable 40-character commit SHAs;
- use local actions only through `./...` references;
- keep provider mutation paths bounded and fail closed;
- use frozen dependency installation for Node application builds where dependency installation occurs;
- avoid blind retries after ambiguous provider mutations.

`scripts/check-workflow-supply-chain.mjs` is executed by the canonical Quality Gate before dependency installation. The checker now enumerates **all** versioned workflow YAML files dynamically rather than maintaining a hand-written allowlist. This removes the previous governance drift in which `meta-ads-create-paused-provider-smoke.yml` and `r29-production-runtime-verification.yml` existed on `main` but were not covered by the checker.

## Workflow classification

The audit-start tree contained 12 workflow files. They are not all equivalent:

- **Permanent repository/runtime controls:** `quality.yml`, `deploy-gcp.yml`, `deploy-toca-managed-instagram-daemon-gcp.yml`, `gcp-cost-hygiene.yml`, `infrastructure-control-plane.yml`, `marketing-autopilot-publication.yml`, `r29-production-runtime-verification.yml`.
- **Permanent/manual bounded operational validation:** `deploy-instagram-publication-worker-gcp.yml`, `gcp-meta-oauth-boundary-smoke.yml`, `meta-ads-create-paused-provider-smoke.yml`.
- **Permanent E2E test retained despite historical naming:** `m-found-12-postgres-e2e.yml`; it now also exercises R29/PostgreSQL paths. Its historical feature-branch push trigger is workflow drift delegated to the dedicated CI/Quality closeout (#188), not duplicated here.
- **Historical milestone / one-shot candidate:** `m-found-12-provider-read.yml`; it remains useful as evidence, but its trigger is still tied to the already-merged M-FND-12 feature branch. Remove or generalize it only after #188/CI closeout confirms equivalent provider-read coverage and preserves evidence history.

No workflow YAML is removed merely because its name contains `smoke` or because its original use was manual. Removal requires proof that the executable surface is obsolete or superseded and that no unique validation path is being discarded.

## Branch cleanup rule

Branch names such as `tmp`, `diag`, `repair`, `reconcile`, `backup`, `controller` or dated `ops` are **signals for review, not deletion authority**. A branch is safe to delete only after one of these is proven:

- its exact work is merged and the head has no unique post-merge commits;
- its PR is explicitly superseded by a merged replacement and no unique work remains;
- it is an intentionally temporary diagnostic/no-op branch and contains no unique evidence that must remain addressable by branch name.

The auditable candidate/preserve inventory is recorded in `docs/operations/branch-cleanup-inventory-2026-08-17.md`.

## Break-glass policy

Emergency direct changes to `main` are allowed only when all are true:

- an active production incident or security containment requires it;
- the normal PR/Quality path is unavailable or materially unsafe;
- exact commit and reason are recorded in an incident entry;
- the smallest possible patch is applied;
- a follow-up PR/reconciliation and full Quality run occur immediately after CI becomes available.

GitHub Actions unavailability by itself is **not** permission to bypass exact-head validation for normal feature/foundation merges. Local/direct validation may continue while hosted CI is unavailable, but hosted `CI_VERIFIED` remains pending.
