# Asset Intelligence + Content Supply

## Scope

This layer extends the existing TOCA_OS media catalog, `ASSET_INTELLIGENCE`, `ASSET_RANKING_POLICY` and Creative Production Pipeline. It does not create a second media catalog, scheduler, approval engine, policy engine, CRM or MCP.

Canonical flow:

`USER -> ChatGPT/AG-01 -> TOCA_OS/Drive -> ROUTE_ID -> AGENT(S) -> SOP/TEMPLATE -> QUALITY GATE -> APPROVAL/POLICY GATE -> TOCA MCP -> PROVIDER -> READBACK -> AUDIT/OUTBOX/EVENT RECORD -> LEARNING`

The implementation in this branch is an Asset Intelligence read/persistence layer for content supply. Existing `media.assets.rank` behavior remains intact and continues to use the TOCA_OS ranking policy.

## Authority boundaries

### TOCA_OS / Google Drive

TOCA_OS remains the business source of truth for media inventory, editorial metadata, ranking policy and content requests.

### Creative Truth

Creative Truth remains the authority for:

- Venue Fidelity;
- Brand Integrity;
- promotion/final asset eligibility.

The Asset Intelligence database stores only a readback snapshot of those verdicts plus an evidence reference and timestamp. It must never infer a `VERIFIED` Creative Truth verdict from folder location, filename, visual similarity or local scoring.

A cached Creative Truth `VERIFIED` verdict without an evidence reference is invalid and fails closed.

### Asset Intelligence

Asset Intelligence owns:

- exact duplicate detection by SHA-256;
- near-duplicate detection by 64-bit perceptual dHash distance;
- source/master lineage metadata;
- rights metadata and rights expiry;
- photographer/owner attribution;
- venue, area, time-of-day and crowd metadata;
- technical quality and per-format fitness;
- event context;
- usage/reuse history;
- performance history;
- fatigue detection;
- marketing-readiness metadata;
- restrictions;
- deterministic query projection for Marketing Autopilot.

## Master promotion rule

No asset becomes a master because it exists in a Drive folder.

`APPROVED_MASTER` requires an explicit `masterApprovalEvidenceId`. The database constraint and domain validator reject master promotion without this evidence. The lineage model distinguishes `SOURCE`, `DERIVATIVE`, `MASTER_CANDIDATE` and `MASTER`.

## Dedupe

### Exact

`sha256` is globally unique in `asset_intelligence_assets`. Re-importing the same bytes under a different Drive path must resolve to the existing canonical asset instead of creating a second asset row.

`asset_intelligence_sources` preserves multiple provider/source references for the canonical asset.

### Perceptual

`perceptual_hash` is stored as `bit(64)`. PostgreSQL near-duplicate lookup uses Hamming distance through `bit_count(left # right)`.

Perceptual similarity does not merge records automatically. It produces candidate matches for governed resolution.

## Rights eligibility

Rights resolution is fail-closed:

- `UNKNOWN` -> ineligible;
- `RESTRICTED` -> ineligible unless a future governed policy explicitly models the allowed scope;
- `EXPIRED` -> ineligible;
- `BLOCKED` -> ineligible;
- `CLEARED` -> eligible only while `rights_expires_at` is absent or in the future.

Photographer and owner fields are retained independently from rights status.

## Restrictions

Restrictions are structured with:

- code;
- blocking flag;
- applicable formats;
- applicable channels;
- optional expiry;
- notes.

Blocking restrictions are evaluated for the requested channel and format before an asset can be returned by `FIND_ELIGIBLE`.

## Performance and fatigue

`asset_intelligence_usage` is append-only and idempotent by `idempotency_key`.

`asset_intelligence_performance` stores normalized `performance_score` plus provider/measurement counters. The query read model compares recent 30-day performance with the previous 30-day window.

Fatigue is deterministic:

- recent reuse contributes up to 60 points;
- performance decay contributes up to 40 points;
- the query contract supplies the fatigue threshold;
- `FIND_ELIGIBLE` excludes fatigued assets.

No provider side effect is needed to calculate fatigue.

## Marketing Autopilot integration contract

Canonical schemas are exported from `src/contracts/marketing-autopilot-assets.ts`.

Supported query modes:

- `FIND_ELIGIBLE`;
- `FIND_VENUE_VERIFIED`;
- `FIND_UNUSED`;
- `FIND_TOP_PERFORMING`;
- `DETECT_FATIGUE`;
- `RESOLVE_RIGHTS`.

`FIND_ELIGIBLE` requires all of the following:

1. tenant/workspace/organization scope match;
2. rights eligible;
3. Creative Truth Venue Fidelity = `VERIFIED`;
4. Creative Truth Brand Integrity = `VERIFIED`;
5. Creative Truth final asset eligibility = `VERIFIED`;
6. Creative Truth evidence reference present;
7. Marketing Readiness = `READY`;
8. no active blocking restriction for the requested channel/format;
9. minimum quality score met;
10. minimum format fitness met;
11. fatigue below threshold.

This contract is deliberately stricter than `FIND_VENUE_VERIFIED`, which only answers the narrower venue-readback question.

## Persistence

Migration: `022_asset_intelligence_content_supply.sql`.

Tables:

- `asset_intelligence_assets`;
- `asset_intelligence_sources`;
- `asset_intelligence_usage`;
- `asset_intelligence_performance`.

The persistence implementation is `PostgresAssetIntelligenceStore`.

The permanent PostgreSQL E2E suite validates migration application, exact-dedupe readback, usage idempotency and process-restart durability for this store.

## Relationship to existing media ranking

The existing Google Sheets adapter and `ASSET_RANKING_POLICY` ranking implementation remain authoritative for their current business-ranking contract. This Asset Intelligence layer does not hardcode or replace those business weights.

A future integration commit may compose Marketing Autopilot selection as:

1. query Asset Intelligence for governed eligible supply;
2. apply TOCA_OS ranking policy to the eligible subset;
3. request Creative Production Pipeline work when required;
4. carry the selected exact SHA-256 through approval/publication binding.

## Evidence states

The code in this branch begins as `IMPLEMENTED`. It may be promoted to `CI_VERIFIED` only when the exact branch HEAD passes repository Quality plus PostgreSQL E2E. Provider and production states require their own later evidence and are not implied by unit or database tests.
