# Marketing Autopilot publication pipeline — GCP single-writer orchestration

Status: **CANARY**.

The Marketing Autopilot scheduler is an orchestration layer only. It has no Meta credential, no Cloud Run publication command and no provider write authority.

## Canonical flow

`Content Registry / editorial calendar → Marketing Autopilot eligibility gate → fresh ephemeral execution envelope on protected main → Marketing Publish Now → WIF → immutable Artifact Registry image digest → Cloud Run Job → Secret Manager → Meta / Instagram → provider readback → Cloud SQL idempotency audit → Content Registry reconciliation`.

The only provider writer is `.github/workflows/marketing-publish-now.yml` using transport `gcp-instagram-publish-now`.

GitHub-native publication remains `SHADOW_READ_ONLY`. The historical TOCA-managed PostgreSQL/Cloud Run publication executor and its per-content jobs remain retired for publication authority; the physical managed daemon may continue only for separately governed engagement duties.

## Scheduler responsibilities

`.github/workflows/marketing-autopilot-publication.yml` may only:

1. read the canonical Content Registry;
2. enforce America/Bahia scheduling and the bounded window;
3. require `PRODUCED`, `APPROVED`, `EXPLICIT_APPROVAL`, a final master, exact SHA-256, Creative Truth PASS, rights clearance and the exact Instagram account;
4. reject any item with `publication_id` or `provider_external_id` already present;
5. wait until the exact scheduled time without provider access;
6. reject duplicate, completed, in-flight or ambiguous prior writer attempts;
7. dispatch the canonical `Marketing Publish Now` workflow;
8. persist scheduler evidence.

It must never call Meta directly, enable Instagram publication writes, deploy or execute a publication Cloud Run Job, use the GitHub-native provider write surface, or implement an automatic fallback.

## Ephemeral command model

Normal scheduled operation keeps `control/marketing-publish-now-command.json` durably at `NOOP`.

At the due time, the canonical writer authenticates through WIF, re-reads the Content Registry, combines the exact registry row with a protected CANARY binding in `control/marketing-autopilot-scheduler-policy.json`, and creates a fresh `PUBLISH_NOW` envelope only inside the GitHub Actions runner. That envelope receives a fresh `issuedAt`, the exact protected-main `targetCodeSha` and a GCP-specific idempotency key. It is never committed to `main` and disappears with the runner.

This is the fail-closed equivalent of returning a temporary durable command to `NOOP`, while eliminating stale command replay on `main`.

## Execution and reconciliation gates

Before provider execution, `Marketing Publish Now` revalidates the Content Registry after binding the checkout to the audited code SHA, downloads the exact Drive file with authenticated Drive access, recalculates SHA-256 and verifies Creative Truth/brand/rights bindings.

The hardened writer enables publication only for the single execution attempt, disables writes immediately after the attempt, performs provider readback and verifies writes remain disabled. Only a verified `PUBLISHED` result with provider publication ID, successful provider readback and final write-disable may be reconciled to the Content Registry.

Ambiguity becomes `RECONCILIATION_REQUIRED`. Blind retry is prohibited.

## CANARY rollout

The initial allowlist contains only `MKT-20260917-SUNSET-FEED-0900`, scheduled for `2026-09-17T09:00:00-03:00` in `America/Bahia`.

The CANARY policy does not authorize GENERAL autonomy. Promotion must be gradual (`CANARY → LIMITED → REPEATED VERIFIED OPERATION`) and requires verified real operations; no single successful publication promotes the system automatically.
