# TOCA OS Next — Final Convergence Evidence Index

Evidence is classified by what it actually proves. Source CI cannot be substituted for provider, staging or production evidence.

## Frozen candidate and control-plane identity

The application/runtime candidate remains frozen independently from later reliability control-plane changes:

- frozen application candidate: `75c165a044c6e79e9545328dd04a2a3e73d2e910`;
- candidate tree: `2b373b1564e495d81a73ca04254efec18c0e774c`;
- candidate image OCI index digest: `sha256:611a56ea24d1fd838aeae867debedcc87cd5496e35b99c642188c1c93b2d5250`;
- runtime child digest: `sha256:257bd85a460764c2f207445c72a279c772c869a75f48c7bc2c071be2d858bfad`.

Final staging Reliability reconciliation revalidated repository `main` at `4ef5d7447f5820eea0e73267f7baab3e5dbf07d5`. Reliability/control-plane changes after the application freeze do not replace the frozen application candidate or its accepted runtime revisions.

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

A live GET-only provider read confirmed that provider identity access was sufficient to inspect business data, but the required `whatsapp_business_management` and `whatsapp_business_messaging` scopes remain absent. Provider verification therefore remains blocked before WABA / Phone Number ID / template enumeration and any controlled approved outbound.

Still required:

- valid provider binding and required scopes;
- WABA / Phone Number ID / template evidence;
- controlled approved outbound;
- provider message reference;
- delivery/read callback or authoritative readback;
- Privacy / Approval / Audit / Outbox correlation.

### SendGrid / Email

The runtime implementation exists, but real provider binding and administrative sender/domain/webhook evidence remain unproven.

Still required:

- API key binding;
- sender/domain / SPF / DKIM / DMARC evidence;
- signed Event Webhook binding;
- controlled approved send;
- HTTP 202 / `x-message-id`;
- Email Activity readback and signed delivery/bounce/complaint evidence as applicable;
- Privacy / Approval / Audit / Outbox correlation.

### Google Ads

The provider gate remains fail-closed because the required live administrative credential/account configuration has not yet been proven for the verification environment. `GOOGLE_ADS_PHASE=OFF` remains required until a controlled provider-verification sequence is authorized and passes.

Still required:

- authenticated accessible-customer discovery;
- selected account / status / currency / billing / permissions readback;
- campaigns / insights / conversion-action reads;
- targeting `validateOnly` evidence;
- controlled `CREATE_PAUSED` only if separately authorized and required, with exact PAUSED readback;
- no activation and no spend merely for verification.

Current lifecycle truth remains `PROVIDER_VERIFIED=false` for these providers.

## Reliability / observability / DR evidence — VERIFIED IN ISOLATED STAGING

The frozen candidate now has live Reliability evidence for runtime observability, alert delivery/recovery and final-candidate isolated recovery.

### Runtime observability and alert lifecycle

Live evidence already established:

- exact accepted MCP/webhook revisions serving 100% staging traffic;
- authenticated readiness sampling;
- Cloud SQL backup/PITR configuration readback;
- dashboard and authenticated private-webhook OIDC uptime evidence;
- two staging notification channel families: email + token-authenticated webhook;
- non-destructive synthetic alert firing;
- positive email recipient delivery;
- positive webhook receiver-side receipt;
- policy/channel/runbook correlation;
- automatic synthetic incident recovery/closure without manual incident close;
- no production/provider/DB/backup/traffic mutation during the observability evidence cycle.

Runtime observability run:

- run ID: `32563386689`;
- true `check_passed` points: `101`;
- false points: `0`;
- artifact ID: `9473430379`;
- artifact SHA-256: `4a426268cff5556085b90c6abf6f49d6ac99633d531a16f135ae50125ca63b0d`.

Synthetic alert run:

- run ID: `32563070906`;
- incident ID: `0.obqbjhmrmmv8`;
- automatic incident close observed: `2026-08-22T09:21:30Z`;
- manual incident close executed: `false`.

### Final-candidate isolated DR

Authorized staging DR V14:

- run ID: `32583241943`;
- harness head: `3914c46aadb5eac321c2ec02761914b59d8858c8`;
- final gate: `AUTHORIZED_STAGING_DR_LP_V14=PASS`;
- artifact ID: `9478540826`;
- artifact SHA-256: `725049314a3e12123c3dbdbcb60791c608e592e5ecb90f05e1df87e2266c47d1`.

Measured recovery:

- provider latest recovery lag: `16s`;
- RPO: `46s` against objective `<=900s`: PASS;
- restore start to target `RUNNABLE`: `450s`;
- full PostgreSQL recovery/validation RTO: `737s` against objective `<=3600s`: PASS;
- migration max: `033_omnichannel_prepared_content.sql`;
- migration 027: absent as required;
- critical tables validated: `28`;
- audit ledger head mismatch count: `0`.

The restored surface covered canonical Workflow/timers, Approval, Outbox, Audit, Privacy, CRM, AG-01, Email, WhatsApp and prepared-content state. The clone-only application-table-owner path completed without changing grants.

Cleanup proof:

- temporary PITR target removed: PASS;
- source staging instance unchanged: PASS;
- temporary DR identity/IAM removed: PASS;
- final IAM cleanup: PASS.

The sanitized manifest explicitly records:

- production mutation: NO;
- provider mutation: NO;
- traffic mutation: NO;
- Cloud Run mutation: NO;
- Secret Manager read: NO;
- Secret Manager mutation: NO.

Canonical sanitized evidence is recorded in `docs/operations/next-staging-dr-evidence-20260822.md`.

For the frozen candidate in isolated staging:

- `STAGING_VERIFIED=true`;
- `DR_VERIFIED=true`;
- `RELIABILITY_VERIFIED=true`.

This does not imply provider or production verification.

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
