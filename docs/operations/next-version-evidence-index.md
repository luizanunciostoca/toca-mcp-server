# TOCA OS Next Version — Evidence Index

Status: **ACTIVE / EXACT-HEAD SCOPED**

## Evidence rules

Valid lifecycle:

`IMPLEMENTED -> CI_VERIFIED -> PROVIDER_VERIFIED -> PRODUCTION_VERIFIED`

Rules:

1. Evidence belongs to the exact commit/head that produced it.
2. Rebase, merge-from-main, conflict-resolution or any new commit requires fresh CI evidence for merge readiness.
3. CI cannot substitute for provider readback.
4. Provider readback cannot substitute for production deployment/readback when `PRODUCTION_VERIFIED` is claimed.
5. No side effect may be executed solely to manufacture evidence.

## Frozen V1 evidence

| Claim | State | Evidence |
| --- | --- | --- |
| V1 release identity | PRODUCTION_VERIFIED | `abfb09b17e90c83790e803dcda091c8142c7407f` |
| Canonical V1 state | PRODUCTION_VERIFIED | `docs/operations/v1-canonical-state-2026-08-20.md` |
| Final V1 hosted readback | PRODUCTION_VERIFIED | `docs/operations/v1-final-closeout-2026-08-20.md` |
| Final runtime redeploy | PRODUCTION_VERIFIED | workflow run `32325385858` |
| Final hosted production readback | PRODUCTION_VERIFIED | workflow run `32325385886` |
| Sanitized final readback artifact | PRODUCTION_VERIFIED | artifact `9393447493` |
| Meta Ads V1 controlled path | PRODUCTION_VERIFIED within V1 boundary | `READ -> PREPARE -> CREATE_PAUSED -> independent READBACK`; no activation implied |

V1 evidence remains frozen and is not invalidated by Next Version branch work.

## Next Version current evidence

### NEXT-001 — Creative Truth / Venue Fidelity — PR #14

- Exact head: `2843e9544c0bb0eb15affeba6d7abdc0b286f515`
- Observed base: `main@cd99521c8842268c5e1fb9e5efe58f9f6680ddf0`
- Behind observed base: `0`
- Evidence state: `CI_VERIFIED`
- Quality Gate: run `32333328028` — `success`
- PostgreSQL E2E: run `32333328092` — `success`
- Provider mutation required for this CI claim: no
- Provider/production promotion claim: none
- Current technical gate: synchronized and green; revalidate if `main` changes.

### NEXT-002 — Morro Demand Intelligence — PR #15

- Exact head: `84e96652db604a8ac1ea258d868c4f5ce2994ad8`
- Observed base: `main@cd99521c8842268c5e1fb9e5efe58f9f6680ddf0`
- Behind observed base: `0`
- Evidence state: `CI_VERIFIED`
- Quality Gate: run `32333311073` — `success`
- PostgreSQL E2E: run `32333311077` — `success`
- Migration: `022_meta_ads_geo_demand_intelligence.sql`
- Observed `main` highest migration: `021_r29_video_artifacts.sql`
- Migration-number collision in current #14/#15/#16 set: none
- Provider evidence required before `PROVIDER_VERIFIED`: yes
- Still required:
  - approved Meta ad-account live `delivery_estimate` READ;
  - accepted canonical Morro targeting;
  - durable sample readback;
  - proof `meta_ads.audience.inspect`, `meta_ads.opportunity.detect` and `meta_ads.budget.recommend` emit no provider write.
- Production claim: none.

### NEXT-003 — Photo-to-Video — PR #16

- Exact child head: `99edf42d06dc70958ac9791a79c00e877e82c4ad`
- Exact parent #14 head: `2843e9544c0bb0eb15affeba6d7abdc0b286f515`
- Behind parent: `0`
- Evidence state: `CI_VERIFIED`
- Quality Gate: run `32333405034` — `success`
- Provider evidence required before provider promotion: yes for generative scene continuation
- Current provider blockers are canonical governance prerequisites, not CI failures:
  - valid source rights;
  - likeness consent when people are present;
  - explicit generative exception approval;
  - provider access/credentials;
  - provider job completion + exact output download/readback;
  - human/fidelity finalization evidence.
- No Instagram publication or other provider side effect was executed solely for validation.
- Production claim: none.

## Coordinator control-plane evidence

Branch: `coord/next-version-control-plane-20260820`

Scope is documentation plus the machine-readable Next Version Feature Registry only. It introduces no migration, runtime provider path, scheduler, policy engine, approval engine or new MCP.

Evidence state must remain `IMPLEMENTED` until the exact final coordinator HEAD receives successful Quality Gate evidence. After any final documentation update, only the newest exact head may be promoted to `CI_VERIFIED`.

## Provider-evidence boundary by planned workstream

Provider evidence will be mandatory before promotion where work touches:

- WhatsApp sends/readbacks;
- Email sends/delivery/bounce/complaint readbacks;
- Meta Ads live demand reads or later governed writes;
- Google Ads real provider execution;
- payment/ticketing/conversion evidence;
- OpenAI video generation;
- external orchestrator runtime/model/tool execution;
- production observability or DR claims involving cloud-provider state.

Pure contracts/docs can reach `CI_VERIFIED` without external side effects, but never `PROVIDER_VERIFIED` or `PRODUCTION_VERIFIED` without matching external evidence.

## Continuous update rule

After each material PR-head change, update this index with:

- PR number;
- exact head SHA;
- intended base and base SHA;
- Quality run ID/result;
- PostgreSQL E2E run ID/result when applicable;
- provider read/readback identifiers when applicable;
- blocker/dependency changes;
- resulting evidence state.

Never carry a green run forward to a different SHA.