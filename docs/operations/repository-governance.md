# Repository Governance — Foundation v1

Status: **HOSTED `main` RULESET ACTIVE — VERSIONED CONTROLS VERIFIED**

Repository: `luizidebook/toca-mcp-server`

Final V1 governance reconciliation baseline: `main@45d076d700e50e992993af4ab86dcafc9e2c2503` after the Dependabot configuration cleanup was merged.

## Current observed state

- GitHub ruleset `main-protection` (`20903350`) is active on the default branch.
- The ruleset requires pull requests, exact required status check `quality`, strict up-to-date evaluation, conversation resolution, and blocks branch deletion/non-fast-forward updates.
- The ruleset has no bypass actors configured; normal development cannot bypass the required check.
- Repository visibility is private.
- The canonical CI workflow is `.github/workflows/quality.yml` (`Quality Gate`).
- GitHub Actions is operational; startup failures are not accepted as successful checks.
- Foundation merges use exact green head SHAs and post-merge `main` Quality verification.
- `.github/CODEOWNERS` governs repository-wide and security-sensitive paths; current solo-maintainer policy intentionally requires zero human approvals while exact-head Quality remains mandatory.

## ACL baseline

Until a second trusted maintainer exists:

- retain only the repository owner as `admin`;
- do not add broad organization/team write access;
- provider/service credentials belong in GitHub/GCP managed secret stores, never repository files containing raw secrets;
- production deploy identities remain separate from developer identities and scoped to the minimum provider/project resources;
- CODEOWNERS identifies governance-sensitive paths;
- required code-owner approval remains disabled while the repository has one human maintainer because authors cannot approve their own PRs.

When a second trusted maintainer is added, require at least one approving review and required CODEOWNERS review for protected paths, with stale approvals dismissed after new commits.

## Required hosted `main` protection / ruleset

The GitHub-hosted control is applied and read back with the V1-required properties:

1. pull request before merge;
2. required status check `quality` from `Quality Gate` on the exact head;
3. strict required-check evaluation against current `main`;
4. conversation resolution before merge;
5. no force/non-fast-forward updates;
6. no branch deletion;
7. no configured bypass actors for normal development;
8. merge only after the exact green head SHA is captured.

### Review count

Current solo-maintainer state: **0 required approvals**. This is intentional and is not a substitute for CI; exact-head Quality is the merge gate.

Future two-maintainer state: **1 required approval + required CODEOWNERS review**, dismiss stale approvals on new commits.

## Supply-chain baseline

Permanent Foundation/production workflows are required to:

- declare explicit least-privilege top-level permissions;
- pin third-party actions to immutable 40-character commit SHAs;
- disable checkout credential persistence when a workflow does not need to push;
- bound execution with timeouts and concurrency where appropriate;
- use frozen dependency installation for Node application builds;
- avoid automatic retries of ambiguous provider mutations;
- retain exact-request/approval boundaries for production writes.

`scripts/check-workflow-supply-chain.mjs` is executed before dependency installation by the canonical Quality Gate. It rejects floating action references for the permanent workflow set, including Quality, production deploys, cost/infrastructure controls, Marketing Autopilot and M-FOUND-12 validation workflows.

Dependabot is configured weekly for npm/pnpm dependencies and GitHub Actions. Dependency updates remain normal maintenance PRs and must pass exact-head Quality before merge; major-version updates are not release blockers by themselves and are not merged into a frozen release merely to obtain an empty PR queue.

## Workflow reduction

The following obsolete privileged/bootstrap/one-shot workflow files were intentionally removed by closeout instead of being kept as latent execution surfaces:

- old GCP auth/artifact/image/preflight/staging bootstrap smokes;
- the four fixed first-publication one-shot workflows now superseded by the canonical governed publication path;
- expired dated Meta Ads event execution;
- obsolete Meta Ads OAuth/diagnostic/gate workflows bound to the superseded ad account.

GitHub Actions may continue to expose historical workflow-registration records after the YAML file has been removed. Those historical records are not equivalent to executable workflow files on the current `main`; the executable surface is determined by the workflow files actually versioned on the current tree. Historical evidence remains available in Git/PR/Audit history.

## Break-glass policy

Emergency direct changes to `main` are allowed only when all are true:

- an active production incident or security containment requires it;
- the normal PR/Quality path is unavailable or materially unsafe;
- exact commit and reason are recorded in an incident entry;
- the smallest possible patch is applied;
- a follow-up PR/reconciliation and full Quality run occur immediately after CI becomes available.

Actions-minutes exhaustion by itself is not a reason to bypass Quality for feature/foundation merges.
