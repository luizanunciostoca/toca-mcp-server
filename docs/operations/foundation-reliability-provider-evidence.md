# Foundation v1 Reliability — Provider Evidence

Status: **TELEMETRY/SLO PASS; REAL DR RESTORE + VALIDATION PASS; MANAGED ALERTING AND DR CLEANUP REQUIRE EXTERNAL ADMIN ACTIONS**

Current application baseline: `main@ce70c66c129b1c629f78e776b023a7fe9cf63569`.

Authoritative release snapshot: `docs/operations/controlled-test-readiness-2026-08-16.md`.

This document supersedes earlier same-day blocker statements when later provider runs produced stronger evidence.

## Production/runtime evidence

Post-merge evidence on the exact current main SHA:

- Quality Gate `31932142394`: PASS;
- production deploy `31932142398`: PASS;
- production schema gate: `PRODUCTION_SCHEMA_MIGRATIONS_CURRENT=16`;
- authenticated minute trigger readback/smoke: PASS;
- runtime/MCP fail-closed behavior preserved;
- R29 production verification `31932355423`: PASS;
- public MCP facade remains 12 tools;
- R29 provider/durable readback, outbox, audit and fail-closed checks passed;
- R29 verifier executed no external publication.

## Telemetry and SLO source plane — PASS

Deployed reliability surfaces include:

- structured JSON logging;
- RuntimeTelemetry counters/observations;
- Prometheus rendering;
- Foundation daily control;
- Outbox stalled detection;
- stale scheduler detection;
- Audit Ledger integrity verification;
- deterministic SLO/error-budget evaluation;
- canonical P0/P1/P2 classification.

The application preserves source evidence even when managed notification delivery is unavailable.

## Cloud Monitoring — previous IAM blocker partially closed

Older runs showed HTTP 403 for Monitoring inventory. That state is obsolete.

Fresh IAM/provider readback `31928759193` proved the infrastructure-admin identity now has the required Monitoring alert-policy and notification-channel edit permissions. Provider inventory returned HTTP 200.

Current inventory:

- notification channels: `0`;
- alert policies: `0`.

### Log-based policy creation blocker

Run `31932813654` attempted to create the first Foundation log-based alert policy. The provider rejected the first create before any policy was materialized:

`Permission 'logging.notificationRules.create' denied`

Google Cloud creates a Logging notification rule behind a log-based alerting policy. The remaining predefined least-privilege role for this requirement is:

`roles/logging.configWriter`

Principal:

`toca-mcp-infra-admin@toca-mcp-production.iam.gserviceaccount.com`

The already-granted Monitoring roles should be preserved. Do not grant broad Logging Admin, Project Editor or Owner merely to close this control.

After the Logging grant, create only the minimum policies backed by existing source signals:

- P0 Audit Ledger integrity failure;
- P1 stalled Outbox;
- P1 stale scheduler jobs;
- P1 Foundation daily-control failure.

A synthetic policy/event may be used transiently for incident-generation proof, but must be deleted after the smoke.

### Managed notification delivery blocker

There is no approved notification destination and no existing managed channel.

A delivery PASS requires an owner-approved operator destination, followed by:

1. create/reuse the minimum managed notification channel;
2. attach it to the approved P0/P1 policies;
3. safely fire a synthetic signal;
4. prove the incident reached the managed destination;
5. store provider readback evidence.

No email/webhook/Pub/Sub target should be invented merely to report PASS.

## Cloud SQL recovery controls — PASS

Production `toca-mcp-db` has repeatedly been read back as:

- `RUNNABLE`;
- PostgreSQL 18;
- deletion protection enabled;
- automated backups enabled;
- PITR enabled.

## Real isolated restore drill — PASS for backup recovery path

Final recovery target:

`toca-mcp-dr-final-31932660953`

Backup:

`projects/toca-mcp-production/backups/05416bd5-6ce8-409f-85f8-c53bdcf0b8b9`

Restore evidence:

- run `31932660953`;
- artifact `9259793788`;
- backup end `2026-08-16T04:27:19.186Z`;
- restore start `2026-08-16T06:57:43Z`;
- backup-based observed RPO `9,024s`;
- target PostgreSQL 18 / Enterprise / `db-g1-small` / `southamerica-east1`;
- production never used as the target and read back unchanged.

Restored-data validation:

- run `31932980178`;
- artifact `9259838301`;
- digest `sha256:52f70ddc2e807bd61006f1d168db8953fc32c3b9045cbeb9d979eaf3c4313b84`;
- recovery migrations brought the isolated database to migration count 16;
- 21 critical tables validated;
- critical foreign keys and append-only triggers validated;
- Audit Ledger verifier completed without an integrity failure;
- validation Cloud Run job deleted;
- production readback unchanged;
- measured restore-start-to-validated-data RTO: **496s (~8m16s)**.

Foundation RTO objective <=60m is therefore validated for this backup recovery path.

### RPO caveat

The <=15-minute PostgreSQL RPO objective is associated with PITR. This drill restored the latest successful backup, which was ~2h30m old at restore start. Therefore the drill does not demonstrate <=15m RPO even though production PITR is enabled and verified. A future PITR-specific drill is required for that measured claim.

### DR cleanup blocker only

The current recovery target is still deletion-protected.

IAM probe `31932927957`:

Granted:

- `cloudsql.instances.get`;
- `cloudsql.instances.delete`.

Not granted:

- `cloudsql.instances.update`.

Exact external action:

- disable deletion protection **only** on `toca-mcp-dr-final-31932660953`;
- never alter `toca-mcp-db` deletion protection;
- then delete the temporary target with the existing deployer and prove absence + production readback.

Restore/data validation is complete; this is only cleanup.

## Current truthful closeout

PASS now:

- production deploy/schema/trigger/runtime gates;
- telemetry and SLO evaluator;
- source operational signals;
- Cloud SQL backup/PITR/deletion-protection readback;
- real isolated backup restore;
- recovered schema/data validation;
- RTO <=60m for the tested backup recovery path.

External completion still required:

1. grant `roles/logging.configWriter` to the approved infrastructure-admin identity;
2. create/read back minimum log-based Foundation policies;
3. approve a real operator notification destination and prove managed delivery;
4. remove deletion protection from the exact temporary DR target and delete/read back that target;
5. later execute a PITR-specific drill before claiming measured <=15m RPO.

WhatsApp, Email and Google Ads are intentionally deferred by the owner and tracked in #153; they are not current reliability blockers.

The truthful release statement is: **ready for controlled real-system tests in the approved current scope; full provider hardening is not yet 100% closed until managed alert delivery and temporary DR-target cleanup are completed.**
