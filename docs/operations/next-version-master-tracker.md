# TOCA OS Next — Master Tracker

Snapshot: 2026-08-20

Global state: **CLOSEOUT_PENDING_PRODUCTION_EVIDENCE**

Observed main: `ec8a8e6a2eed9eba1181bc2c32fbcc8fed93845d`

## Source / coordination

| Scope | State | Exact evidence | Next gate |
| --- | --- | --- | --- |
| Current main | `IMPLEMENTED` baseline | `ec8a8e6a2eed9eba1181bc2c32fbcc8fed93845d` | isolated staging + provider + production evidence |
| Provider onboarding #54 | merged implementation | prior main `7e1fa75ab6ca08aeb10c81f373c76c08b8376ffb` | real provider readback remains separate |
| Platform readiness #55 | `CI_VERIFIED` source scope | final head `c3791176195edd392890fa02dbd93209b7bc785e`; Quality `32439330910`; Security `32439330928`; Email Gate `32439330916`; merge `ec8a8e6...` | staging verification |
| Legacy readiness #42 | superseded for coordination | PR #42 | do not merge blindly |
| Google Ads blocker #46 | historical/partly stale | PR #46 | retain history only; no provider promotion |
| Historical coordinator #17 | historical only | PR #17 | clean replacement only after final production validation |

## Canonical reconciliation

| Domain / surface | Drive | Runtime | State | Provider | Staging | Production |
| --- | --- | --- | --- | --- | --- | --- |
| R28 Paid Media | provider-neutral, count 79 | provider-neutral + Meta + Google Ads | `IMPLEMENTED` | Google Ads not verified | pending | pending |
| `paid_media.*` | rows 747–753 IMPLEMENTED | ToolRegistry decision surface | `IMPLEMENTED` | N/A | pending | pending |
| `google_ads.*` | rows 754–768 IMPLEMENTED, provider=false evidence | phase-gated/default OFF | `BOUND_PROVIDER_DISABLED` | not verified | pending | pending |
| Meta Ads | existing catalog | provider-specific runtime | `IMPLEMENTED` | final Next scope refresh required | pending | pending |
| R30 Social Engagement | `SOCIAL_ENGAGEMENT_LIFECYCLE`, AG-08 | canonical social route | `IMPLEMENTED` | pending final scope | pending | pending |
| WhatsApp inbound | no fake transport promotion | CRM/Privacy/AG-01 composition | `IMPLEMENTED` | outbound not verified | pending | pending |
| WhatsApp formal specs | not inserted into R30 | runtimeExposed=false + route conflict | `REGISTERED_NOT_BOUND` | not verified | pending | pending |
| Email formal specs | not inserted into R30 | runtimeExposed=false + route conflict | `REGISTERED_NOT_BOUND` | not verified | pending | pending |
| Nurture formal specs | R10 retained | runtimeExposed=false; durable primitives exist | `REGISTERED_NOT_BOUND` | channel-dependent | pending | pending |
| CRM/Sales | seven runtime-backed rows reconciled | DB-bound canonical runtime | `IMPLEMENTED` | N/A | pending | pending |
| Commerce boundary | no invented provider/capability | provider-neutral evidence boundary | `IMPLEMENTED_NOT_REGISTERED` | unresolved | pending | pending |

## Drive readback

Capability catalog `18IZgArLKFA7WgnhdJ9i9MleJknxwzeIJQQ_q1l4HLj4`:

- [x] `ROUTES!A29:J29` => R28 Paid Media, count 79.
- [x] `ROUTES!A31:K31` => R30 Social Engagement, AG-08, count 25.
- [x] `ROUTES!A11:K11` => R10 Comercial/Parcerias, AG-10, count 19.
- [x] `CAPABILITIES!A747:V753` => seven `paid_media.*` IMPLEMENTED.
- [x] `CAPABILITIES!A754:V768` => fifteen `google_ads.*` IMPLEMENTED, phase-gated/default OFF, provider/production not promoted.
- [x] `CAPABILITIES!A643:V657` => only runtime-backed Sales promoted; `sales.lead.qualify` corrected to WRITE_REVERSIBLE.

Routing registry `1vnSliJe2duw278DPPdiTylXUooOdzYtVa0nXD24LEtU`:

- [x] `ROUTING_REGISTRY!A29:V29` => Paid Media provider-neutral Meta/Google, paused-first, Approval, readback and financial guardrails.

## Route authority blocker

**ROUTE_ID_CONFLICT** remains:

- Drive R30 = Social Engagement / AG-08.
- source Email/WhatsApp formal specs map to R30.
- those specs also enforce runtimeExposed=false / productionExecutionAllowed=false.

Do not repurpose Drive R30 or insert transport rows until route authority is corrected.

## State promotion rules

| State | Minimum evidence |
| --- | --- |
| `DOCUMENTED_NOT_IMPLEMENTED` | canonical docs only |
| `IMPLEMENTED_NOT_REGISTERED` | source boundary exists; no executable registration |
| `REGISTERED_NOT_BOUND` | formal spec/registry exists; executable binding absent/disabled |
| `BOUND_PROVIDER_DISABLED` | provider-capable binding exists; effective gate OFF/disabled |
| `IMPLEMENTED` | implementation exists on claimed source |
| `CI_VERIFIED` | all required hosted checks successful for exact source scope |
| `PROVIDER_CONFIGURED_NOT_VERIFIED` | target provider identity/config proven; no real success/readback |
| `PROVIDER_VERIFIED` | real provider request/resource/readback evidence |
| `STAGING_VERIFIED` | isolated staging acceptance tied to exact source/image/revisions/config |
| `PRODUCTION_VERIFIED` | exact production source/image/revisions/migrations + provider/reliability evidence |

## Staging fail-closed tracker

#55 implements the fail-closed contracts, but operational isolation evidence is still pending:

- [ ] staging project != production project;
- [ ] staging Cloud SQL/database != production;
- [ ] staging DB secret != production secret;
- [ ] staging service/revision namespaces separate;
- [ ] staging WIF/deploy/runtime identities explicit and separate;
- [ ] no missing staging config falls back to production;
- [ ] exact source/image/revisions/migrations/readiness/tenant-isolation/E2E captured.

## Provider tracker

### Google Ads — `BOUND_PROVIDER_DISABLED`

- [x] credential-only accessible-customer discovery implemented;
- [x] customer-bound calls fail closed without selected customer;
- [x] Drive capability/routing surfaces reconciled without promotion;
- [ ] effective non-secret credential/customer identity;
- [ ] real request ID + billing/permission/account readback;
- [ ] Approval + controlled CREATE_PAUSED resource if that phase is verified;
- [ ] independent PAUSED readback + Audit/Outbox/idempotency;
- [ ] staging/production evidence as claimed;
- [ ] MANAGE evaluated separately.

### WhatsApp outbound — not provider-verified

- [x] Business -> WABA -> Phone discovery implemented and ambiguity fail-closed;
- [ ] target-environment assets/scopes + signed webhook evidence;
- [ ] approved recipient + current Privacy eligibility + ApprovalRecord;
- [ ] provider message ID/status + Audit/Outbox;
- [ ] staging/production evidence as claimed.

### Email / SendGrid outbound — not provider-verified

- [x] signed Event Webhook public-key discovery implemented and ambiguity fail-closed;
- [ ] sender/domain/webhook identity + authentication/DNS/signed verification;
- [ ] approved inbox + Privacy/suppression + ApprovalRecord;
- [ ] provider message ID + delivery/bounce + Audit/Outbox;
- [ ] staging/production evidence as claimed.

### Commerce — provider unresolved

- [ ] provider/operator identity;
- [ ] official machine readback contract;
- [ ] least-privilege credential;
- [ ] real order/payment IDs/status semantics;
- [ ] canonical CRM/Attribution reconciliation;
- [ ] provider-backed revenue/WON evidence.

## Reliability / DR / rollback

#55 adds contracts, not operational verification. Still capture on exact deployment:

- [ ] AG-01/Core/Approval/Email/WhatsApp/provider/CRM/Outbox/Workflow/Commerce/Google/Meta SLIs;
- [ ] alert policies/readback, firing, notification, runbook correlation;
- [ ] backup/PITR;
- [ ] isolated DR drill + measured RPO/RTO;
- [ ] rollback execution/readback.

## PR #17 disposition

**DO NOT MERGE / DO NOT MARK SUPERSEDED YET**.

Only after production validation: reread TOCA_OS -> fully flatten final registry -> rebuild all artifacts -> open clean replacement PR from final main -> exact-head CI -> then close #17 as superseded without merging historical code.
