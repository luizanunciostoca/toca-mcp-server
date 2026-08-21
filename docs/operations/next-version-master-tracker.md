# TOCA OS Next — Final Convergence Master Tracker

Observed baseline: `main@ec8a8e6a2eed9eba1181bc2c32fbcc8fed93845d`.

This tracker records coordination state only. It does not promote provider, staging or production lifecycle state.

| Front / gate | Current state | Merge/source authority | Blocking condition | Next evidence required |
| --- | --- | --- | --- | --- |
| A — Provider Onboarding + Google Ads | BLOCKED | existing Google Ads provider/client; #54/#55 merged; #46 audit draft | credential-only discovery is not reachable through canonical server/config composition; controlled write bootstrap cannot pre-promote lifecycle; live credentials/provider evidence absent | exact-head correction CI; live credential READ; controlled governed provider verification |
| B — Omnichannel Outbound + Nurture | BLOCKED | existing Email/WhatsApp runtimes + CRM/Privacy/Workflow/Scheduler + TOCA_OS | capability manifest remains SPECIFIED and runtime exposure forbidden; durable nurture composition incomplete; TOCA_OS has no matching operational `whatsapp.*`/`email.*`/`nurture.*` rows | exact-head composition PR CI + canonical Drive reconciliation + PostgreSQL/Email gates where applicable |
| C — Platform Readiness / GCP / SLO / DR | SOURCE READY, RUNTIME PENDING | #55 | actual staging environment isolation/resources not yet proven; candidate not frozen | final-candidate source revalidation then isolated staging deployment evidence |
| D — Governance / Drive / Closeout prep | IN PROGRESS | this replacement branch + TOCA_OS Drive | Google Ads catalog reconciled; Omnichannel operational catalog still drifted; no staging/production evidence | exact-head docs CI, Omnichannel Drive reconciliation, later production evidence |
| Candidate freeze | BLOCKED | live `main` after A/B | A/B unresolved | one exact candidate SHA after final merges |
| Staging | NOT VERIFIED | #55 deployment contract | candidate not frozen and actual environment isolation unproven | project/DB/secret/service/identity/WIF readback before mutation |
| Provider verification | NOT COMPLETE | provider-specific controlled boundaries | credentials/evidence incomplete; Google Ads bootstrap gap | provider READ/write/readback + Audit/Outbox/Approval evidence |
| Production | NOT VERIFIED | immutable candidate image only | staging/provider/reliability gates not complete | production revision/digest/migration/readback evidence |
| Reliability | NOT VERIFIED | existing SLO/DR contracts | production candidate not deployed | alert delivery + SLO + backup/PITR + isolated DR drill |
| Final closeout | FORBIDDEN | canonical closeout artifacts | production/reliability evidence absent | evidence-backed final reconstruction |

## PR disposition

- #55 — merged replacement for #42; current Platform Readiness source authority.
- #54 — merged provider-onboarding foundation.
- #53 — merged WhatsApp inbound composition.
- #52/#51 — merged Privacy/Email final hardening layers.
- #49 — merged durable marketing-autopilot closed loop.
- #46 — keep draft as remaining Google Ads provider-verification blocker record; do not merge stale branch content.
- #42 — superseded by #55; never use as merge source.
- #17 — obsolete historical coordinator; do not merge. Close as superseded only after this replacement PR is clean and exact-head valid.
- Dependabot #1–#6 — separate maintenance lane; do not mix into the final candidate without independent review/gates.

## Shared-hotspot lock

Any new code PR touching these locations must be compared against the current live tree before merge:

- `src/server.ts`
- `src/http.ts`
- `src/registry.ts`
- `src/config.ts`
- `src/mcp/`
- `migrations/`
- capability/governance registries

The coordinator rejects branch-side copies of older composition roots, providers, registries or migrations.

## Migration lock

Current merged migration names are immutable. Numeric gap `027` is intentionally left unused. Do not rename 028–032 to close the gap. Any new migration receives the next safe name only after live-main inspection and must pass real-repository migrations + a second drift check.

## Front A acceptance

Code convergence is reached only when:

- `google_ads.customers.discover` is executable with the credential bundle before customer selection;
- customer-bound capabilities remain fail-closed until account/guardrails are selected;
- no duplicate Google Ads provider/client is introduced;
- provider-verification bootstrap does not require false lifecycle promotion;
- TOCA_OS catalog/runtime IDs are reconciled semantically;
- exact-head source CI is green.

Provider verification remains a later state requiring real provider evidence.

## Front B acceptance

Code convergence is reached only when:

- existing Email and WhatsApp outbound engines are reachable through the canonical governed execution path;
- existing CRM Conversation/Message is the sole commercial message authority;
- Privacy is revalidated at execution time;
- Policy/Approval/identity/idempotency/readback/Audit/Outbox remain canonical;
- nurture survives restart and uses existing NextAction/Workflow/Scheduler;
- opt-out/suppression before a due follow-up blocks the send;
- capability lifecycle/runtime contracts match the actual implementation;
- the intended operational WhatsApp/Email/Nurture capability set is represented in TOCA_OS or explicitly mapped to already-canonical IDs; no checklist-only capabilities are created;
- exact-head source/PG/Email gates are green as applicable.

## Merge protocol

For each candidate PR:

1. revalidate live `main` immediately before review;
2. compare changed files to shared hotspots;
3. check migration queue;
4. inspect exact head SHA;
5. require all applicable hosted gates on that exact head;
6. merge only with `expected_head_sha` protection;
7. re-read resulting `main` SHA;
8. revalidate migration sequence, registry, runtime composition and blockers;
9. never carry provider/staging/production state forward merely because a source merge succeeded.
