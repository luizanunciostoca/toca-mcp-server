# Branch Cleanup Inventory — 2026-08-17

Status: **AUDITED / DELETION CANDIDATES IDENTIFIED / NO UNIQUE WORK DELETED**

Audit baseline: `main@868c64ac0dcfa4c2b28994198b1a8c9af87f7a7c`.

The branch API returned **245 branches** at the audit snapshot. Branch naming is not sufficient evidence for deletion. This inventory intentionally separates high-confidence cleanup candidates from branches that still require ancestry/equivalence review.

## Current open PR boundary

Authoritative recheck found only one open PR:

- PR #185 — `fix/v1-instagram-direct-publication` — **PRESERVE / ACTIVE FEATURE WORK / OUTSIDE GOVERNANCE CLOSEOUT**.

The repository search index temporarily returned stale Dependabot PR state, but direct REST/recent-PR revalidation corrected that view. No stale index result is used as deletion authority.

## High-confidence cleanup candidates

The following branches are safe **candidates** because their associated PR is merged, explicitly superseded by a merged replacement, or explicitly temporary/diagnostic. Before physical deletion, perform one final head/ancestry check to ensure no commits were added after the recorded PR state.

| Branch                                                   | Evidence / disposition                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `chore/actions-manual-branch-smoke-20260816`             | PR #187 closed unmerged; intentionally temporary manual Actions diagnostic   |
| `chore/foundation-v1-repo-governance`                    | PR #116 merged                                                               |
| `chore/foundation-v1-privileged-workflow-cleanup`        | PR #128 merged                                                               |
| `chore/v1-dependabot-label-fix`                          | PR #177 merged                                                               |
| `docs/v1-governance-final-reconciliation`                | PR #183 merged                                                               |
| `docs/foundation-post-r29-ratification-20260816`         | PR #171 closed; explicitly superseded by #176                                |
| `docs/foundation-post-r29-ratification-final-20260816`   | PR #176 merged                                                               |
| `docs/foundation-production-verified-20260816`           | PR #161 closed; superseded by exact-main proof                               |
| `docs/foundation-slo-production-verified-final-20260816` | PR #168 closed; superseded                                                   |
| `docs/foundation-slo-production-verified-final`          | PR #169 closed; superseded                                                   |
| `docs/foundation-slo-production-verified-final-v2`       | PR #170 merged                                                               |
| `docs/r28-google-ads-operational-closeout-20260816`      | PR #141 closed; explicitly superseded by #142                                |
| `docs/r28-google-ads-operational-closeout-20260816-v2`   | PR #142 merged                                                               |
| `ops/meta-ads-production-validated-final-20260816`       | PR #175 merged                                                               |
| `docs/meta-ads-final-provider-validation-20260816`       | PR #173 merged                                                               |
| `docs/alerts-production-verified-20260816`               | PR #172 merged                                                               |
| `reconcile/r29-video-content-repurposing-current-main`   | PR #144 closed; explicitly superseded by merged #143                         |
| `feat/r29-video-reconciliation-final`                    | PR #143 merged                                                               |
| `ops/telemetry-alerts-iam-revalidation`                  | PR #138 closed unmerged; explicit one-shot diagnostic not intended for merge |
| `feat/r16-privacy-consent-preferences`                   | PR #103 closed; superseded by merged #115                                    |
| `feat/r20-r29-video-content-repurposing`                 | PR #113 closed; superseded                                                   |
| `feat/r20-r29-video-content-repurposing-final`           | PR #114 closed; superseded by merged #143                                    |
| `feat/r28-google-ads-paid-media`                         | PR #109 closed; superseded/reconciled                                        |
| `feat/r28-google-ads-paid-media-final`                   | PR #112 closed; superseded by merged #135 reconciliation                     |
| `feat/measurement-ticketing-attribution-foundation`      | PR #105 closed; superseded by merged final PR #111                           |

These candidates are not deleted by this closeout because the available repository connector does not expose a safe delete-ref operation. Moving a ref is **not** used as a substitute for deletion.

## Preserve / manual-review branches

These branches must not be deleted without additional proof:

- `main` — canonical branch;
- `fix/v1-instagram-direct-publication` — active PR #185;
- `fix/v1-instagram-direct-publication-final` — PR #186 is closed and described as a clean replacement attempt, but equivalence to the active #185 head is not proven by branch name alone;
- `backup/r20-r29-video-content-pre-reconcile` — `backup` is not evidence that unique work is integrated;
- `feat/instagram-first-publication-readiness-gate-backup` — same rule: preserve until unique-commit check;
- `repair/m-found-06-durable-workflows`, `repair2/m-found-06-durable-workflows`, `repair3/m-found-06-final`, `repair4/m-found-06-concurrency` — historical repair chain; requires ancestry/equivalence proof before deletion;
- `controller/m-found-06-merge`, `controller/m-found-07-bootstrap`, `controller/m-found-07-merge` — controller branches may encode merge orchestration/evidence; require exact comparison first;
- any `diag/*` not tied to an explicitly disposable PR/evidence record;
- any `chore/tmp-*` branch not tied to an explicitly disposable PR/evidence record;
- any `reconcile/*` branch not explicitly superseded by a merged replacement;
- any dated `ops/*` branch whose provider/DR/production evidence has not been proven durable in merged documentation or artifacts.

## Pattern inventory requiring review

The snapshot contains substantial historical families, including:

- `chore/tmp-*` publication/OAuth/staging probes;
- `diag/meta-ads-*` provider diagnostics;
- `repair*` Foundation durable-workflow repairs;
- `reconcile/*` Meta Ads, Omnichannel, Privacy, Google Ads and R29 reconciliation heads;
- `backup/*` and `*-backup` branches;
- `controller/*` M-FND orchestration branches;
- many dated `ops/*` provider, IAM, alerts, DR, production and runtime-evidence branches;
- stacked/finalized feature families such as `*-final`, `*-v2`, `*-v3`, `*-clean`.

These patterns are the highest-value cleanup targets, but each branch must still satisfy the safe-delete rule.

## Superseded PR inventory

High-confidence superseded PRs include:

- #171 → #176;
- #169 / #168 → #170;
- #161 → later exact-main Foundation proof;
- #141 → #142;
- #144 → #143;
- #103 → #115;
- #113 / #114 → #143;
- #109 / #112 → #135;
- #105 → #111.

PR #186 is **not** classified as safely superseded for deletion because the currently active feature PR is #185 and the exact relationship between both heads must be reviewed by the Instagram feature closeout before branch cleanup.

## Physical deletion protocol

When a delete-ref-capable path is available, delete only after:

1. revalidate `main` and branch head SHA;
2. confirm no open PR targets the branch;
3. compare branch head against `main` and the recorded replacement/merge commit;
4. confirm no unique unmerged commits or evidence remain;
5. record the deletion batch and exact branch head SHAs;
6. never delete `main` or the active head of an open PR.

This preserves auditability while reducing historical branch noise without sacrificing unique work.
