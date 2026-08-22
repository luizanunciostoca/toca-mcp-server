# TOCA OS Next — Final Convergence Evidence Index

Evidence is classified by what it actually proves. Source CI cannot be substituted for provider, staging or production evidence.

## Current source and candidate identity

- live `main`: `4c2ece55a85ce8e596a4b70e60c159fe7862f75d`;
- current main delta: PR #83, staging verification read-only IAM only;
- frozen application candidate: `75c165a044c6e79e9545328dd04a2a3e73d2e910`;
- candidate tree: `2b373b1564e495d81a73ca04254efec18c0e774c`;
- candidate image OCI index digest: `sha256:611a56ea24d1fd838aeae867debedcc87cd5496e35b99c642188c1c93b2d5250`;
- runtime child digest: `sha256:257bd85a460764c2f207445c72a279c772c869a75f48c7bc2c071be2d858bfad`.

PR #83 does not alter the application candidate. It only adds a tightly allowlisted infrastructure control-plane operation granting `roles/cloudsql.viewer` and `roles/monitoring.viewer` to the fixed staging deployer.

## Exact-candidate CI evidence

The frozen application candidate has exact-SHA evidence for:

- Quality Gate: SUCCESS;
- Security Supply Chain: SUCCESS;
- PostgreSQL + tenancy E2E: SUCCESS;
- migration idempotency / no drift: SUCCESS;
- Email provider/runtime source gate: SUCCESS;
- migration max: `033_omnichannel_prepared_content.sql`;
- migration 027: intentionally absent.

This is source/CI evidence only and does not promote provider or production lifecycle state.

## Omnichannel and nurture source state

The previous runtime-composition blocker is closed.

Integrated implementation includes:

- `whatsapp.message.send` over canonical CRM / Privacy / Approval / Core / Audit / Outbox;
- `email.campaign.send` over canonical CRM / Privacy / Approval / Core / Audit / Outbox;
- `email.delivery.readback` and `whatsapp.message.readback`;
- immutable provider-neutral prepared-content authority from migration 033;
- durable follow-up/nurture over the existing WorkflowStore, timers, NextActionRecord, `sales.followup.create` and `sales.followup.schedule`;
- restart-safe timer resume, retry/DLQ and fail-closed uncertain provider outcomes;
- no second CRM, scheduler, workflow, Privacy, Approval, provider abstraction or R33.

Provider verification remains separate and false until real external evidence is recorded.

## Google Ads source state

The previous credential-first runtime composition blocker is closed.

Integrated implementation includes:

- credential-only accessible-customer discovery while `GOOGLE_ADS_PHASE=OFF`;
- target-bound account verification and reads only after customer/guardrails are present;
- provider verification gate implementation;
- no provider write or lifecycle pre-promotion in CI.

Real Google Ads provider evidence is still required before any `PROVIDER_VERIFIED` claim.

## Isolated staging evidence — VERIFIED

The frozen application candidate was deployed and accepted in the isolated staging control plane.

Verified coordinates:

- staging project: `toca-mcp-next-staging`;
- staging project number: `729069789107`;
- production project: `toca-mcp-production`;
- production project number: `990081828836`;
- staging Cloud SQL: `toca-mcp-next-staging-db`;
- staging database secret: `toca-next-staging-database-url`;
- staging MCP service: `toca-mcp-next-staging`;
- staging webhook service: `toca-webhook-next-staging`;
- staging WIF: `projects/729069789107/locations/global/workloadIdentityPools/github-staging/providers/github-toca-mcp-staging`;
- staging deployer: `toca-next-stg-deployer@toca-mcp-next-staging.iam.gserviceaccount.com`;
- staging MCP runtime identity: `toca-next-stg-mcp@toca-mcp-next-staging.iam.gserviceaccount.com`;
- staging webhook runtime identity: `toca-next-stg-webhook@toca-mcp-next-staging.iam.gserviceaccount.com`.

Accepted revisions:

- MCP: `toca-mcp-next-staging-mcp-75c165a-r3` at 100% traffic;
- webhook: `toca-webhook-next-staging-webhook-75c165a-f1` at 100% traffic.

Staging acceptance proved:

- exact source/release identity;
- immutable artifact binding;
- migrations current and idempotent;
- exact migrations in an ephemeral acceptance schema;
- PostgreSQL acceptance contracts;
- CRM / WhatsApp persistence / AG-01 / Attribution / tenant Approval / prepared-content contracts;
- human approval resume across process restart;
- timer resume across process restart;
- authenticated read-only MCP protocol smoke;
- Audit/Outbox settlement restricted to allowlisted synthetic records without provider delivery;
- post-E2E readiness with exact traffic unchanged.

Runtime readiness sampling also recorded 30/30 authenticated `/readyz` HTTP 200 responses with all 16 readiness checks healthy.

`STAGING_VERIFIED=true` is therefore supported for the frozen application candidate.

## Provider evidence — still pending

The staging runtime intentionally keeps provider execution fail-closed.

### WhatsApp

Still required:

- valid provider binding/scopes;
- WABA / Phone Number ID / template evidence;
- controlled approved outbound;
- provider message reference;
- delivery/read callback or authoritative readback;
- Privacy / Approval / Audit / Outbox correlation.

### SendGrid / Email

Still required:

- API key binding;
- sender/domain / SPF / DKIM / DMARC evidence;
- signed Event Webhook binding;
- controlled approved send;
- HTTP 202 / `x-message-id`;
- Email Activity readback and signed delivery/bounce/complaint evidence as applicable;
- Privacy / Approval / Audit / Outbox correlation.

### Google Ads

Still required:

- authenticated accessible-customer discovery;
- selected account / status / currency / billing / permissions readback;
- campaigns / insights / conversion-action reads;
- targeting `validateOnly` evidence;
- controlled `CREATE_PAUSED` only if separately authorized and required, with exact PAUSED readback;
- no activation and no spend merely for verification.

Current lifecycle truth remains `PROVIDER_VERIFIED=false` for these providers.

## Reliability / observability / DR evidence — partial, promotion HOLD

A read-only operational preflight against the frozen staging candidate proved:

- exact Cloud Run runtime identity and 100% traffic: PASS;
- authenticated readiness sampling: PASS;
- production touched: NO;
- external provider calls: NO;
- provider execution remains fail-closed.

At that preflight point, promotion remained on HOLD because:

- Cloud SQL backup listing returned 403 to the staging deployer;
- DR rehearsal was not executed;
- Cloud Monitoring had zero discovered alert policies and zero verified notification channels in that evidence window;
- no alert firing/readback path was executed.

PR #83 is now merged to `main` and adds only the minimum read-only roles required to remove the Cloud SQL backup and Monitoring read blockers. A post-PR-83 read-only rerun is still required before those items can be promoted to PASS.

## Production evidence — missing

No production rollout of the Next candidate is authorized or claimed by this index.

Required before `PRODUCTION_VERIFIED` or final closeout:

- explicit production authorization;
- same candidate/source identity and immutable image digest;
- production Cloud Run revision/service readback;
- applied migration readback;
- authenticated health/readiness;
- production smoke for Core / Approval / Audit / Outbox / CRM / AG-01;
- separately authorized provider evidence where applicable;
- SLO / alert delivery evidence;
- rollback evidence;
- DR / backup / PITR / recovery evidence for the final candidate.

Current status: **NOT VERIFIED**.

## Evidence anti-inflation rules

The following never promote a provider or production lifecycle state on their own:

- source code presence;
- capability catalog row;
- registry status;
- mocked/provider-shaped fixture;
- unit/integration test;
- Quality/Security/PostgreSQL CI;
- configured environment-variable name;
- Secret Manager secret ID without access/readback proof;
- a provider-verification flag set before the evidence it claims to represent.
