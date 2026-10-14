# TOCA MCP Server

Deterministic execution layer for ChatGPT governed by the TOCA_OS business source of truth in Google Drive.

## Production status

The repository is beyond bootstrap. The production foundation currently includes:

- private Streamable HTTP MCP transport at `/mcp`;
- health/readiness boundaries;
- Meta OAuth, webhook and secret-management boundaries;
- provider-backed Instagram history/insights reads;
- Meta Ads read capabilities;
- persistent PostgreSQL scheduling;
- TOCA-managed Instagram scheduling tools;
- an autonomous singleton Cloud Run daemon that claims due jobs from PostgreSQL;
- idempotent Instagram publication with provider-backed reconciliation before retry;
- private GCS asset delivery through short-lived signed URLs;
- audit, dead-letter and fail-closed execution controls;
- a single Autonomy Gate, Autopilot Readiness Gate, scoped kill switches, shadow/canary governance and provider-backed capability evidence gating.

`TOCA_OS / Google Drive` remains the business source of truth. GitHub is the source of truth for code, schemas, tests and infrastructure. External providers remain authoritative for external side effects.

## Active production topology

```text
ChatGPT
  -> TOCA_OS business policy/context
  -> private TOCA MCP service
       -> typed MCP tools
       -> PostgreSQL scheduled_jobs / audit_events / provider_publications
  -> TOCA-managed Instagram daemon (singleton Cloud Run service)
       -> claimDue()
       -> approval/audit gate
       -> provider reconciliation
       -> idempotent Instagram publication
       -> provider confirmation
```

Scheduling is an application operation and must use the protected `instagram.toca_schedule.*` MCP surface. Git commits and application redeploys are not the normal publication clock or scheduling API.

## Quality gate

Every promoted change must pass:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm architecture:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

See `docs/architecture/README.md`, `docs/architecture/routes-capabilities-v1.md`,
`docs/architecture/toca-managed-instagram-scheduler-v1.md`,
`docs/operations/infrastructure-control-plane.md` and
`docs/operations/autonomy-readiness-closeout-2026-08-26.md` for the current contracts and release evidence.

## AG-09 analytics source (native TOCA)

AG-09 / R08 / R31 must query Meta Ads through the TOCA-owned `meta_ads.insights.get`
route backed by `MetaAdsReadProvider` and the Meta Marketing API. Adplane,
Windsor.ai or any other external reporting connector is not an AG-09 data source
or automatic fallback. Missing data must not be converted to zero or invented
revenue/ROAS. See `docs/operations/ag09-native-analytics-source.md`.

The owner confirmed `luizanunciostoca/toca-mcp-server` as the canonical repository
for this native TOCA Meta Ads route. AG-09 does not require a separate `toca-media-server`
repository or an external reporting service.
