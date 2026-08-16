# TOCA OS — Controlled Real-System Test Readiness — 2026-08-16

Status: **READY FOR CONTROLLED REAL-SYSTEM TESTS — CURRENT RELEASE SCOPE OPERATIONALLY CLOSED**

Repository closeout baseline: `main@72b2d7648c0fe08b49b37070343268a8df999147`.

Production application source SHA: `ce70c66c129b1c629f78e776b023a7fe9cf63569`.

This document is the current operational source of truth for the release scope approved on 2026-08-16.

## Release scope decision

The owner explicitly deferred these integrations to a future phase:

- WhatsApp;
- Email sending/provider integration;
- Google Ads.

They are tracked in GitHub issue #153 and do **not** block the current controlled-test release. Existing contracts/fail-closed guards are preserved.

## Application/runtime — PASS

Verified on the production source SHA:

- Quality Gate PASS;
- immutable production deploy PASS (`31932142398`);
- production schema gate at migration count 16;
- authenticated minute Scheduler trigger PASS;
- real `/tick` smoke PASS;
- Cloud Run runtime remains fail-closed and scale-to-zero;
- public TOCA Core facade remains exactly 12 tools;
- Video/R29 production verifier PASS (`31932355423`);
- provider/durable readback, Outbox and Audit Ledger checks PASS;
- no external publication executed by the R29 verifier.

## Cloud SQL disaster recovery — PASS for tested backup recovery path

Production `toca-mcp-db` remains PostgreSQL 18 in `southamerica-east1`, `RUNNABLE`, with:

- deletion protection enabled;
- automated backups enabled;
- PITR enabled.

### Restore and validation

Final recovery target used:

`toca-mcp-dr-final-31932660953`

Backup:

`projects/toca-mcp-production/backups/05416bd5-6ce8-409f-85f8-c53bdcf0b8b9`

Provider evidence:

- backup end: `2026-08-16T04:27:19.186Z`;
- restore start: `2026-08-16T06:57:43Z`;
- backup-based observed RPO: **9,024s (~2h30m)**;
- restored schema recovered to migration count 16;
- 21 critical tables validated;
- critical foreign keys and append-only triggers validated;
- Audit Ledger verifier completed without an integrity failure on the selected recovery point;
- measured restore-start-to-validated-data RTO: **496s (~8m16s)**, within the <=60m objective;
- production remained unchanged throughout the drill.

### Final cleanup — PASS

After deletion protection was disabled only on the isolated target, run `31933900598` deleted `toca-mcp-dr-final-31932660953` and read back that it no longer exists.

Final cleanup evidence also proved production remained unchanged, deletion-protected, backed up and PITR-enabled.

Artifact:

- ID `9260108983`;
- SHA-256 `e6adf99c54418b2eb19a751963e2ebfc5d94e26e609dfc10ad8ca39f3dd6cc9c`.

No temporary Cloud SQL DR target remains.

### RPO caveat

The tested drill used the latest successful backup, not a PITR timestamp. Therefore it validates the backup restore path and RTO objective, but does not demonstrate the <=15-minute PITR RPO objective. PITR is enabled and read back in production. A future PITR-specific drill is continuing reliability validation, not a blocker for this release.

## Telemetry, SLO and managed alerting — PASS for current operational path

Application-side reliability signals are deployed:

- structured JSON logging;
- RuntimeTelemetry/Prometheus;
- Foundation daily control;
- P0/P1/P2 classification;
- Outbox stalled detection;
- stale scheduler detection;
- Audit Ledger integrity verification;
- SLO/error-budget evaluator.

### IAM — PASS

Fresh readback proved the infrastructure-admin identity has the required Monitoring permissions and `logging.notificationRules.create`.

The previous Logging/Monitoring IAM blocker is closed.

### Notification channels — PASS

Primary owner-approved operations channel:

- `adm@tocadomorcego.com`;
- channel `projects/toca-mcp-production/notificationChannels/8031185508488706896`.

Secondary redundant operations channel:

- `luizidebook@gmail.com`;
- channel `projects/toca-mcp-production/notificationChannels/9216772763667438415`.

Both channels are enabled and attached to every permanent Foundation policy below.

### Permanent Foundation policies — PASS

Provider readback confirms four enabled, valid policies (`validity=null`):

- P0 `TOCA P0 Audit Ledger Integrity` — `1233118609333698263`;
- P1 `TOCA P1 Foundation Daily Control Failed` — `14464734765997818401`;
- P1 `TOCA P1 Stale Scheduler Jobs` — `3398047250843043934`;
- P1 `TOCA P1 Outbox Stalled` — `3398047250843045119`.

All four have both operational channels attached.

### Controlled firing/provider-path proof — PASS

Run `31934254574` executed a temporary log-based delivery-proof policy after both channels and all four permanent policies were configured.

Observed:

- synthetic structured log emitted after policy creation;
- log ingestion readback PASS (`DELIVERY_PROOF_LOG=PASS`);
- 120-second notification-processing window allowed;
- temporary synthetic policy deleted afterwards;
- all four permanent policies remained enabled, valid and attached to both channels;
- provider-path result: `DELIVERY_PROOF_PROVIDER_PATH=PASS`.

Artifact:

- ID `9260213391`;
- SHA-256 `af9803d8c9bbb43a8338bbd47ba64a6f61eedbe03922db2bb0479e388ee50575`.

The connected Gmail mailbox did not expose the synthetic alert during the immediate readback window, so this document does **not** claim independent mailbox-level receipt. The provider configuration, firing path, channel bindings and cleanup are nevertheless proven. Mailbox-level verification can be repeated later without changing application readiness.

## Current release classification

### PASS

- application code and Quality Gate;
- production deploy and schema;
- scheduler and real `/tick` smoke;
- fail-closed runtime and 12-tool Core facade;
- Video/R29 production readback/audit;
- Cloud SQL backups/PITR/deletion protection;
- real isolated backup restore;
- restored-data validation;
- measured RTO <=60m;
- DR cleanup with no temporary target left behind;
- telemetry/SLO source plane;
- Monitoring/Logging IAM;
- two managed operations notification channels;
- four permanent Foundation alert policies;
- controlled log-based alert provider-path firing proof.

### Explicitly deferred to future scope

- WhatsApp;
- Email sending/provider integration;
- Google Ads.

Tracking: #153.

## Final release statement

**TOCA OS is ready for controlled real-system tests in the approved current release scope. No known application, deployment, Cloud SQL cleanup, Monitoring IAM, notification-channel or permanent alert-policy blocker remains. WhatsApp, Email sending/provider integration and Google Ads are intentionally deferred to future implementation. A future PITR-specific RPO drill and optional mailbox-level alert receipt recheck are continuing operational validation, not current release blockers.**
