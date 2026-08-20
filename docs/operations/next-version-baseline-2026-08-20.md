# TOCA OS Next Version — Canonical Technical Baseline — 2026-08-20

Status: **ACTIVE COORDINATION BASELINE**

## Frozen V1 identity

- Canonical repository: `luizanunciostoca/toca-mcp-server`
- `V1_BASE_SHA=abfb09b17e90c83790e803dcda091c8142c7407f`
- V1 classification: `PRODUCTION_VERIFIED`
- Canonical V1 evidence:
  - `docs/operations/v1-canonical-state-2026-08-20.md`
  - `docs/operations/v1-final-closeout-2026-08-20.md`

`V1_BASE_SHA` is immutable release identity. Later documentation-only commits on `main` do not change the V1 production release SHA.

## Next Version baseline

At coordinator round start:

- canonical branch: `main`
- observed `main` SHA: `cd99521c8842268c5e1fb9e5efe58f9f6680ddf0`
- observed commit: `docs(v1): close final production verification`

Rule: **the live `main` ref is the baseline for every Next Version branch.** This document records the round-start readback only; before merge/rebase decisions, re-read `main` and do not assume this SHA remains current.

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

## Current feature PRs

| PR | Feature | Branch | Relationship | Round-start head | Round-start status |
| --- | --- | --- | --- | --- | --- |
| #14 | Creative Truth / Venue Fidelity | `recovery/creative-truth-20260819` | base `main` | `6bc92c6e652da7732ae663ccb1e0e752c35349f6` | Draft, mergeable, 1 behind round-start main |
| #15 | Morro Demand Intelligence | `recovery/meta-ads-demand-intelligence-20260819` | base `main` | `a1dd29a640daf7ba7a58364ce1f7c9fce8226643` | Draft, mergeable, 1 behind round-start main |
| #16 | Photo-to-Video | `recovery/photo-to-video-20260819` | stacked on #14 | `8a99c9059627c76eec59f259308138758177d303` | Draft, mergeable against parent; parent 1 behind main |

Obsolete textual holds referring to V1 closeout / PR #13 are not valid Next Version blockers and must not remain as merge conditions.

## Synchronization rule

1. Re-read live `main`.
2. Update #14 and #15 independently from live `main`.
3. Run fresh exact-head Quality; run PostgreSQL E2E when persistence/migration is involved.
4. Update #16 only after #14 has its refreshed head.
5. Revalidate #16 on the refreshed parent head.
6. Never merge #16 independently of #14.

## Canonical coordination artifacts

- `control/next-version-feature-registry.v1.json`
- `docs/operations/next-version-roadmap.md`
- `docs/operations/next-version-master-tracker.md`
- `docs/operations/next-version-evidence-index.md`

These artifacts coordinate Next Version candidates; they do not override Google Drive business policy, live `main`, provider readback or V1 final evidence.