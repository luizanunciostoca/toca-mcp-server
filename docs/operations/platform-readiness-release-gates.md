# TOCA OS Next — Final Platform Readiness Release Gates

Status: **IMPLEMENTED CONTRACT / STAGING EVIDENCE REQUIRED**

This document is a release handoff for the replacement of historical PR #42. It does not promote provider, staging or production verification state.

## Staging mutation gate

Before any staging migration or mutable deployment, the deployment preflight must prove that the staging GCP project, Cloud SQL instance, database secret, MCP/Core service, webhook service, WIF provider, deploy identity and runtime identities are isolated from production. Staging providers must be explicitly `DISABLED` or isolated with evidence and project-local secret references.

If any isolation assertion cannot be read back, the mutable operation is aborted.

## Candidate promotion gate

A candidate release records the exact source SHA and resolved image digest, deploys MCP/Core and webhook candidates with no traffic, applies migrations before traffic, and requires `/healthz` plus `/readyz` evidence before promotion. The public webhook service must keep `MCP_ENABLED=false` and expose only the governed webhook/health surface.

## Evidence package minimum

The staging package must contain source SHA, image digest, Cloud Run revisions, migration list, health/readiness results, safe E2E boundary checks, provider states, Audit refs, Outbox refs, Workflow/Privacy state, alert evidence, DR evidence and known rollback targets. Secret values are never evidence payloads.

## Production gate

Production rollout is blocked until staging evidence is approved and the coordinator explicitly authorizes production based on repository reality. `PROVIDER_VERIFIED`, `STAGING_VERIFIED` and `PRODUCTION_VERIFIED` are evidence states, not configuration flags, and must never be inferred from implementation alone.

Rollback is application-revision rollback only when the selected revision is compatible with the migrated schema. Destructive production restore is not a release-validation technique; DR proof uses staging or another isolated target.
