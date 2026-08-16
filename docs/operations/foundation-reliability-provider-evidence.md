# Foundation v1 Reliability — Provider Evidence

Status: **CURRENT RELEASE RELIABILITY PATH OPERATIONALLY CLOSED**

Production application source: `ce70c66c129b1c629f78e776b023a7fe9cf63569`.

Current release snapshot: `docs/operations/controlled-test-readiness-2026-08-16.md`.

## Runtime and source telemetry — PASS

Verified operational surfaces:

- production deploy/schema/scheduler gates;
- structured JSON logging;
- RuntimeTelemetry/Prometheus;
- Foundation daily control;
- Outbox stalled and stale-scheduler detection;
- Audit Ledger integrity verification;
- deterministic SLO/error-budget evaluation;
- canonical P0/P1/P2 severity classification.

## Managed Cloud Monitoring/Logging — PASS

The previous Monitoring/Logging IAM blockers are closed. Provider permission readback proves the infrastructure-admin identity can create/manage Monitoring policies/channels and create the Logging notification rules required by log-based alert policies.

Operational notification channels:

- primary `adm@tocadomorcego.com` — `projects/toca-mcp-production/notificationChannels/8031185508488706896`;
- secondary `luizidebook@gmail.com` — `projects/toca-mcp-production/notificationChannels/9216772763667438415`.

Permanent enabled/valid Foundation policies:

- P0 `TOCA P0 Audit Ledger Integrity` — `projects/toca-mcp-production/alertPolicies/1233118609333698263`;
- P1 `TOCA P1 Foundation Daily Control Failed` — `projects/toca-mcp-production/alertPolicies/14464734765997818401`;
- P1 `TOCA P1 Stale Scheduler Jobs` — `projects/toca-mcp-production/alertPolicies/3398047250843043934`;
- P1 `TOCA P1 Outbox Stalled` — `projects/toca-mcp-production/alertPolicies/3398047250843045119`.

All four policies have both operations channels attached and provider `validity=null`.

Controlled delivery-path proof run `31934254574`:

- temporary log-based policy created after permanent configuration;
- synthetic Cloud Run structured log emitted and read back;
- `DELIVERY_PROOF_LOG=PASS`;
- notification-processing window allowed;
- temporary synthetic policy deleted;
- permanent policies re-read unchanged/valid with both channels;
- `DELIVERY_PROOF_PROVIDER_PATH=PASS`.

Evidence artifact:

- ID `9260213391`;
- SHA-256 `af9803d8c9bbb43a8338bbd47ba64a6f61eedbe03922db2bb0479e388ee50575`.

The immediate connected-Gmail query did not surface the synthetic notification, so independent mailbox-level receipt is not claimed. This does not alter the provider-backed policy/channel/firing-path evidence.

## Cloud SQL recovery — PASS for tested backup recovery path

Production `toca-mcp-db` remains:

- `RUNNABLE`;
- PostgreSQL 18;
- deletion protection enabled;
- automated backups enabled;
- PITR enabled.

Real isolated restore evidence:

- backup `projects/toca-mcp-production/backups/05416bd5-6ce8-409f-85f8-c53bdcf0b8b9`;
- temporary target `toca-mcp-dr-final-31932660953`;
- restored schema recovered to migration count 16;
- 21 critical tables, critical foreign keys and append-only triggers validated;
- Audit Ledger verifier completed without an integrity failure on the recovery point;
- measured RTO **496s (~8m16s)**;
- backup-based observed RPO **9,024s (~2h30m)**;
- production remained unchanged.

Final cleanup run `31933900598` proved:

- temporary target deletion protection was disabled only on the target;
- target deleted successfully;
- target absence read back;
- production remained deletion-protected, backed up and PITR-enabled.

Cleanup artifact:

- ID `9260108983`;
- SHA-256 `e6adf99c54418b2eb19a751963e2ebfc5d94e26e609dfc10ad8ca39f3dd6cc9c`.

No temporary DR instance remains.

## RPO note

RTO <=60m is measured and validated for the tested backup restore path. The <=15m RPO objective is associated with PITR and was not demonstrated by the backup-age measurement. PITR remains enabled. A future PITR-specific drill is continuing reliability evidence, not a current release blocker.

## Current closeout

No known current-scope blocker remains in:

- application/runtime;
- telemetry/SLO source plane;
- Monitoring/Logging IAM;
- managed alert policies;
- managed operations channels;
- Cloud SQL backup restore/data validation;
- DR cleanup.

WhatsApp, Email sending/provider integration and Google Ads remain intentionally deferred in #153.
