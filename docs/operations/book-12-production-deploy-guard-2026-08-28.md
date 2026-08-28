# TOCA OS — Livro 12 production deployment guard

Date: `2026-08-28`  
Scope: `Livro 12 — Tecnologia e Automações`  
Status: **FAIL-CLOSED REMEDIATION**

## Finding

Post-merge validation of Livro 12 identified that `.github/workflows/deploy-toca-managed-instagram-daemon-gcp.yml` still accepted ordinary `push` events on `main` for production deployment. That contract was inconsistent with the Livro 12 acceptance rule that relevant production side effects require explicit authorization and evidence.

The push created by merge commit `80c98c95f34e86801034699403845335f4a88ae6` started workflow run `33142465821`.

## Containment evidence

The automatic workflow was cancelled before the production mutation stages could execute:

- `migrate-production`: **CANCELLED before steps**;
- `provision-minute-trigger`: **CANCELLED before steps**;
- `deploy-runtime`: **CANCELLED before steps**;
- `verify-minute-trigger`: **CANCELLED before steps**.

The preliminary job completed quality checks, authenticated to GCP and pushed an immutable candidate image to Artifact Registry before cancellation. No Cloud SQL migration, Cloud Scheduler mutation, Cloud Run service deployment or smoke tick was executed by this run.

The image push is retained as audit evidence and does not by itself promote runtime/provider readiness or authorize traffic.

## Permanent remediation

Production deployment is changed from automatic `push` execution to explicit `workflow_dispatch` only.

The first authenticated job is additionally gated by both:

- `confirm_production == DEPLOY_PRODUCTION`;
- a non-empty `authorization_ref`.

If either condition is absent, the production deployment chain cannot start.

A regression test in `test/production-deploy-authorization.test.ts` asserts that:

1. the workflow contains `workflow_dispatch`;
2. it does not contain a top-level `push` trigger;
3. explicit production confirmation exists;
4. an authorization reference is required.

## Operational rule

A merge to `main` is not production authorization. CI success is not production authorization. Provider evidence from a previous publication is not production infrastructure authorization.

A production deployment requires an explicit manual dispatch plus its authorization reference. Any future mechanism that reintroduces `push -> production` must fail the regression contract and be treated as a Livro 12 safety regression.
