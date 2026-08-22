# TOCA OS Next — Final Convergence Evidence Index

Evidence is classified by what it actually proves. Source CI cannot be substituted for provider, staging or production evidence.

## Frozen candidate and control-plane identity

The application/runtime candidate remains frozen independently from later reliability control-plane changes:

- frozen application candidate: `75c165a044c6e79e9545328dd04a2a3e73d2e910`;
- candidate tree: `2b373b1564e495d81a73ca04254efec18c0e774c`;
- candidate image OCI index digest: `sha256:611a56ea24d1fd838aeae867debedcc87cd5496e35b99c642188c1c93b2d5250`;
- runtime child digest: `sha256:257bd85a460764c2f207445c72a279c772c869a75f48c7bc2c071be2d858bfad`.

Reliability/control-plane reconciliation observed repository `main` at `bdae307da33b8d4b8341b06d868d7a274724630f` after PR #87. PRs #83-#87 are staging IAM, evidence/documentation, and observability control-plane deltas; they do not replace the frozen application candidate or its accepted runtime revisions.

A static evidence index must not be treated as a mutable `main` pointer. Any operation must resolve repository `main` again at execution time and must preserve the frozen application candidate identity unless an application/runtime change explicitly causes a new candidate freeze and staging cycle.

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

## Reliability / observability / DR evidence — live read-only prerequisites PASS, promotion HOLD

Read-only Reliability run `32542355213` against the frozen staging candidate closed the original Cloud SQL backup/PITR and Cloud Monitoring read blockers.

Proven by that run:

- exact accepted MCP/webhook revisions serving 100% traffic: PASS;
- authenticated readiness sampling: PASS;
- Cloud SQL state/read authority: PASS;
- automated backups enabled: PASS;
- PITR enabled: PASS;
- transaction-log retention `>=7d`: PASS;
- retained backups `>=7`: PASS;
- backup inventory authorization/readback: PASS;
- latest successful backup: `2026-08-21T17:20:36.918Z`;
- backup age at readback: `27879s`, below the `36h` objective: PASS;
- Cloud Monitoring alert-policy read: HTTP 200;
- Cloud Monitoring notification-channel read: HTTP 200;
- Cloud Monitoring uptime-check read: HTTP 200;
- Cloud Monitoring dashboard read: HTTP 200;
- production mutation: NO;
- provider call/mutation: NO.

The same readback found the staging Monitoring project empty at that evidence window:

- alert policy count: `0`;
- enabled notification channel count: `0`;
- notification channel family count: `0`;
- uptime check count: `0`;
- dashboard count: `0`.

PR #86 introduced the governed staging notification-channel bootstrap. Its first live attempt failed with HTTP 403 because it authenticated the production infrastructure administrator against the staging Monitoring API. PR #87 (`bdae307da33b8d4b8341b06d868d7a274724630f`) fixes that exact blocker by granting only `roles/monitoring.notificationChannelEditor` to the isolated staging operator and re-authenticating through staging WIF before notification-channel creation/readback.

PR #87 source/CI does **not** prove the post-fix channel reconciliation. The next live operation must rerun `Staging Notification Channels` and prove:

- two enabled channels;
- two independent channel families (`email` + `webhook_tokenauth`);
- email verification complete;
- sanitized channel readback;
- production/provider/DB/backup/traffic/DR mutation remains false.

After notification channels are ready, Reliability still requires:

1. managed alert-policy/dashboard/synthetic configuration readback from the canonical `infra/observability` contracts;
2. a non-destructive synthetic signal that opens the intended Cloud Monitoring incident;
3. incident/policy readback plus delivery evidence for the configured channel families and runbook correlation;
4. synthetic condition cleanup and incident recovery/closure readback;
5. an isolated backup/PITR drill for the frozen candidate, including migration 033 / `omnichannel_prepared_content`, AG-01, Workflow/timers, CRM, Outbox/DLQ, Approval/Privacy/Audit and provider revalidation prerequisites;
6. measured PITR RPO `<=15m` and PostgreSQL recovery RTO `<=60m`;
7. isolated-drill cleanup and production-unchanged readback.

Until those live proofs exist, `RELIABILITY_VERIFIED` remains false. Historical V1 alert/DR evidence may establish provider capability/history, but it cannot substitute for exact-candidate Next recovery evidence where the recovery surface changed.

## Metric contract note — provider-gated WhatsApp signal

The frozen application candidate declares its formal future-provider WhatsApp SLO as `whatsapp.delivery_verified_ratio`, while the staging dashboard/alert contract names the provider readback SLI `whatsapp.readback_verified_ratio`. Because WhatsApp remains provider-disabled/unverified for the frozen candidate, this naming drift does not promote or invalidate current Core staging evidence, but it must not be silently normalized in a way that changes the frozen application SHA.

Canonicalization is therefore an explicit post-candidate application change: update the formal catalog/test and then freeze/revalidate a new candidate before treating the renamed signal as exact-release runtime evidence. The current release must preserve the frozen candidate and record the provider-gated mismatch transparently.

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
