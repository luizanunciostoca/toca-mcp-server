# Cloud SQL Disaster Recovery Runbook

Status: **OPERATOR READY — NON-DESTRUCTIVE BY DEFAULT**

This runbook is the canonical manual procedure for validating and exercising Disaster Recovery for the TOCA OS production PostgreSQL Cloud SQL instance without depending on GitHub Actions.

## Scope

Covered:

- automated backups;
- point-in-time recovery (PITR);
- isolated backup restore;
- isolated PITR restore;
- RPO and RTO measurement;
- restored-data validation;
- evidence preservation;
- deterministic cleanup.

Not covered:

- product feature changes;
- restoring over production during a drill;
- disabling production deletion protection;
- destructive mutation of the production database merely to create test evidence.

## Production identity and hard safety boundary

Canonical production instance:

- project: `toca-mcp-production`;
- instance: `toca-mcp-db`;
- region: `southamerica-east1`;
- engine: PostgreSQL 18.

Every drill target MUST use a separate, explicitly temporary instance name.

Recommended patterns:

- backup restore: `toca-mcp-dr-<timestamp-or-run-id>`;
- PITR restore: `toca-mcp-pitr-<timestamp-or-run-id>`.

Fail closed if any of the following is true:

1. target instance name equals `toca-mcp-db`;
2. source instance is not `RUNNABLE`;
3. source is not PostgreSQL 18;
4. source region is not `southamerica-east1`;
5. production deletion protection is not enabled;
6. automated backups are not enabled;
7. PITR is not enabled for a PITR drill;
8. the operator cannot prove the target identity immediately before any target-only destructive cleanup step.

Production deletion protection MUST NOT be disabled by a drill.

## 1. Read-only preflight

Before any restore operation, record a provider readback for `toca-mcp-db` containing at least:

- timestamp in UTC;
- state;
- database version;
- region;
- deletion-protection state;
- automated-backup state;
- PITR state;
- configured backup retention;
- configured transaction-log retention;
- latest successful backup timestamp;
- earliest and latest recoverable PITR timestamps when PITR is being tested.

Expected policy values in this repository are:

- retained backups: 7;
- transaction-log retention: 7 days;
- latest successful backup age: <=36 hours;
- PITR enabled.

If the live provider readback disagrees with repository policy, STOP. Treat provider state as source of truth and reconcile configuration before a new drill.

## 2. Evidence clock

Use UTC for every timestamp. Capture timestamps from the provider/runtime rather than relying only on an operator workstation clock.

Minimum timing fields:

- `reference_time`;
- `recovery_point` or backup end time;
- `restore_started_at`;
- `target_runnable_at`;
- `validation_completed_at`;
- `cleanup_completed_at`.

Definitions:

- PITR RPO = `reference_time - selected_recovery_point`;
- restore-to-RUNNABLE = `target_runnable_at - restore_started_at`;
- validated-data RTO = `validation_completed_at - restore_started_at`.

V1 objectives:

- PITR RPO <=15 minutes (900 seconds);
- PostgreSQL validated-data RTO <=60 minutes (3600 seconds).

A backup restore may have an older backup-based recovery point than the PITR objective. Do not misclassify backup age as the PITR RPO.

## 3. Isolated backup-restore drill

### 3.1 Select recovery material

Select a successful production backup and record:

- provider backup identifier;
- backup start/end time;
- source instance;
- source project;
- backup status.

Do not restore over production.

### 3.2 Create temporary target

Restore the selected backup into a new target matching the temporary naming pattern.

Immediately record:

- target name;
- target project/region;
- restore start time;
- provider operation identifier.

Wait until the target becomes `RUNNABLE` and record the timestamp.

### 3.3 Validate restored database

Validation must use the application/runtime database stack where practical and prove at minimum:

- PostgreSQL connection succeeds;
- `schema_migrations` is readable and migration count is coherent with the release;
- all critical application tables are present and readable;
- critical foreign keys are valid/not left unvalidated;
- required append-only/audit triggers are enabled;
- audit/integrity verification reports no corruption.

Record a deterministic final assertion such as:

`DR_DATABASE_VALIDATION=PASS migrations=<n> critical_tables=<n>`

Record `validation_completed_at` and calculate validated-data RTO.

## 4. Isolated PITR drill

### 4.1 Read provider recovery window

Read and preserve:

- earliest recoverable time;
- latest recoverable time;
- readback/reference timestamp.

Compute latest-recovery lag. For V1, require <=900 seconds.

### 4.2 Choose a temporal boundary safely

Prefer existing append-only evidence over writing a synthetic production marker solely for a drill.

Choose:

- one durable record immediately before the selected recovery timestamp;
- one durable record after it.

Record table, identifier and provider/database timestamp for both.

The chosen recovery timestamp must be within the provider recovery window.

### 4.3 Restore to a temporary target

Restore production to a separate `toca-mcp-pitr-*` target at the selected timestamp.

Never make `toca-mcp-db` the target.

Record restore start and target-RUNNABLE timestamps.

### 4.4 Validate temporal boundary and database health

In addition to the database checks in section 3.3, prove:

- before-boundary record is present;
- after-boundary record is absent.

Record a final assertion such as:

`DR_PITR_VALIDATION=PASS migrations=<n> critical_tables=<n> before_marker_present=1 after_marker_absent=1`

Record `validation_completed_at`.

Calculate:

- PITR RPO;
- restore-to-RUNNABLE;
- validated-data RTO.

The drill is PASS only if the temporal proof succeeds and V1 RPO/RTO objectives are met.

## 5. Cleanup

Cleanup applies only to resources created specifically for the drill.

Before disabling deletion protection on a temporary Cloud SQL target:

1. re-read target identity from the provider;
2. prove the target name matches the expected `toca-mcp-dr-*` or `toca-mcp-pitr-*` value for this drill;
3. prove the target name is NOT `toca-mcp-db`;
4. capture the target state in evidence.

Then:

- delete temporary validation/probe jobs;
- disable deletion protection only on the temporary target if required;
- delete the temporary target;
- read back the target and prove absence;
- re-read `toca-mcp-db`.

The final production readback must prove:

- production remains `RUNNABLE`;
- production deletion protection remains enabled;
- automated backups remain enabled;
- PITR remains enabled;
- normalized production settings are unchanged from preflight.

Record a deterministic cleanup assertion, for example:

`DR_CLEANUP=PASS target_deleted=true production_unchanged=true`

Never clean up shared or production resources merely because they were observed during the drill.

## 6. Evidence package

Each drill must preserve a machine-readable evidence bundle containing, at minimum:

- source preflight snapshot;
- source post-drill snapshot;
- recovery material/window;
- target identity;
- timing data;
- measured RPO/RTO;
- validation result;
- temporal-boundary proof for PITR;
- cleanup result;
- production-unchanged assertion.

Compute and record SHA-256 for the final bundle.

Do not place credentials, database passwords, access tokens, private keys, connection strings containing secrets, or raw sensitive production records in repository evidence.

If a CI artifact has retention/expiry, preserve the immutable evidence summary and digest in the repository before expiry. Sensitive/raw evidence should instead be retained in an approved protected storage location.

## 7. Current validated baseline

The V1 release-cycle evidence dated 2026-08-16 established:

- isolated backup restore validated;
- backup restore validated-data RTO: 496s (8m16s), PASS against <=60m;
- isolated PITR restore validated;
- PITR provider latest-recovery lag: 128s (2m08s), PASS against <=15m;
- PITR RPO: 514s (8m34s), PASS against <=15m;
- PITR restore-to-RUNNABLE: 549s (9m09s);
- PITR validated-data RTO: 584s (9m44s), PASS against <=60m;
- 16 migrations and 22 critical tables validated on the PITR target;
- PITR temporal boundary proved with one pre-boundary record present and one post-boundary record absent;
- temporary targets/jobs removed;
- production settings read back unchanged.

Canonical evidence:

- `docs/operations/cloud-sql-pitr-rpo-drill-2026-08-16.md`;
- `docs/operations/cloud-sql-dr-provider-revalidation-2026-08-16.md`.

## 8. Periodic drill cadence

Current reliability policy expects fresh restore evidence no older than 90 days.

Schedule the next provider-backed restore/PITR exercise before the current evidence ages past that limit. A new drill should not be run merely because GitHub Actions is unavailable; it should be run because the evidence window, configuration change, incident, or risk profile requires it.

Run a new drill earlier when any of the following materially changes:

- Cloud SQL major version;
- region or HA topology;
- backup/PITR policy;
- encryption/KMS configuration;
- database networking/access path;
- migration mechanism;
- critical schema/audit controls;
- recovery IAM model.

## 9. Emergency production recovery boundary

This runbook proves recovery capability through isolated targets. It does not grant permission to overwrite or replace production during an incident.

An actual production recovery requires explicit incident command/approval, a selected recovery point, verified blast radius, stakeholder communication, and a separate cutover decision. When possible, recover to an isolated instance first, validate it, then perform a controlled cutover rather than restoring destructively over the original production instance.
