# TOCA OS Next — Final Convergence Evidence Index

Evidence is classified by what it actually proves. Source CI cannot be substituted for provider, staging or production evidence.

## Current live source identity

- `main`: `ec8a8e6a2eed9eba1181bc2c32fbcc8fed93845d`
- merge: PR #55
- PR #55 exact source head: `c3791176195edd392890fa02dbd93209b7bc785e`
- parent before #55: `7e1fa75ab6ca08aeb10c81f373c76c08b8376ffb`

## PR #55 — Platform Readiness source evidence

Scope proven: source-level readiness/deploy/observability/SLO/DR implementation on its exact head.

- Quality Gate: SUCCESS.
- Security Supply Chain: SUCCESS.
- Email Provider Gate: SUCCESS.
- PostgreSQL E2E: **NO #55 RUN** because the permanent PG workflow path filters do not include the readiness/HTTP/policy-only changed-file set.

Not proven by this evidence:

- actual staging project/database/secret/service/identity separation;
- successful staging migrations;
- deployed image digest/revision;
- provider credentials;
- provider reads/writes/readbacks;
- production deployment;
- alert delivery or DR recovery on the final candidate.

## PostgreSQL permanent matrix

Permanent workflow: `.github/workflows/m-found-12-postgres-e2e.yml`.

When triggered, it provisions PostgreSQL 18, applies real repository migrations, runs integrated restart/outbox/audit + CRM + WhatsApp + Video/R29 + Demand + R31 + AG-01 + Attribution + Asset + tenant Approval isolation E2E, then runs migrations a second time to detect drift.

The coordinator records a PG state as PASS only when a run exists for the exact code head that requires that gate.

## Provider onboarding source evidence

PR #54 is integrated into `main` and provides credential-discovery implementation for Google Ads/SendGrid/WhatsApp. This is implementation/CI evidence only.

Google Ads provider evidence currently required and not recorded here:

- accessible customer discovery against live credentials;
- provider request ID where available;
- selected customer/account readback;
- account status/currency/billing/permission readback;
- controlled approved create-paused if required by verification policy;
- authoritative paused-state readback;
- ApprovalRecord;
- Audit/Outbox evidence;
- rollback/cleanup evidence.

`PROVIDER_VERIFIED=false` and `PRODUCTION_VERIFIED=false` remain the truthful state for this closeout-prep snapshot.

## Omnichannel source evidence

Current source contains real Email and WhatsApp provider engines plus canonical CRM/Privacy integration behavior. This proves implementation exists, not that outbound capabilities are currently executable through the canonical Core surface.

The current omnichannel manifest is direct negative evidence for completion: WhatsApp/Email/Nurture capability specs remain `SPECIFIED`, `runtimeExposed=false`, and `productionExecutionAllowed=false`.

Provider evidence still required separately for Email and WhatsApp:

- real provider identity/account/domain/WABA/phone/template binding;
- required scopes/permissions;
- controlled approved outbound;
- provider message reference;
- delivery/read/readback callback as applicable;
- Privacy reconciliation for suppression/opt-out signals;
- Audit/Outbox/Approval evidence;
- retry/uncertain-outcome evidence where part of acceptance.

No provider promotion is made by this document.

## Canonical TOCA_OS evidence

Current Drive catalog/routing observations:

- R28 now includes Google Ads and Meta Ads under a provider-neutral Paid Media controlled lifecycle.
- Google Ads capability rows exist for credential discovery, verification, inspection, list/insights, prepare/targeting, create-paused, readback and manage operations.
- lifecycle remains implementation-level; provider/production verification fields are not promoted by catalog presence.

This resolves an old governance drift but is not runtime or provider evidence by itself.

## Staging evidence — missing

Required before any claim of `STAGING_VERIFIED`:

- candidate source SHA;
- immutable image digest;
- staging Cloud Run revisions/services;
- staging project ID/number and proof distinct from production;
- staging Cloud SQL and proof distinct from production;
- staging database secret and proof distinct from production;
- distinct runtime/deploy identities and WIF;
- migration execution/readback;
- `/healthz` and `/readyz` evidence;
- tenant isolation;
- Approval/Audit/Outbox/CRM/AG-01 acceptance;
- provider-disabled/isolated-mode evidence;
- scenario-specific request/readback evidence.

Current status: **NOT VERIFIED**.

## Production evidence — missing

Required before any claim of `PRODUCTION_VERIFIED` or final closeout:

- source SHA actually deployed;
- image URI + digest;
- Cloud Run revision/service;
- applied migrations;
- production authorization reference;
- staging evidence reference for same candidate;
- provider/account read evidence;
- each controlled side effect and approver/ApprovalRecord;
- provider request/resource/message references;
- authoritative readback;
- Audit + Outbox evidence;
- SLO/alert evidence;
- rollback evidence;
- DR/backup/PITR/recovery evidence.

Current status: **NOT VERIFIED**.

## Evidence anti-inflation rules

The following never promote a provider or production lifecycle state on their own:

- source code presence;
- capability catalog row;
- registry status;
- mocked/provider-shaped test fixture;
- unit/integration test;
- Quality/Security/PG CI;
- configured environment variable name;
- Secret Manager secret ID without access/readback proof;
- a provider verification flag set before the evidence it claims to represent.
