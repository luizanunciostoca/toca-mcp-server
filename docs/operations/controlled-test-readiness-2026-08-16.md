# TOCA OS — Controlled Real-System Test Readiness — 2026-08-16

Status: **READY FOR CONTROLLED REAL-SYSTEM TESTS — CURRENT RELEASE SCOPE OPERATIONALLY CLOSED**

Repository closeout baseline: `main@58f31df28e63629d3933bbce67bf912932d05829`.

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

## Cloud SQL disaster recovery — PASS for backup and PITR recovery paths

Production `toca-mcp-db` remains PostgreSQL 18 in `southamerica-east1`, `RUNNABLE`, with:

- deletion protection enabled;
- automated backups enabled;
- PITR enabled.

### Isolated backup restore and validation — PASS

Recovery target used:

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

Backup cleanup run `31933900598` deleted `toca-mcp-dr-final-31932660953` and read back that it no longer exists. Production remained unchanged, deletion-protected, backed up and PITR-enabled.

Backup cleanup artifact:

- ID `9260108983`;
- SHA-256 `e6adf99c54418b2eb19a751963e2ebfc5d94e26e609dfc10ad8ca39f3dd6cc9c`.

### Isolated PITR/RPO drill — PASS

Run `31936171307`, attempt 2, executed a real timestamp-based PostgreSQL PITR restore to the separate target:

`toca-mcp-pitr-31936171307`

Before mutation, live IAM and production-safety preflights passed. Production itself was never the restore target and its deletion protection was never disabled.

Provider recovery-window evidence at `2026-08-16T08:34:46Z`:

- latest recoverable time: `2026-08-16T08:32:38.577470502Z`;
- latest-recovery lag: **128s (2m08s)**, within the <=15m objective.

Selected PITR timestamp:

`2026-08-16T08:26:12.648Z`

Measured PITR RPO:

**514s (8m34s)**.

The <=15-minute PITR RPO objective therefore passes.

Temporal-boundary proof reused existing append-only production evidence instead of inserting a synthetic database marker:

- before: `operational_signals/c24795ae-14f1-4952-80af-314187c1ff78` at `2026-08-16T08:26:10.648Z` — present in the restored target;
- after: `audit_ledger_events/49fff740-196b-4a0b-a5f1-d68a14e02ad3` at `2026-08-16T08:29:42.328Z` — absent from the restored target.

PITR restored-data validation proved:

- PostgreSQL connection succeeded;
- migration count 16;
- 22 critical tables readable;
- critical foreign keys validated;
- required append-only triggers enabled;
- intended before/after recovery boundary reproduced.

Timing:

- restore-to-`RUNNABLE`: **549s (9m09s)**;
- restore-start-to-validated-data RTO: **584s (9m44s)**;
- <=60m RTO objective: **PASS**.

Final provider assertion:

`CLOUD_SQL_PITR_RPO_DRILL=PASS rpo_seconds=514 rto_seconds=584 provider_latest_lag_seconds=128`

### PITR final cleanup — PASS

The workflow disabled deletion protection only on the temporary PITR target, deleted the validation/probe jobs, deleted `toca-mcp-pitr-31936171307`, and read back target absence.

Post-cleanup evidence proved production remained:

- `RUNNABLE`;
- deletion-protected;
- backed up;
- PITR-enabled;
- unchanged against the normalized pre-drill settings snapshot.

Successful PITR evidence artifact:

- ID `9261022842`;
- SHA-256 `6524043e56f2eacef34b129fa7eb2c7130711ce43e3071f67476573527dd5140`.

Canonical PITR evidence:

`docs/operations/cloud-sql-pitr-rpo-drill-2026-08-16.md`

No temporary Cloud SQL DR target remains from either tested recovery path.

### RPO/RTO classification

The recovery modes now have separate measured evidence:

- backup restore: validated; backup-age RPO **9,024s (~2h30m)**; RTO **496s (~8m16s)**;
- PITR restore: validated; RPO **514s (8m34s)**; RTO **584s (9m44s)**;
- PostgreSQL PITR RPO <=15m: **PASS**;
- PostgreSQL recovery RTO <=60m: **PASS**.

The former PITR-specific RPO evidence gap is closed.

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
- real isolated timestamp PITR restore;
- restored-data validation;
- measured RTO <=60m on both tested recovery paths;
- measured PITR RPO <=15m;
- DR cleanup with no temporary target left behind;
- production unchanged readback after DR drill;
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

**TOCA OS is ready for controlled real-system tests in the approved current release scope. No known application, deployment, Cloud SQL backup/PITR recovery, RPO/RTO, DR cleanup, Monitoring IAM, notification-channel or permanent alert-policy blocker remains. WhatsApp, Email sending/provider integration and Google Ads are intentionally deferred to future implementation. Optional mailbox-level alert receipt recheck remains continuing operational validation and does not alter the completed DR proof.**
