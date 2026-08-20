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

Coordinator readback on 2026-08-20 03:40 America/Bahia:

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

## Current feature PRs — live readback

The GitHub API and local `git merge-tree` readback on this round observed 18 open Next Version PRs. All listed heads were fetched, all local base/head comparisons were clean, and exact-head evidence is reported in the registry, tracker and evidence index. API `mergeable` is asynchronous and was null during collection; no null value is treated as merge approval.

| PR  | Head          | Base       | Draft | Exact-head checks                                                             | Current coordination state     |
| --- | ------------- | ---------- | ----- | ----------------------------------------------------------------------------- | ------------------------------ |
| #14 | `de3ec2f6...` | `main`     | no    | Quality `32335049796`, PG `32335049795` PASS                                  | CI verified                    |
| #15 | `ee7cb048...` | `main`     | no    | Quality `32333934188`, PG `32333934183` PASS                                  | provider READ verified         |
| #16 | `c0b23b57...` | #14 branch | no    | Quality `32335823551` PASS                                                    | parent-dependent               |
| #17 | `444317f7...` | `main`     | yes   | Quality `32337525360` PASS                                                    | coordinator; no auto-merge     |
| #18 | `1bfa2680...` | `main`     | no    | Quality `32334357073`, PG `32334357088` PASS                                  | migration 022 collision        |
| #19 | `a6345897...` | `main`     | no    | Quality `32334417380` PASS                                                    | privacy authority              |
| #20 | `ccfde23e...` | `main`     | no    | Quality PASS; Security `32334666190` FAIL                                     | security gate blocked          |
| #21 | `e741198f...` | `main`     | yes   | Quality `32337705724`, PG `32337705682` PASS                                  | dependency hold                |
| #22 | `be97c0a6...` | `main`     | no    | Quality `32336854798`, PG `32336854963` PASS                                  | CRM authority                  |
| #23 | `036bbec4...` | #22 branch | yes   | Quality `32337132353`, PG `32337132190`, Email `32337132201` PASS             | provider evidence pending      |
| #24 | `dedcf3d7...` | `main`     | yes   | Quality `32334785013`, PG `32334784974` PASS                                  | activation dependencies        |
| #26 | `7675bd73...` | `main`     | yes   | Quality `32336459217`, PG `32336459216` PASS                                  | downstream of #33              |
| #27 | `d77b0921...` | `main`     | yes   | Quality `32337191793` FAIL; PG `32337191835`, analytics PG `32337191832` PASS | format blocked                 |
| #28 | `f900c125...` | `main`     | no    | Quality `32337044377`, PG `32337044338` PASS                                  | provider evidence pending      |
| #29 | `6976825a...` | `main`     | no    | Quality `32335977430` PASS                                                    | governed intent only           |
| #30 | `2fce39b0...` | `main`     | yes   | Quality `32336878038`, PG `32336878082`, tenancy PG `32336878062` PASS        | migration 027 collision        |
| #33 | `7e8df19a...` | `main`     | yes   | Quality `32336942395`, PG `32336942409` PASS                                  | provider-shaped fixtures only  |
| #36 | `510d0202...` | #22 branch | yes   | Quality `32339737876`, PG `32339737890` PASS                                  | sole converged WhatsApp source |

The live `main` SHA remains `cd99521c8842268c5e1fb9e5efe58f9f6680ddf0`. PR #31 is now closed unmerged and superseded by #36; PR #25, #32, #34 and #35 remain closed non-merge lanes.

## Migration state

Current `main` migration sequence reaches `021_r29_video_artifacts.sql`. Active collisions are `022` between #15/#18 and `027` between #30/#36. PR #36 is now the sole WhatsApp merge source, while #31 is closed unmerged. Recheck this immediately before any integration because migration numbering is globally serialized.

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
