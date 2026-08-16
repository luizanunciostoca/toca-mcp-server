# TOCA OS — Controlled Real-System Test Readiness — 2026-08-16

Status: **READY FOR CONTROLLED REAL-SYSTEM TESTS WITH EXPLICIT EXTERNAL HARDENING ITEMS**

Authoritative application baseline: `main@ce70c66c129b1c629f78e776b023a7fe9cf63569`.

This document is the current closeout snapshot for the release scope approved on 2026-08-16. It supersedes older blocker/status statements in reliability and DR documents when those statements conflict with the provider evidence below.

## Release scope decision

The owner explicitly deferred these integrations to a future phase:

- WhatsApp;
- Email;
- Google Ads.

They remain catalogued/fail-closed where applicable and are tracked in GitHub issue #153. They do **not** block the current controlled-test release. No real WhatsApp/email audience send and no Google Ads activation were performed to manufacture readiness.

## Current application/runtime truth

Production source SHA:

`ce70c66c129b1c629f78e776b023a7fe9cf63569`

Verified on that exact SHA:

- post-merge Quality Gate: PASS (`31932142394`);
- immutable production deploy: PASS (`31932142398`);
- official production schema gate: `PRODUCTION_SCHEMA_MIGRATIONS_CURRENT=16`;
- authenticated minute-trigger provision/readback: PASS;
- real `/tick` smoke: PASS;
- Cloud Run runtime remains fail-closed and scale-to-zero;
- TOCA Core public MCP facade remains exactly 12 tools;
- Video/R29 production verifier: PASS (`31932355423`);
- R29 provider/durable readback verified;
- one append-only artifact and one transactional Outbox event verified;
- Audit Ledger verification passed for the R29 production execution;
- no external publication was executed by the R29 verifier.

Representative R29 verifier result:

- source SHA: `ce70c66c129b1c629f78e776b023a7fe9cf63569`;
- execution surface: `toca.execute`;
- execution engine: `executeCoreCapability`;
- public tool count: `12`;
- `providerReadbackVerified=true`;
- `durableReadbackVerified=true`;
- `artifactRows=1`;
- `outboxRows=1`;
- `auditValid=true`;
- `failClosed=true`;
- `externalPublicationExecuted=false`.

## Cloud SQL recovery controls

Production `toca-mcp-db` is PostgreSQL 18 in `southamerica-east1` and has been repeatedly read back as:

- `RUNNABLE`;
- deletion protection enabled;
- automated backups enabled;
- PITR enabled.

### Real isolated restore drill

Final recovery target:

`toca-mcp-dr-final-31932660953`

Backup:

`projects/toca-mcp-production/backups/05416bd5-6ce8-409f-85f8-c53bdcf0b8b9`

Restore evidence (`31932660953`, artifact `9259793788`):

- backup completed: `2026-08-16T04:27:19.186Z`;
- restore began: `2026-08-16T06:57:43Z`;
- target created as PostgreSQL 18, Enterprise, tier `db-g1-small`, `southamerica-east1`;
- source production instance was not used as the restore target;
- production readback remained unchanged;
- backup-based RPO observed at restore start: **9,024 seconds (~2h30m)**.

The target inherited deletion protection from the provider even though the new-target restore requested no deletion protection.

### Restored-data validation

Run `31932980178`, artifact `9259838301`, artifact digest:

`sha256:52f70ddc2e807bd61006f1d168db8953fc32c3b9045cbeb9d979eaf3c4313b84`

Validation executed against the isolated target using the exact deployed production image. It proved:

- recovery migrations `020_content_item_versioning_video.sql` and `021_r29_video_artifacts.sql` applied only to the isolated target;
- `PRODUCTION_SCHEMA_MIGRATIONS_CURRENT=16` on the recovery target;
- `DR_DATABASE_VALIDATION=PASS migrations=16 critical_tables=21 audit_executions=0`;
- 21 critical tables readable;
- critical foreign keys validated;
- required append-only triggers enabled;
- Audit Ledger verifier completed without an integrity failure (the selected recovery point contained zero ledger executions);
- temporary validation job deleted;
- production remained unchanged, protected, backed up and PITR-enabled.

Measured recovery time from restore start through schema recovery and validation:

**RTO = 496 seconds (~8m16s)**, within the Foundation RTO objective of 60 minutes.

The backup drill does **not** prove the <=15-minute RPO objective. The selected successful backup was ~2h30m old at restore start. Production PITR remains enabled; a future PITR-specific drill is required to measure the <=15-minute RPO objective truthfully.

### Remaining DR cleanup only

The current deployer has:

- `cloudsql.instances.get`;
- `cloudsql.instances.delete`.

It does not have `cloudsql.instances.update` (`31932927957`). The isolated recovery target is still `deletionProtection=true`.

External provider-admin action required:

1. disable deletion protection **only** on `toca-mcp-dr-final-31932660953`;
2. never alter deletion protection on `toca-mcp-db`;
3. after the target becomes unprotected, the deployer can delete it and record absence + production readback.

Cloud SQL requires deletion protection to be disabled before an instance can be deleted. This is a cleanup blocker, not a failed restore or failed data-validation blocker.

## Telemetry, SLO and Cloud Monitoring

Application-side reliability signals are deployed and operational:

- structured JSON logging;
- RuntimeTelemetry/Prometheus surfaces;
- Foundation daily control;
- P0/P1/P2 classification;
- Outbox stale detection;
- stale scheduler detection;
- Audit Ledger integrity verification;
- SLO/error-budget evaluator.

Fresh IAM/provider readback (`31928759193`) proved the infrastructure-admin identity can now list/create/update/delete Monitoring alert policies and notification channels. The earlier Monitoring-IAM blocker is therefore obsolete.

However, inventory currently contains:

- zero notification channels;
- zero alert policies.

A real attempt to create the first **log-based** Foundation policy (`31932813654`) failed before any policy was created with:

`logging.notificationRules.create` denied.

Google Cloud requires a Logging notification rule for log-based alert policies. The remaining least-privilege predefined role is:

`roles/logging.configWriter`

for:

`toca-mcp-infra-admin@toca-mcp-production.iam.gserviceaccount.com`

After that grant, create only policies backed by existing source signals:

- P0 Audit Ledger integrity failure;
- P1 stalled Outbox;
- P1 stale scheduler jobs;
- P1 Foundation daily-control failure.

Do not create duplicate application metrics merely to satisfy the checklist.

### Notification delivery

No operator notification destination has been approved/configured. No email/webhook/Pub/Sub destination should be invented merely to report PASS.

A final managed-delivery PASS requires:

1. owner-approved operator destination;
2. minimum managed notification channel;
3. policy attachment;
4. safe synthetic firing test;
5. delivery/readback evidence.

Current external closeout is tracked in issue #154.

## Readiness classification

### PASS now

- source/main reconciliation;
- Quality Gate;
- build/deploy;
- production schema gate;
- authenticated scheduler trigger;
- Cloud Run runtime fail-closed behavior;
- 12-tool public Core facade;
- Video/R29 production execution/readback/audit;
- Cloud SQL backup/PITR/deletion-protection readback;
- real isolated backup restore;
- recovered schema migration to current version;
- critical restored-data validation;
- measured RTO within objective;
- telemetry/SLO source code and runtime signals.

### Explicitly deferred, non-blocking

- WhatsApp;
- Email;
- Google Ads.

Tracking: #153.

### External hardening still open

- grant `roles/logging.configWriter` to the approved infrastructure-admin identity so log-based policies can materialize;
- select/approve the real operator notification destination and prove managed delivery;
- disable deletion protection on the exact temporary DR target `toca-mcp-dr-final-31932660953`, then delete/read back that target;
- later run a PITR-specific drill if the <=15-minute RPO objective must be provider-validated rather than merely protected by enabled PITR.

Tracking: #145 and #154.

## Final release statement

The truthful current statement is:

**TOCA OS is ready for controlled real-system tests in the current release scope. Core/runtime/deploy/R29 and the isolated Cloud SQL recovery path have real provider evidence. WhatsApp, Email and Google Ads are intentionally deferred. Full operational hardening is not yet 100% closed because log-based managed alert creation/delivery and deletion of the protected temporary DR target still require explicit provider-admin actions.**
