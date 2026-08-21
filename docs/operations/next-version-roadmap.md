# TOCA OS Next — Roadmap to Final Closeout

Status: **CLOSEOUT_PENDING_PRODUCTION_EVIDENCE**

Technical baseline: `main@ec8a8e6a2eed9eba1181bc2c32fbcc8fed93845d`.

## 1. Readiness source is integrated

PR #55 replaced #42 and is merged.

Final #55 head `c3791176195edd392890fa02dbd93209b7bc785e` has successful:

- Quality `32439330910` (job `96646716691`: Format/Architecture/Lint/Typecheck/Test/Build all PASS);
- Security `32439330928`;
- Email Provider Gate `32439330916`.

Merge commit: `ec8a8e6a2eed9eba1181bc2c32fbcc8fed93845d`.

This establishes `CI_VERIFIED` for the #55 readiness source scope only. Production was not executed by #55.

## 2. Prove isolated staging before mutation

Before any mutable migration/deploy, prove:

- staging project != production project;
- staging Cloud SQL/database != production;
- staging DB secret != production DB secret;
- staging service/revision namespaces separate;
- staging WIF/deploy/runtime identities explicit and separate;
- no absent staging config falls back to production.

If any proof is missing, abort mutable staging work.

## 3. Run staging acceptance against exact source/image/revisions

Capture exact source SHA, immutable image digest, MCP/Core + webhook revisions, migrations/schema, `/healthz`, `/readyz`, tenant isolation, Audit, Outbox, ApprovalStore, Privacy, CRM, Workflow and AG-01.

Acceptance must include AG-01 -> route -> Core, Approval wait/approve/resume, WhatsApp inbound, controlled outbound only when provider prerequisites are real, Email delivery/bounce only when governed, social inbound, nurture restart, privacy revocation/suppression, provider-disabled readiness and provider-enabled readiness only for providers actually configured.

Only then can the exact staging deployment become `STAGING_VERIFIED`.

## 4. Resolve canonical route drift

Stable Drive reconciliation already completed:

- R28 -> provider-neutral `PAID_MEDIA_CONTROLLED_LIFECYCLE`;
- 7 `paid_media.*` + 15 `google_ads.*` catalog rows aligned with runtime without provider promotion;
- R28 routing registry aligned to Meta/Google provider selection, paused-first, Approval and readback;
- 7 runtime-backed Sales rows aligned; catalog-only Sales remain PLANNED.

Open route blocker:

- Drive R30 = `SOCIAL_ENGAGEMENT_LIFECYCLE`, AG-08;
- source formal Email/WhatsApp specs map to R30;
- formal specs are `runtimeExposed=false`.

Do not repurpose canonical R30 or add fake transport rows. Correct the route authority before final flattening of those formal capabilities.

## 5. Provider verification

### Google Ads

Gate: `OFF -> READ_ONLY -> PREPARE -> CREATE_PAUSED -> READBACK -> MANAGE`.

Capture effective non-secret credential/customer identity, real provider request IDs, billing/permission/account readback, Approval for controlled writes, resource ID, independent PAUSED readback, Audit/Outbox/idempotency. `MANAGE` is separate. Never activate merely to manufacture evidence.

### WhatsApp

Capture final Business/WABA/Phone/scopes, signed webhook evidence, controlled recipient, fresh Privacy eligibility, ApprovalRecord, provider message ID/status, Audit/Outbox. #54 discovery support is configuration evidence, not send verification.

### Email / SendGrid

Capture sender/domain, authentication/DNS where applicable, selected signed Event Webhook identity/key, controlled inbox, Privacy/suppression eligibility, ApprovalRecord, provider message ID and delivery/bounce readback, Audit/Outbox. #54 discovery support is configuration evidence, not delivery verification.

### Commerce

Do not create a provider capability merely to clear a tracker. First prove active provider identity, official machine readback contract and least-privilege credentials. Revenue/WON remains fail-closed to authoritative TICKETING/CHECKOUT/PAYMENT/ORDER evidence.

## 6. Reliability / SLO / DR

Using #55 contracts on the exact staging/production deployment, capture SLIs/SLOs for AG-01, Core, Approval, Email, WhatsApp, provider latency/errors, CRM, Outbox, Workflow retries/DLQ, Commerce readback, Google and Meta.

Alerts require policy IDs/readback, real or safe synthetic firing, notification delivery/readback and runbook correlation. DR requires backup/PITR plus isolated restore/recovery drill and measured RPO/RTO. Do not restore production destructively only to obtain evidence.

## 7. Production validation

Before `PRODUCTION_VERIFIED`, capture exact:

- production source SHA;
- immutable image digest;
- Cloud Run services/revisions;
- migration set/result;
- readiness;
- tenant isolation;
- effective provider states;
- provider request/resource IDs for promoted scopes;
- ApprovalRecord/Audit/Outbox refs;
- SLO/alert/DR refs;
- rollback source/revision/execution/readback.

## 8. Final TOCA_OS reconciliation and PR #17 replacement

Only after production validation:

1. reread final main and open PRs;
2. reread final TOCA_OS manuals, capability catalog and routing registry;
3. fully flatten every final capability/route with exact evidence fields;
4. rebuild the five central artifacts plus canonical-state/final-closeout docs;
5. open a clean replacement PR for #17 from final main;
6. require exact-head hosted CI on that replacement;
7. only then mark #17 superseded/close it without merging its historical branch.

Until then: **CLOSEOUT_PENDING_PRODUCTION_EVIDENCE**.
