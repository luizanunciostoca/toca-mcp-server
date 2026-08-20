# TOCA OS V1 — New-repository administrative closeout — 2026-08-19

Status: **CLOSED — HOSTED CONTROLS VERIFIED**

## Scope

This runbook records the hosted-control closeout after migration from `luizidebook/toca-mcp-server` to `luizanunciostoca/toca-mcp-server`.

Do not use this document to enable campaign activation, publish Instagram content, broaden provider permissions, or start post-V1 feature work.

## 1. Canonical release identity

- canonical repository: `luizanunciostoca/toca-mcp-server`
- V1 final application SHA: `abfb09b17e90c83790e803dcda091c8142c7407f`
- GitHub `main` API readback: `protected=true`
- exact Ruleset clauses are not independently asserted by the classic branch-protection payload

## 2. Workload Identity Federation — CLOSED

The previous new-repository failure:

`unauthorized_client: The given credential is rejected by the attribute condition.`

is closed.

Current GitHub Actions runs from `luizanunciostoca/toca-mcp-server` authenticate successfully through:

`projects/990081828836/locations/global/workloadIdentityPools/github/providers/github-toca-mcp`

using:

`toca-mcp-deployer@toca-mcp-production.iam.gserviceaccount.com`

No further WIF change is required for V1.

## 3. Google Cloud billing — CLOSED

The temporary `BILLING_DISABLED` blocker for project `toca-mcp-production` / `990081828836` is closed.

After billing was re-enabled:

- Artifact Registry accepted the immutable V1 image push;
- Cloud Scheduler API access resumed;
- exact runtime redeploy completed;
- final hosted readback passed.

## 4. Exact V1 production runtime — PASS

Final exact redeploy workflow run:

`32325385858`

Verified immutable image:

`southamerica-east1-docker.pkg.dev/toca-mcp-production/toca-mcp/server:toca-managed-daemon-abfb09b17e90c83790e803dcda091c8142c7407f`

Final production revisions:

- daemon: `toca-managed-instagram-daemon-00059-wnh`
- MCP: `toca-mcp-production-00062-rmc`

Both services use the exact V1 image and passed their safety-boundary checks.

No Instagram publication was executed by the deployment validation.

## 5. Cloud Scheduler — PASS

Final readback verified:

- job: `toca-managed-instagram-tick`
- state: `ENABLED`
- schedule: `* * * * *`
- timezone: `America/Bahia`
- HTTP method: `POST`

## 6. Cloud SQL / DR — PASS

Final hosted readback workflow run:

`32325385886`

Verified:

- instance: `toca-mcp-db`
- state: `RUNNABLE`
- database version: `POSTGRES_18`
- region: `southamerica-east1`
- deletion protection: enabled
- automated backups: enabled
- PITR: enabled
- retained backups: `7`
- transaction-log retention: `7` days
- latest successful backup: `2026-08-20T04:07:12.168Z`
- latest backup age: `1607` seconds
- earliest recovery time: `2026-08-13T03:57:06.184Z`
- latest recovery time: `2026-08-20T04:31:51.544946078Z`
- latest recovery lag: `128` seconds

Result:

`V1_CLOUD_SQL_DR_READBACK=PASS`

Historical destructive restore/PITR/RPO/RTO evidence remains authoritative; no unnecessary destructive recovery operation was repeated during repository-migration closeout.

## 7. Final hosted gate

Final sanitized evidence artifact:

- artifact id: `9393447493`
- run: `32325385886`

Final gate result:

`V1_FINAL_HOSTED_READBACK=PASS`

## 8. Remaining repository-only closeout

After this hosted-control closeout, only repository hygiene remains:

1. persist final closeout documentation;
2. remove temporary exact-redeploy and readback workflows;
3. pass the normal Quality Gate on the clean documentation-only PR head;
4. merge PR #13;
5. read back final `main` SHA and `protected=true`.

## 9. Explicit safety statement

No Instagram publication was executed solely to validate deployment. No advertising campaign was activated for testing. Creative Truth, Demand Intelligence and Photo-to-Video remain post-V1 scope and are not promoted by this closeout.
