# TOCA OS Next Version — Canonical Technical Baseline — 2026-08-20

Status: **ACTIVE COORDINATION BASELINE**

## Frozen V1 identity

- Canonical repository: `luizanunciostoca/toca-mcp-server`
- `V1_BASE_SHA=abfb09b17e90c83790e803dcda091c8142c7407f`
- V1 classification: `PRODUCTION_VERIFIED`
- Canonical V1 evidence:
  - `docs/operations/v1-canonical-state-2026-08-20.md`
  - `docs/operations/v1-final-closeout-2026-08-20.md`

`V1_BASE_SHA` is the immutable V1 application/release identity. The later documentation-only `main` closeout commit does not change the production release SHA.

## Next Version baseline

Coordinator readback on 2026-08-20:

- canonical branch: `main`
- observed `main` SHA: `cd99521c8842268c5e1fb9e5efe58f9f6680ddf0`
- observed commit: `docs(v1): close final production verification`

Rule: **the live `main` ref is the baseline for every Next Version branch.** Re-read it before every integration or merge decision.

## Mandatory architecture

`USER -> CHATGPT / AG-01 -> TOCA_OS / GOOGLE DRIVE -> ROUTE_ID -> AGENT(S) -> SOP / TEMPLATE -> QUALITY GATE -> APPROVAL / POLICY GATE -> TOCA MCP -> PROVIDER -> READBACK -> AUDIT / OUTBOX / EVENT RECORD -> LEARNING`

The Next Version must reuse the existing Core, MCP, CRM records, scheduler, Approval Engine, Policy Engine, idempotency, transactional outbox and audit boundaries. No parallel substitute may be introduced without explicit architecture approval.

## Side-effect invariant

Every side effect remains:

`identity -> typed schema -> authorization -> policy/risk -> approval when applicable -> idempotency -> workflow -> provider -> provider readback -> outbox/audit -> response`

No publication, campaign activation, payment, provider send or equivalent external mutation may be executed solely to prove a test.

## Evidence-state contract

Only these promotion states are valid:

`IMPLEMENTED -> CI_VERIFIED -> PROVIDER_VERIFIED -> PRODUCTION_VERIFIED`

Evidence is exact-head scoped. A branch update, rebase or conflict-resolution commit invalidates prior CI evidence for merge purposes until the new exact HEAD is revalidated.

## Current feature PRs — refreshed state

| PR  | Feature                         | Branch / base                                              | Current head                               | Base relation                   | Exact-head evidence                                           |
| --- | ------------------------------- | ---------------------------------------------------------- | ------------------------------------------ | ------------------------------- | ------------------------------------------------------------- |
| #14 | Creative Truth / Venue Fidelity | `recovery/creative-truth-20260819` -> `main`               | `2843e9544c0bb0eb15affeba6d7abdc0b286f515` | 0-behind `cd99521c...`          | Quality `32333328028` PASS; PostgreSQL E2E `32333328092` PASS |
| #15 | Morro Demand Intelligence       | `recovery/meta-ads-demand-intelligence-20260819` -> `main` | `84e96652db604a8ac1ea258d868c4f5ce2994ad8` | 0-behind `cd99521c...`          | Quality `32333311073` PASS; PostgreSQL E2E `32333311077` PASS |
| #16 | Photo-to-Video                  | `recovery/photo-to-video-20260819` -> #14 branch           | `99edf42d06dc70958ac9791a79c00e877e82c4ad` | 0-behind #14 head `2843e954...` | Quality `32333405034` PASS                                    |

Obsolete textual holds referring to V1 closeout / PR #13 were removed from PR merge conditions.

## Migration state

Current `main` migration sequence reaches `021_r29_video_artifacts.sql`. PR #15 introduces `022_meta_ads_geo_demand_intelligence.sql`; no competing `022` exists on the observed `main` or the other current feature PRs. Recheck this immediately before any later integration because migration numbering is globally serialized.

## Current synchronization result

- #14 is 0-behind current observed `main` and exact-head CI is green.
- #15 is 0-behind current observed `main` and exact-head Quality + PostgreSQL E2E are green.
- #16 is correctly restacked on the refreshed #14 and exact-head Quality is green.
- #16 must never merge independently of #14.
- #15 remains an independent lane but touches shared runtime hotspots; its order must be recomputed after any change to `main`.

## Canonical coordination artifacts

- `control/next-version-feature-registry.v1.json`
- `docs/operations/next-version-roadmap.md`
- `docs/operations/next-version-master-tracker.md`
- `docs/operations/next-version-evidence-index.md`

These artifacts coordinate Next Version candidates; they do not override Google Drive business policy, live `main`, provider readback or V1 final evidence.
