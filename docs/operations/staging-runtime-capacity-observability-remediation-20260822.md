# Staging Runtime + Capacity + Observability Remediation — 2026-08-22

Scope: internal acceptance remediation only. Production and real external providers remain out of scope.

## Root causes

1. The runtime-observability workflow retained an infrastructure bootstrap phase after the staging resources and operator permissions already existed. That phase authenticated through a production-hosted WIF/administrator even though the acceptance run only needed staging verification.
2. Workflow reruns checked out mutable `main`, while GitHub preserved the original run `GITHUB_SHA`, allowing the evidence manifest to claim a trigger SHA different from the actual checked-out source.
3. Observability success did not independently re-read the active Cloud Run traffic target and bind it to the expected application SHA, immutable image digest and runtime service account.
4. The repository had a PostgreSQL capacity E2E suite but no bounded live staging capacity harness with concurrency percentiles and resource telemetry.

## Remediation

- Removed all production WIF / production infrastructure administrator authentication from staging runtime acceptance.
- Removed runtime IAM mutation from this workflow; it is verification-only against pre-provisioned staging permissions/resources.
- Checkout is pinned to `github.sha`; evidence records `triggerSha` and `actualCheckoutSha` independently and requires them to agree.
- The run now requires `expected_candidate_sha` and `expected_image_digest` and fails closed unless the single 100% traffic revision for both MCP and webhook reports the expected `TOCA_RELEASE_SHA`, immutable digest and runtime service account.
- Existing dashboard and OIDC uptime configuration are read back without mutation.
- Optional controlled capacity sampling uses only authenticated `/readyz`, with fixed concurrency levels 1/5/10/25, 50 requests per level, zero accepted errors, recovery probes after every level, and no destructive stress.
- Capacity evidence records throughput, p50, p95, p99 and error rate, then requires Cloud Run CPU/memory/request telemetry and Cloud SQL PostgreSQL backend-connection telemetry to be observable.
- The workflow performs its own fail-closed boundary assertions before any GCP access. Repository Quality CI separately validates workflow supply-chain and platform-hardening contracts without formatter or test ignores.

## Explicit non-claims

This remediation does not deploy a new application candidate, mutate Cloud Run traffic, read secrets, call real external providers, or promote production. Live execution of the corrected workflow must occur only after Coordination freezes and deploys the next candidate to isolated staging.
