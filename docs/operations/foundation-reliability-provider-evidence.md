# Foundation v1 Reliability — Provider Evidence

Status: **FOUNDATION — PRODUCTION_VERIFIED**

Current assessed `main`: `666b55c29413ba4e866e0ca4563ef4690ccb9d46`.

Deployed production runtime source: `3977d2f20ec0fb55c2f3b6b99f9ab006b7c10732`.

The delta from the deployed runtime source to the assessed `main` is documentation-only and was explicitly verified before final promotion.

Current release snapshot: `docs/operations/controlled-test-readiness-2026-08-16.md`.

PITR evidence: `docs/operations/cloud-sql-pitr-rpo-drill-2026-08-16.md`.

Final Foundation/SLO/Daily Operations evidence: `docs/operations/foundation-slo-production-verification-2026-08-16.md`.

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

## Cloud SQL recovery — PASS for backup and PITR paths

Production `toca-mcp-db` remains:

- `RUNNABLE`;
- PostgreSQL 18;
- deletion protection enabled;
- automated backups enabled;
- PITR enabled.

### Backup restore evidence

Real isolated backup restore:

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

### PITR restore evidence

Real isolated timestamp PITR run `31936171307`, attempt 2:

- temporary target `toca-mcp-pitr-31936171307`;
- provider latest-recovery lag **128s (2m08s)**;
- selected recovery timestamp `2026-08-16T08:26:12.648Z`;
- measured PITR RPO **514s (8m34s)**;
- restore-to-`RUNNABLE` **549s (9m09s)**;
- restore-start-to-validated-data RTO **584s (9m44s)**;
- migration count 16;
- 22 critical tables readable;
- critical foreign keys and required append-only triggers validated;
- before-marker present and after-marker absent at the intended PITR boundary;
- production remained unchanged.

Temporal boundary:

- before: `operational_signals/c24795ae-14f1-4952-80af-314187c1ff78` at `2026-08-16T08:26:10.648Z` — present;
- after: `audit_ledger_events/49fff740-196b-4a0b-a5f1-d68a14e02ad3` at `2026-08-16T08:29:42.328Z` — absent.

PITR cleanup proved:

- probe job deleted;
- validation job deleted;
- temporary target deletion protection disabled only on that target;
- target deleted and absence read back;
- production remained `RUNNABLE`, deletion-protected, backed up and PITR-enabled;
- source settings before/after matched.

PITR artifact:

- ID `9261022842`;
- SHA-256 `6524043e56f2eacef34b129fa7eb2c7130711ce43e3071f67476573527dd5140`.

Final assertion:

`CLOUD_SQL_PITR_RPO_DRILL=PASS rpo_seconds=514 rto_seconds=584 provider_latest_lag_seconds=128`

No temporary DR instance remains.

## RPO/RTO objectives — PASS

RTO <=60m is measured and validated for both tested recovery paths.

The <=15m PITR RPO objective is now directly demonstrated: measured PITR RPO **514s (8m34s)** against an objective of 900s.

The former PITR-specific RPO evidence gap is closed.

## Final production verification — PASS

Final assessment run `31937998177` independently measured the live production state after the R29 drain fix and canonical production verification:

- Core availability 1.000 against target 0.999;
- scheduler success 1.000 against target 0.995;
- 15/15 successful external writes verified;
- Outbox pending/claimed/retryable = 0;
- oldest pending Outbox age = 0s;
- Audit Ledger integrity valid;
- Daily Control durable completion healthy;
- SLO alerts = none;
- SLO assessment `healthy=true`.

Evidence artifact:

- ID `9261216989`;
- SHA-256 `a938c71e7630acdcca220a10c333d768438b15d30167a970600a3638b4a50c8d`.

The original 14 stalled Outbox rows were verified as R29 test/verifier residue rather than business events. They were drained through controlled delivery-state transitions; no legitimate business event was deleted. Fresh R29 verifier-owned events were subsequently created and drained to `pending=0` under the canonical runtime verification.

## Current closeout

No known current-scope blocker remains in:

- application/runtime;
- telemetry/SLO source plane;
- Foundation daily operations;
- Transactional Outbox delivery health;
- Monitoring/Logging IAM;
- managed alert policies;
- managed operations channels;
- Cloud SQL backup restore/data validation;
- Cloud SQL PITR restore/data validation;
- RTO <=60m evidence;
- PITR RPO <=15m evidence;
- DR cleanup.

Foundation is **PRODUCTION_VERIFIED** for the current release.

WhatsApp, Email sending/provider integration and Google Ads remain intentionally deferred in #153.
