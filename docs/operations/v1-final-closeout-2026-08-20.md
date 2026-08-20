# TOCA OS V1 — Final Production Closeout — 2026-08-20

Status: **PRODUCTION_VERIFIED — FINAL HOSTED READBACK PASS**

## Canonical release identity

- Repository: `luizanunciostoca/toca-mcp-server`
- Canonical release branch: `main`
- V1 release SHA deployed and verified: `abfb09b17e90c83790e803dcda091c8142c7407f`
- Final runtime redeploy workflow run: `32325385858`
- Final hosted production readback workflow run: `32325385886`
- Final sanitized readback artifact ID: `9393447493`

This closeout records the exact bounded V1 production state after the repository migration. It does not promote post-V1 feature branches or broaden provider permissions.

## 1. Repository migration hosted controls

### Google Workload Identity Federation

The new repository identity is accepted by the production Workload Identity Federation provider. The final redeploy and readback runs authenticated successfully as:

`toca-mcp-deployer@toca-mcp-production.iam.gserviceaccount.com`

The previous `unauthorized_client` attribute-condition blocker is closed.

### GitHub main protection

API readback for `main` reports `protected=true`. The repository is therefore no longer in the unprotected hosted state observed immediately after migration.

## 2. Exact V1 runtime deployment

The exact V1 release SHA was rebuilt, pushed as an immutable image and deployed to both production Cloud Run services.

Image:

`southamerica-east1-docker.pkg.dev/toca-mcp-production/toca-mcp/server:toca-managed-daemon-abfb09b17e90c83790e803dcda091c8142c7407f`

Final readback:

- daemon service: `toca-managed-instagram-daemon`
- daemon revision: `toca-managed-instagram-daemon-00059-wnh`
- daemon image verified: `true`
- daemon `MCP_ENABLED=false`
- daemon scheduler enabled: `true`
- daemon executor enabled: `true`
- daemon Instagram publication writes enabled: `false`
- MCP service: `toca-mcp-production`
- MCP revision: `toca-mcp-production-00062-rmc`
- MCP image verified: `true`
- MCP `MCP_ENABLED=true`
- MCP scheduler enabled: `true`
- MCP executor enabled: `false`
- MCP Instagram publication writes enabled: `true`
- MCP Instagram account binding: `17841402033495654`
- MCP `META_ENABLED=false`
- MCP token environment key: `TOCA_SECRET_META_ACCESS_TOKEN`

The deploy/readback did **not** publish Instagram content.

## 3. Cloud Scheduler production boundary

Final readback verified:

- job: `toca-managed-instagram-tick`
- state: `ENABLED`
- schedule: `* * * * *`
- timezone: `America/Bahia`
- HTTP method: `POST`

The earlier `BILLING_DISABLED` blocker is closed.

## 4. Cloud SQL / DR current-state readback

Instance: `toca-mcp-db`

Final readback verified:

- state: `RUNNABLE`
- database version: `POSTGRES_18`
- region: `southamerica-east1`
- deletion protection: enabled
- automated backups: enabled
- PITR: enabled
- retained backups: `7`
- transaction-log retention: `7` days
- latest successful backup: `2026-08-20T04:07:12.168Z`
- latest backup age at readback: `1607` seconds
- earliest recovery time: `2026-08-13T03:57:06.184Z`
- latest recovery time: `2026-08-20T04:31:51.544946078Z`
- latest recovery lag: `128` seconds

Result:

`V1_CLOUD_SQL_DR_READBACK=PASS`

Historical isolated restore/PITR drill evidence remains authoritative for destructive DR proof; this closeout intentionally used readback rather than repeating unnecessary destructive recovery operations.

## 5. CI / code-quality evidence

V1 code closeout includes:

- repository formatting blocker repaired;
- Instagram direct-publication Core integration merged and exact-head Quality green;
- Foundation restart/retry/dead-letter safety merged;
- permanent PostgreSQL E2E expanded to cover scheduler/worker restart-safety paths;
- exact V1 release local Quality revalidation passed before redeploy;
- final closeout PR must pass the normal repository Quality Gate again after temporary workflow removal and durable documentation finalization.

The Foundation PostgreSQL E2E exact-head evidence remains green for the merged V1 release.

## 6. Meta Ads V1 boundary

Previously verified V1 production evidence remains unchanged:

`READ -> PREPARE -> CREATE_PAUSED -> independent READBACK`

The provider-created campaign resources remained `PAUSED`, with no activation performed solely for validation.

## 7. Explicitly deferred scope

The following are not V1 blockers and are not promoted by this closeout:

- real Google Ads provider execution;
- real WhatsApp provider execution;
- real Email provider execution;
- Creative Truth / Venue Fidelity next-phase work;
- Demand Intelligence next-phase work;
- Photo-to-Video next-phase work;
- broader AG-01 external runtime and advanced CRM/Sales expansion.

Those areas require separate version/phase promotion and their own evidence gates.

## 8. Final V1 classification

Hosted production readback result:

`V1_FINAL_HOSTED_READBACK=PASS`

Subject to the final documentation-only PR head passing the repository Quality Gate and merging cleanly, the deployed V1 runtime itself is classified:

**V1 = PRODUCTION_VERIFIED**

No Instagram publication and no advertising activation were performed solely to obtain this classification.
