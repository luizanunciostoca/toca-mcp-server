# TOCA OS Next — Evidence Index

Snapshot: 2026-08-20

Global classification: **CLOSEOUT_PENDING_PRODUCTION_EVIDENCE**

Every claim is scoped to the exact source/environment/provider operation named below. Historical evidence is never silently inherited by a later source.

## Evidence rules

Valid final refs include commit SHA, workflow run/job/artifact, image digest, Cloud Run service/revision, migration result, provider request/resource ID, ApprovalRecord, Audit, Outbox, alert/notification, backup/PITR and rollback execution/readback.

Implementation/configuration/CI never substitutes for provider/staging/production evidence.

## Source evidence

| Ref | Type | Exact value | Supports |
| --- | --- | --- | --- |
| `SRC-MAIN-PREP-002` | main commit | `ec8a8e6a2eed9eba1181bc2c32fbcc8fed93845d` | current post-readiness implementation baseline |
| `SRC-PROVIDER-ONBOARD-001` | merged #54 commit | `7e1fa75ab6ca08aeb10c81f373c76c08b8376ffb` | credential-first/fail-closed provider discovery implementation |
| `SRC-READINESS-HEAD-001` | #55 final head | `c3791176195edd392890fa02dbd93209b7bc785e` | exact source scope for hosted CI |
| `SRC-READINESS-MERGE-001` | #55 merge commit | `ec8a8e6a2eed9eba1181bc2c32fbcc8fed93845d` | readiness integrated into main |
| `SRC-WA-INBOUND-001` | merged #53 head | `b652b86048cf79b4de6016291e2f5b568a7ea4f3` | WhatsApp inbound implementation history only |
| `SRC-READINESS-PR42-HIST-001` | legacy PR | `#42` | historical readiness branch; superseded for coordination |
| `SRC-GADS-AUDIT-HIST-001` | audit PR | `#46 / 92c9dfd294e1cafad855068e41a7065572b0e2db` | historical blocker evidence only |
| `SRC-COORD-HIST-001` | coordinator PR | `#17 / bc7e129eb89f39a7d7066b2938a21a45cfde1640` | historical only; do not merge as final control plane |

## #55 exact-head CI evidence

| Ref | Exact evidence | Result | Scope |
| --- | --- | --- | --- |
| `CI-READINESS-Q-001` | Quality run `32439330910` | SUCCESS | #55 final head |
| `CI-READINESS-QJOB-001` | job `96646716691` | workflow verification, hardening contracts, Format, Architecture, Lint, Typecheck, Test, Build all SUCCESS | #55 final head |
| `CI-READINESS-SEC-001` | Security run `32439330928` | SUCCESS | #55 final head |
| `CI-READINESS-EMAIL-001` | Email Provider Gate `32439330916` | SUCCESS | #55 final head |
| `MERGE-READINESS-001` | merge `ec8a8e6a2eed9eba1181bc2c32fbcc8fed93845d` | merged | current main |

Supported state: #55 readiness source scope = **CI_VERIFIED**.

Not supported by these refs: `STAGING_VERIFIED`, provider verification, or `PRODUCTION_VERIFIED`. PR #55 explicitly states production was not executed or declared verified.

## Current source contracts

| Ref | Path on current main | Meaning |
| --- | --- | --- |
| `CODE-REGISTRY-001` | `src/registry.ts` | ToolRegistry declarations/gates |
| `CODE-GADS-CLIENT-001` | `src/providers/google-ads/google-ads-api-client.ts` | accessible-customer discovery, customer-bound calls, request-id capture |
| `CODE-SENDGRID-DISCOVERY-001` | `src/providers/sendgrid/event-webhook-discovery.ts` | official signed webhook discovery, ambiguity fail-closed |
| `CODE-WA-DISCOVERY-001` | `src/providers/whatsapp/whatsapp-asset-discovery.ts` | Business/WABA/Phone discovery, ambiguity fail-closed |
| `CODE-OMNI-SPEC-001` | `src/omnichannel/capability-specs.ts` | Email/WhatsApp/Nurture specs; transport mapped to R30; runtimeExposed=false |
| `CODE-EMAIL-ORCH-001` | `src/omnichannel/email-orchestrator.ts` | internal Privacy/Approval/idempotency/send/readback coordinator |
| `CODE-EMAIL-RUNTIME-001` | `src/omnichannel/email-runtime.ts` | canonical CRM threading/provider event persistence |
| `CODE-CRM-001` | `src/crm/runtime.ts` | seven runtime-backed Sales capabilities |
| `CODE-CONTENT-001` | `src/content/capability-contracts.ts` | video/content contracts |
| `CODE-READINESS-001` | `src/health/runtime-readiness.ts`, `.github/workflows/deploy-gcp.yml`, #55 operational contracts | fail-closed readiness/deployment contract implementation |

## Drive evidence

### Capability catalog

Spreadsheet `18IZgArLKFA7WgnhdJ9i9MleJknxwzeIJQQ_q1l4HLj4`.

| Ref | Exact readback | Supports |
| --- | --- | --- |
| `DRIVE-R28-001` | `ROUTES!A29:J29` -> R28 `PAID_MEDIA_CONTROLLED_LIFECYCLE`, count 79 | canonical Paid Media route |
| `DRIVE-R30-001` | `ROUTES!A31:K31` -> R30 `SOCIAL_ENGAGEMENT_LIFECYCLE`, AG-08, count 25 | canonical R30 / route conflict evidence |
| `DRIVE-R10-001` | `ROUTES!A11:K11` -> R10 `COMERCIAL_PARCERIAS`, AG-10, count 19 | canonical R10 |
| `DRIVE-R28-PAIDMEDIA-001` | `CAPABILITIES!A747:V753` | 7 `paid_media.*` IMPLEMENTED |
| `DRIVE-R28-GADS-001` | `CAPABILITIES!A754:V768` | 15 `google_ads.*` IMPLEMENTED, phase-gated/default OFF, provider not verified |
| `DRIVE-CRM-001` | `CAPABILITIES!A643:V657` | runtime-backed Sales reconciled; unbound Sales remain PLANNED |
| `DRIVE-R28-COUNT-001` | R28 search -> 79 capability rows | count cross-check |

### Routing registry

Spreadsheet `1vnSliJe2duw278DPPdiTylXUooOdzYtVa0nXD24LEtU`.

| Ref | Exact readback | Supports |
| --- | --- | --- |
| `DRIVE-ROUTING-R28-001` | `ROUTING_REGISTRY!A29:V29` -> provider-neutral Paid Media, Meta/Google selection, paused-first, Approval, readback, financial guardrails | R28 routing reconciliation |

Drive writes did not promote provider state, replace the master manual, invent Commerce identities or insert Email/WhatsApp transport rows into conflicting R30.

## Google Ads ledger

Current state: **BOUND_PROVIDER_DISABLED**.

Supported by current source + `DRIVE-R28-GADS-001` + `DRIVE-ROUTING-R28-001`.

Still PENDING: effective non-secret credentials/customer, real request ID, billing/permission/account readback, controlled Approval/write resource if applicable, independent PAUSED readback, Audit/Outbox/idempotency, exact staging/production refs. No activation was executed merely for evidence.

## Omnichannel ledger

### Route authority

`DRIVE-R30-001` + `CODE-OMNI-SPEC-001` prove **ROUTE_ID_CONFLICT**: Drive R30 is Social Engagement/AG-08 while formal Email/WhatsApp specs use R30 in source. Formal transport specs remain `REGISTERED_NOT_BOUND` and are not inserted into Drive R30.

### WhatsApp

Inbound canonical composition = `IMPLEMENTED`; formal transport = `REGISTERED_NOT_BOUND`; outbound provider verification = not promoted.

Missing: target-environment Business/WABA/Phone/scopes, signed webhook, approved recipient, fresh Privacy eligibility, ApprovalRecord, provider message ID/status, Audit/Outbox, staging/production refs.

### Email / SendGrid

Formal surface = `REGISTERED_NOT_BOUND`; internal runtime = `IMPLEMENTED_NOT_REGISTERED`; outbound provider verification = not promoted.

Missing: sender/domain, authentication/DNS where applicable, selected signed webhook identity/key and verification, approved inbox, Privacy/suppression, ApprovalRecord, provider message ID, delivery/bounce readback, Audit/Outbox, staging/production refs.

## CRM / Sales ledger

Refs: `CODE-CRM-001`, `DRIVE-R10-001`, `DRIVE-CRM-001`.

Runtime members: `sales.followup.create`, `sales.followup.schedule`, `sales.lead.create`, `sales.lead.enrich`, `sales.lead.qualify`, `sales.pipeline.update`, `sales.report.generate`.

No evidence was manufactured for `sales.lead.score` or other catalog-only rows.

## Commerce ledger

Current state: **IMPLEMENTED_NOT_REGISTERED**. Still missing active provider identity, official machine readback contract, account/credential path, real order/payment IDs and provider-backed revenue evidence. No synthetic capability/route/provider is created.

## Staging ledger

| Ref | Required evidence | State |
| --- | --- | --- |
| `STG-PROJECT-001` | project separation | PENDING |
| `STG-SQL-001` | Cloud SQL/database separation | PENDING |
| `STG-DBSECRET-001` | DB-secret separation | PENDING |
| `STG-SERVICE-001` | service/revision separation | PENDING |
| `STG-IDENTITY-001` | WIF/deploy/runtime identity separation | PENDING |
| `STG-SOURCE-001` | exact source SHA | PENDING |
| `STG-IMAGE-001` | immutable image digest | PENDING |
| `STG-REVISION-001` | Cloud Run revisions | PENDING |
| `STG-MIGRATIONS-001` | migration result | PENDING |
| `STG-ACCEPTANCE-001` | canonical acceptance E2E | PENDING |

#55 implements the guard contracts; these operational refs are still required.

## Production ledger

| Ref | Required evidence | State |
| --- | --- | --- |
| `PROD-SOURCE-001` | production source SHA | PENDING |
| `PROD-IMAGE-001` | immutable image digest | PENDING |
| `PROD-REVISION-001` | Cloud Run revisions | PENDING |
| `PROD-MIGRATIONS-001` | migrations | PENDING |
| `PROD-READY-001` | readiness | PENDING |
| `PROD-TENANCY-001` | tenant isolation | PENDING |
| `PROD-PROVIDERS-001` | exact promoted provider evidence | PENDING |
| `PROD-APPROVAL-001` | ApprovalRecord refs | PENDING |
| `PROD-AUDIT-001` | Audit refs | PENDING |
| `PROD-OUTBOX-001` | Outbox refs | PENDING |

## SLO / alerts / DR / rollback ledger

| Ref | Required evidence | State |
| --- | --- | --- |
| `SLO-FINAL-001` | deployed SLI/SLO readback | PENDING |
| `ALERT-POLICY-001` | alert policies/readback | PENDING |
| `ALERT-FIRING-001` | real/safe synthetic firing | PENDING |
| `ALERT-NOTIFY-001` | notification readback | PENDING |
| `DR-BACKUP-001` | backup/PITR | PENDING |
| `DR-DRILL-001` | isolated recovery drill | PENDING |
| `DR-RPO-RTO-001` | measured RPO/RTO | PENDING |
| `ROLLBACK-001` | rollback execution/readback | PENDING |

## PR #17 replacement evidence

No final replacement PR exists yet, intentionally. It becomes eligible only after final production/provider/reliability refs are populated, TOCA_OS is reread, the registry is fully flattened from final reality, all closeout artifacts are rebuilt, and the clean replacement itself passes exact-head hosted CI.
