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

- Recorded head: `6bc92c6e652da7732ae663ccb1e0e752c35349f6`
- Evidence state for that exact head: `CI_VERIFIED`
- Quality Gate: run `32322022410` — `success`
- PostgreSQL E2E: run `32322022475` — `success`
- Provider write required for this CI claim: no
- Production claim: none
- Merge readiness: **NO** until refreshed from live `main` and fresh exact-head Quality passes.

### NEXT-002 — Morro Demand Intelligence — PR #15

- Recorded head: `a1dd29a640daf7ba7a58364ce1f7c9fce8226643`
- Evidence state for that exact head: `CI_VERIFIED`
- Quality Gate: run `32323105456` — `success`
- PostgreSQL E2E: run `32323105453` — `success`
- Migration: `022_meta_ads_geo_demand_intelligence.sql`
- Provider evidence required for `PROVIDER_VERIFIED`: yes
- Provider evidence still required:
  - approved Meta ad-account live `delivery_estimate` READ;
  - canonical Morro targeting accepted by provider;
  - durable sample readback;
  - proof the three demand capabilities emit no provider write.
- Production claim: none
- Merge readiness: **NO** until refreshed from live `main`, migration order rechecked and fresh exact-head Quality + PostgreSQL E2E pass.

### NEXT-003 — Photo-to-Video — PR #16

- Recorded head: `8a99c9059627c76eec59f259308138758177d303`
- Parent recorded head: #14 `6bc92c6e652da7732ae663ccb1e0e752c35349f6`
- Evidence state for that exact child head: `CI_VERIFIED`
- Quality Gate: run `32324805271` — `success`
- Provider evidence required for `PROVIDER_VERIFIED`: yes for the generative provider path
- Current provider blockers are governance prerequisites, not CI failures:
  - canonical source rights must be valid;
  - likeness consent when people are present;
  - explicit generative exception approval;
  - provider access/credential availability;
  - provider job completion + exact output download/readback;
  - human/fidelity finalization evidence.
- Production claim: none
- Merge readiness: **NO** until #14 is refreshed first and #16 is then refreshed/revalidated on that new parent head.

## Coordinator control-plane evidence

The coordinator branch/PR only changes documentation and the machine-readable Next Version registry. Its evidence state must remain `IMPLEMENTED` until the exact final coordinator HEAD receives a successful Quality Gate run. The PR must not be merged automatically.

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

Pure contracts/docs can reach `CI_VERIFIED` without external side effects, but never `PROVIDER_VERIFIED` or `PRODUCTION_VERIFIED` without the matching external evidence.

## Continuous update rule

After each material PR-head change, update this index with:

- PR number;
- exact head SHA;
- intended base and base SHA;
- Quality run ID/result;
- PostgreSQL E2E run ID/result when applicable;
- provider read/readback identifiers when applicable;
- blocker and dependency changes;
- resulting evidence state.

Never carry a green run forward to a different SHA.