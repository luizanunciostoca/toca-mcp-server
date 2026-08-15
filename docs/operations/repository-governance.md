# Repository Governance — Foundation v1

Status: **VERSIONED CONTROLS READY; HOSTED `main` RULESET STILL REQUIRES REPOSITORY-ADMIN APPLICATION**

Repository: `luizidebook/toca-mcp-server`

Reconciliation baseline: `main@bba883595ad22081a94208ff07ce4348c28de1af` after M-FOUND-11 and M-FOUND-12 were merged and post-merge Quality was green.

## Current observed state

- `main` is not protected by a hosted GitHub branch-protection/ruleset control.
- Repository visibility is private.
- The collaborator audit found a single collaborator: `luizidebook`, role `admin`.
- The canonical CI workflow is `.github/workflows/quality.yml` (`Quality Gate`).
- GitHub Actions is operational again; startup failures are not accepted as successful checks.
- Foundation merges use exact green head SHAs and post-merge `main` Quality verification even before the hosted rule is applied.

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

The GitHub-hosted repository control must require:

1. pull request before merge;
2. required status check `quality` from `Quality Gate` on the exact head;
3. branch up to date with `main` before merge;
4. conversation resolution before merge;
5. no force pushes;
6. no branch deletion;
7. no direct pushes except an explicit emergency/break-glass path;
8. no status-check bypass for normal development;
9. merge only after the exact green head SHA is captured;
10. a disposable validation PR after the hosted rule is applied.

### Review count

Current solo-maintainer state: **0 required approvals**. This is not a substitute for CI; exact-head Quality is the merge gate.

Future two-maintainer state: **1 required approval + required CODEOWNERS review**, dismiss stale approvals on new commits.

The available repository connector can read the hosted branch state but does not expose branch-protection/ruleset mutation. This document therefore does not claim that the GitHub-hosted rule is active until a repository-admin API/UI action is performed and read-back confirms it.

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

Dependabot is configured weekly for npm/pnpm dependencies and GitHub Actions. Dependency updates remain normal PRs and must pass exact-head Quality.

## Workflow reduction

The following obsolete privileged/bootstrap/one-shot workflows are intentionally removed by this closeout instead of being kept as latent execution surfaces:

- old GCP auth/artifact/image/preflight/staging bootstrap smokes;
- the four fixed first-publication one-shot workflows now superseded by the canonical governed publication path;
- expired dated Meta Ads event execution;
- obsolete Meta Ads OAuth/diagnostic/gate workflows bound to the superseded ad account.

Historical evidence remains available in Git/PR/Audit history; deletion of the workflow file only removes the executable trigger surface.

## Break-glass policy

Emergency direct changes to `main` are allowed only when all are true:

- an active production incident or security containment requires it;
- the normal PR/Quality path is unavailable or materially unsafe;
- exact commit and reason are recorded in an incident entry;
- the smallest possible patch is applied;
- a follow-up PR/reconciliation and full Quality run occur immediately after CI becomes available.

Actions-minutes exhaustion by itself is not a reason to bypass Quality for feature/foundation merges.
