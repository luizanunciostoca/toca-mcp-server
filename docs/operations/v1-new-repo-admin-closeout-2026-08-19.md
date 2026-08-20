# TOCA OS V1 — New-repository administrative closeout — 2026-08-19

Status: **BLOCKED ONLY ON GCP BILLING ENABLEMENT — APPLICATION / WIF / CLOUD SQL GATES VERIFIED**

## Scope

This runbook records the hosted-control closeout after migration from `luizidebook/toca-mcp-server` to `luizanunciostoca/toca-mcp-server`.

Do not use this document to enable campaign activation, publish Instagram content, broaden provider permissions, or start post-V1 feature work.

## 1. Canonical release identity

- Canonical repository: `luizanunciostoca/toca-mcp-server`
- V1 final application SHA on `main`: `abfb09b17e90c83790e803dcda091c8142c7407f`
- `main` API readback: `protected=true`
- Classic protection payload does not expose required checks (`protection.enabled=false`), so the exact Ruleset clauses are not independently asserted here.

## 2. Workload Identity Federation — CLOSED

Provider:

`projects/990081828836/locations/global/workloadIdentityPools/github/providers/github-toca-mcp`

The original new-repository failure was:

`unauthorized_client: The given credential is rejected by the attribute condition.`

That blocker is now closed. Current GitHub Actions runs from `luizanunciostoca/toca-mcp-server` successfully complete `google-github-actions/auth` using:

`toca-mcp-deployer@toca-mcp-production.iam.gserviceaccount.com`

Therefore the new repository identity is accepted by Google STS. No further WIF change is required for V1 closeout.

## 3. Current Cloud SQL / DR readback — PASS

Final diagnostic readback run `32325042036` independently verified the current production database state:

- instance: `toca-mcp-db`
- state: `RUNNABLE`
- database version: `POSTGRES_18`
- region: `southamerica-east1`
- deletion protection: `true`
- automated backups: `true`
- PITR: `true`
- retained backups: `7`
- transaction-log retention: `7` days
- latest successful backup: `2026-08-19T03:45:56.366Z`
- latest backup age at readback: `82069` seconds
- earliest recovery time: `2026-08-13T03:57:06.184Z`
- latest recovery time: `2026-08-20T02:29:27.311355170Z`
- latest recovery lag at readback: `258` seconds
- result: `V1_CLOUD_SQL_DR_READBACK=PASS`

Sanitized evidence artifact:

- artifact id: `9391052044`
- name: `v1-final-production-readback-b97b2bcb2448943663cdadbb3a1fed69423a0678`
- artifact ZIP SHA-256: `8539b62fd8f5c33e458ae8b3638e183fc9f6b2c3b290eebc42a57a40b42f2501`

Historical isolated restore / PITR / RPO / RTO evidence remains valid in `docs/operations/cloud-sql-pitr-rpo-drill-2026-08-16.md`; destructive DR operations do not need to be repeated merely because the GitHub repository identity changed.

## 4. Cloud Run exact-release status — BLOCKED BY BILLING

Current production readback shows both Cloud Run services still reference the previous immutable image:

`.../server:toca-managed-daemon-ac0ba469a57f12c801148b5821e14e34fd86d281`

Observed revisions:

- daemon: `toca-managed-instagram-daemon-00058-qnd`
- MCP: `toca-mcp-production-00061-67h`

Expected V1 final image tag:

`.../server:toca-managed-daemon-abfb09b17e90c83790e803dcda091c8142c7407f`

Temporary exact-redeploy run `32325183160` proved:

1. exact checkout of `abfb09b17e90c83790e803dcda091c8142c7407f` — PASS;
2. exact-release `pnpm quality` — PASS;
3. 106 test files passed, 3 skipped; 496 tests passed, 4 skipped;
4. TypeScript build — PASS;
5. WIF authentication — PASS;
6. Docker build of the exact release — PASS;
7. local image digest: `sha256:7c24fc70c47b6e75b657fe4d96fdfc3b43c061327446501330c00fb2c494ad46`;
8. Artifact Registry push — BLOCKED before upload with `BILLING_DISABLED`.

Because the image push failed, no Cloud Run deployment occurred in that attempt and no Instagram publication was executed.

## 5. Cloud Scheduler status — BLOCKED BY BILLING

Current Scheduler readback is blocked by the same project-level condition:

`BILLING_DISABLED`

The API reports that billing must be enabled for project number `990081828836` before `cloudscheduler.googleapis.com` can be used.

The scheduler must not be declared current until billing is enabled and a successful readback verifies:

- job: `toca-managed-instagram-tick`
- state: `ENABLED`
- schedule: `* * * * *`
- timezone: `America/Bahia`
- HTTP method: `POST`

## 6. Single remaining hosted blocker

The only hard external blocker currently proven for V1 closeout is:

**Google Cloud billing disabled for project `toca-mcp-production` (`990081828836`).**

This single condition blocks both:

- pushing the final immutable image to Artifact Registry;
- reading/reconciling Cloud Scheduler.

It is not an application-code failure, GitHub Actions failure, WIF failure, Cloud SQL failure, or missing V1 feature.

## 7. Exact closeout sequence after billing is enabled

1. rerun exact-redeploy workflow run `32325183160`;
2. require immutable image push for SHA `abfb09b17e90c83790e803dcda091c8142c7407f` to succeed;
3. deploy daemon and MCP using the existing safety boundaries;
4. verify both Cloud Run services use the exact V1 image and are Ready;
5. verify daemon flags: MCP off, scheduler on, executor on, publication writes off;
6. verify MCP flags: MCP on, scheduler on, executor off, publication writes on, Instagram account `17841402033495654`, `META_ENABLED=false`, token key bound through `TOCA_SECRET_META_ACCESS_TOKEN`;
7. rerun final production readback;
8. verify Scheduler state/schedule/timezone/method;
9. reverify Cloud SQL DR state without repeating destructive restore/PITR drills;
10. write final durable closeout evidence;
11. remove both temporary closeout workflows;
12. run exact-head Quality Gate;
13. merge PR #13;
14. read back final `main` SHA and `protected=true`;
15. only then classify `V1 = PRODUCTION_VERIFIED` and begin post-V1 implementation.

## 8. Explicit safety statement

No Instagram publication was executed solely to validate deployment. No advertising campaign was activated for testing. Post-V1 Creative Truth, Demand Intelligence and Photo-to-Video work remains isolated in Draft PRs and is not part of this V1 closeout.
