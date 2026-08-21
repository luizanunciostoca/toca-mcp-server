# TOCA OS Next — Canonical Baseline — 2026-08-20

Status: **CLOSEOUT_PENDING_PRODUCTION_EVIDENCE**

Observed technical baseline: `main@ec8a8e6a2eed9eba1181bc2c32fbcc8fed93845d`.

This is a pre-closeout baseline, not a production certificate. Rebuild it against the exact final production source before final closeout.

## Authority order

1. `TOCA_OS` Google Drive — business routes, agents, SOPs/templates and durable semantics.
2. GitHub `main` — source, runtime registry, schemas, migrations and bindings.
3. Effective deployed configuration — actual environment binding state.
4. Provider authoritative readback — external-effect truth.
5. GCP source/image/revision/migration/readiness evidence — staging/production truth.

No lower evidence tier substitutes for the next one.

## Source state

`main@ec8a8e6a2eed9eba1181bc2c32fbcc8fed93845d` includes:

- #54 credential-first/fail-closed provider onboarding;
- #55 final platform-readiness replacement for #42;
- fail-closed staging-isolation contracts;
- immutable two-service Cloud Run rollout/readiness evidence capture;
- observability/SLO/DR/rollback contracts;
- canonical policy mutation kill switch;
- existing CRM/Privacy/AG-01/Omnichannel/Provider composition preserved.

### #55 exact-head CI

Final #55 head: `c3791176195edd392890fa02dbd93209b7bc785e`.

- Quality `32439330910`: SUCCESS.
- Quality job `96646716691`: permanent workflow verification, platform-hardening verification, Format, Architecture, Lint, Typecheck, Test and Build all SUCCESS.
- Security Supply Chain `32439330928`: SUCCESS.
- Email Provider Gate `32439330916`: SUCCESS.
- Merge commit: `ec8a8e6a2eed9eba1181bc2c32fbcc8fed93845d`.

Thus the #55 readiness source scope is `CI_VERIFIED`. The PR explicitly states production was not executed or declared verified, so this does **not** imply `STAGING_VERIFIED` or `PRODUCTION_VERIFIED`.

PR #42 is legacy/superseded for coordination by #55 and must not be merged blindly. PR #46 remains historical/partly stale blocker audit. PR #17 remains historical and must not be merged or marked superseded yet.

## Drive reconciliation

Capability catalog: `18IZgArLKFA7WgnhdJ9i9MleJknxwzeIJQQ_q1l4HLj4`.

- `ROUTES!A29:J29`: R28 `PAID_MEDIA_CONTROLLED_LIFECYCLE`, count 79.
- `CAPABILITIES!A747:V753`: seven `paid_media.*` = IMPLEMENTED.
- `CAPABILITIES!A754:V768`: fifteen `google_ads.*` = IMPLEMENTED with phase-gated/default-OFF evidence; provider/production not promoted.
- `CAPABILITIES!A643:V657`: only seven runtime-backed `sales.*` promoted; `sales.lead.qualify` corrected to WRITE_REVERSIBLE; unbound Sales remain PLANNED.
- `ROUTES!A31:K31`: R30 `SOCIAL_ENGAGEMENT_LIFECYCLE`, primary AG-08, count 25.
- `ROUTES!A11:K11`: R10 `COMERCIAL_PARCERIAS`, primary AG-10, count 19.

Routing registry: `1vnSliJe2duw278DPPdiTylXUooOdzYtVa0nXD24LEtU`.

- `ROUTING_REGISTRY!A29:V29`: provider-neutral Paid Media with Meta/Google selection, paused-first, Approval, provider readback and financial guardrails.

No provider lifecycle state was promoted by the Drive changes.

## Omnichannel route conflict

`src/omnichannel/capability-specs.ts` maps Email/WhatsApp formal specs to R30, while canonical Drive R30 is Social Engagement / AG-08. The formal specs also enforce `runtimeExposed=false` and `productionExecutionAllowed=false`.

Therefore Email and WhatsApp formal transport specs remain `REGISTERED_NOT_BOUND` with `ROUTE_ID_CONFLICT`; no executable-looking transport rows were inserted into Drive R30. Internal Email/WhatsApp runtimes do not override the business route authority.

Nurture formal specs map to R10 but remain `REGISTERED_NOT_BOUND` because the formal tool surface is non-runtime-exposed.

## Conservative state classification

| Scope | State |
| --- | --- |
| Platform readiness #55 source scope | `CI_VERIFIED` |
| R28 provider-neutral Paid Media | `IMPLEMENTED` |
| `paid_media.*` | `IMPLEMENTED` |
| `google_ads.*` | `BOUND_PROVIDER_DISABLED` |
| R30 Social Engagement | `IMPLEMENTED` |
| WhatsApp inbound canonical composition | `IMPLEMENTED` |
| formal WhatsApp transport specs | `REGISTERED_NOT_BOUND` + route conflict |
| formal Email transport specs | `REGISTERED_NOT_BOUND` + route conflict |
| formal Nurture specs | `REGISTERED_NOT_BOUND` |
| CRM/Sales runtime | `IMPLEMENTED` |
| Commerce provider-neutral boundary | `IMPLEMENTED_NOT_REGISTERED` |
| final staging | not promoted |
| final production | not promoted |

## Remaining closeout gates

- prove staging isolation before mutable staging work;
- capture exact staging source/image/revisions/migrations/readiness/tenant-isolation/E2E;
- capture real provider request/resource/readback evidence for every scope promoted to PROVIDER_VERIFIED;
- resolve Omnichannel route authority before cataloging formal Email/WhatsApp transport capabilities;
- capture production source SHA/image digest/Cloud Run revisions/migrations/readiness;
- index ApprovalRecord/Audit/Outbox refs for governed side effects;
- capture SLO/alert firing/notification/runbook evidence;
- capture backup/PITR/isolated DR drill/RPO/RTO;
- execute/read back rollback evidence;
- reread TOCA_OS after final source freeze and fully flatten the final capability registry;
- only after final production evidence, open a clean replacement PR for #17 and pass exact-head CI.

Until then: **CLOSEOUT_PENDING_PRODUCTION_EVIDENCE**.
