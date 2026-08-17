# Repository Governance — Foundation V1

Status: **REPOSITORY CONTROLS PREPARED / HOST ENFORCEMENT UNVERIFIED / CI_VERIFIED PENDING**

Repository: `luizidebook/toca-mcp-server`

Canonical audit baseline: `main@868c64ac0dcfa4c2b28994198b1a8c9af87f7a7c` on 2026-08-17.

## Current observed state

- At the audit-start authoritative recheck, the only open PR was #185 (`fix/v1-instagram-direct-publication`).
- During this closeout, concurrent work opened PR #188 (`chore/local-reproducible-quality-ci`) and PR #189 (`docs/r29-outbox-slo-closeout-20260817`). The final recheck therefore found **three** open PRs: #185, #188 and #189.
- PR #185 is Instagram feature work, #188 is the dedicated CI/Quality-local path, and #189 is the R29/outbox/SLO closeout. None is reimplemented by this governance closeout.
- `.github/CODEOWNERS` exists and assigns the repository and governance-sensitive paths to `@luizidebook`.
- The canonical Quality workflow remains `.github/workflows/quality.yml` (`Quality Gate`).
- GitHub Actions is currently unavailable for the closeout round. No current-head `CI_VERIFIED` claim is made.
- The GitHub rulesets endpoint returned `403` with the plan-level message requiring GitHub Pro or public visibility; therefore this closeout cannot truthfully claim that a hosted ruleset is active or read back.
- The branch-protection endpoint returned `403 Resource not accessible by integration`; therefore branch-protection enforcement is also not independently verified by this audit.
- Historical hosted-control evidence remains historical evidence only. It must not be restated as current host enforcement without a fresh readback.

## ACL baseline

Until a second trusted maintainer exists:

- retain only the repository owner as `admin`;
- do not add broad organization/team write access;
- provider/service credentials belong in GitHub/GCP managed secret stores, never repository files containing raw secrets;
- production deploy identities remain separate from developer identities and scoped to the minimum provider/project resources;
- CODEOWNERS identifies governance-sensitive paths;
- a required human approval count of zero is acceptable only for the solo-maintainer state and is not a substitute for CI or exact-head validation.

When a second trusted maintainer is added, require at least one approving review and required CODEOWNERS review for protected paths, with stale approvals dismissed after new commits.

## Target hosted `main` protection / ruleset for final reactivation

When the hosted control can be configured and read back again, the V1 target is:

1. pull request required before merge;
2. exact required status check from the canonical `Quality Gate` (`quality` job/check name as exposed by GitHub);
3. required check evaluated against the current `main` / branch must be up to date;
4. conversation resolution required before merge;
5. no force/non-fast-forward updates;
6. no branch deletion;
7. no normal-development bypass actor;
8. merge only from the exact head SHA that passed the required checks;
9. with two or more trusted maintainers: at least one approval, CODEOWNERS review and stale-approval dismissal.

These are **target controls**, not a statement that the host currently enforces them. Final governance closure requires a fresh hosted readback once the account/plan/integration permits it.

## CI truth

Historical green runs remain evidence for the exact SHAs on which they ran. They do not certify a new governance/doc-only head.

Current closeout state:

`CI_VERIFIED = PENDING_FINAL_ACTIONS_ROUND`

When GitHub Actions becomes available, the final exact head must pass the repository-required gates before this flag can become true. GitHub Actions startup failure, missing jobs or absent check-runs are not accepted as successful CI.

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
