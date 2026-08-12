# Media asset selection contract

## Purpose

Define the deterministic contract between ChatGPT, TOCA_OS in Google Drive and the TOCA MCP Server for selecting and recording media assets without duplicating visual intelligence or business ranking parameters inside the server.

## Source of truth

The Google Sheets file `CATALOGO_INTELIGENTE_DE_MIDIA — SUNSET` remains the business source of truth.

Canonical tabs:

- `CATALOGO_SUNSET`: canonical media inventory.
- `ASSET_INTELLIGENCE`: visual metadata, quality scores, related assets, similarity and usage counters.
- `ASSET_RANKING_POLICY`: versioned business parameters for ranking, theme matching and anti-repeat penalties.
- `ASSET_SELECTOR`: human-facing reference surface that visualizes the ranking policy for an interactive format/theme context.
- `CONTENT_REQUESTS`: content request queue and selected asset reference.
- `ASSET_USAGE_LOG`: append-only record of assets actually used by content.

## Planned MCP tools

### `media.assets.rank`

Risk class: `READ`.

Input:

- `contentItemId`
- `format`: `FEED | STORIES | REEL_COVER | AD`
- optional `theme`
- optional `limit` from 1 to 10

Behavior:

1. Resolve the TOCA_OS spreadsheet through runtime configuration.
2. Read `ASSET_RANKING_POLICY` and `ASSET_INTELLIGENCE` without mutating spreadsheet state.
3. Apply the versioned business parameters deterministically for the request's format and theme.
4. Exclude deprecated, unavailable or non-`VISUALLY_ANALYZED` assets.
5. Apply the policy-defined usage, similarity and recency penalties.
6. Return ranked assets with `assetId`, `driveFileId`, `cluster`, `score` and `rank`.
7. Do not mutate `ASSET_SELECTOR`, request state or usage history.

The ranking execution is request-scoped: concurrent calls do not share mutable selector cells. The server contains the deterministic arithmetic, while all business weights, thresholds and penalties remain versioned in TOCA_OS.

### `media.assets.record_usage`

Risk class: `WRITE_REVERSIBLE`.

Input:

- `contentItemId`
- `assetId`
- `usedAt`
- `format`
- optional `channel`
- `action`: `PUBLISHED | REUSED`
- optional `notes`

Behavior:

1. Validate that the asset exists and is selectable.
2. Append one usage record to `ASSET_USAGE_LOG`.
3. Use an idempotency key derived from `contentItemId + assetId + action` to prevent duplicate writes.
4. Let `ASSET_INTELLIGENCE.LAST_USED_AT` and `USE_COUNT` remain derived state from the usage log.
5. Record the MCP execution in the normal audit pipeline.

## Boundary rules

- The MCP server must not perform visual analysis or hardcode business ranking weights that belong to TOCA_OS.
- `ASSET_RANKING_POLICY` is authoritative for weights, theme scores, usage penalties, similarity penalties, recency windows and result limits.
- `ASSET_INTELLIGENCE` is authoritative for per-asset visual metadata and operational history.
- The MCP server owns typed validation, deterministic evaluation, policy, audit, idempotency, provider invocation and normalized errors.
- Google credentials must be resolved through runtime secret references and never stored in TOCA_OS, GitHub or audit logs.
- Provider-backed tools stay unregistered until a concrete Google Sheets client, scopes and policy validation exist. A contract or adapter being present does not imply runtime connectivity.

## Current spreadsheet contract

`ASSET_INTELLIGENCE` includes dedicated `RELATED_ASSET_ID` and `SIMILARITY_SCORE` fields. `LAST_USED_AT` and `USE_COUNT` are reserved for real usage history.

`ASSET_RANKING_POLICY` currently uses policy version `RANK-1.0`. Its seven weighted dimensions sum to 1.0 and reproduce the existing selector model: format score, brand alignment, technical quality, text space, crop flexibility, novelty and theme match. Anti-repeat is governed separately by policy-defined usage, similarity and recency factors.

`ASSET_SELECTOR` remains useful for manual inspection and editorial tuning, but it is no longer a synchronization primitive for MCP ranking.

`CONTENT_REQUESTS` and `ASSET_USAGE_LOG` are the operational handoff tables for content orchestration and actual usage history.
