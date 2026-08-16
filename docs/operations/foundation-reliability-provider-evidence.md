# Foundation v1 Reliability — Provider Evidence

Status: **FOUNDATION — PRODUCTION_VERIFIED**

Final deployed runtime source: `ac0ba469a57f12c801148b5821e14e34fd86d281`.

Repository `main` at post-R29 ratification: `90d23d83ed53b1c9e8f73c14409d1329b1826f14`.

The repository delta after the deployed runtime was verified before and after the final assessment as documentation-only. No runtime, Outbox, scheduler, persistence or provider execution path changed.

Current release snapshot: `docs/operations/controlled-test-readiness-2026-08-16.md`.

PITR evidence: `docs/operations/cloud-sql-pitr-rpo-drill-2026-08-16.md`.

Final Foundation/SLO/Daily Operations ratification: `docs/operations/foundation-slo-production-verification-2026-08-16.md`.

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

The Monitoring/Logging IAM blockers are closed. Provider permission readback proves the infrastructure-admin identity can create/manage Monitoring policies/channels and the Logging notification rules required by log-based alert policies.

Operational notification channels:

- primary `adm@tocadomorcego.com` — `projects/toca-mcp-production/notificationChannels/8031185508488706896`;
- secondary `luizidebook@gmail.com` — `projects/toca-mcp-production/notificationChannels/9216772763667438415`.

Permanent enabled/valid Foundation policies:

- P0 `TOCA P0 Audit Ledger Integrity` — `projects/toca-mcp-production/alertPolicies/1233118609333698263`;
- P1 `TOCA P1 Foundation Daily Control Failed` — `projects/toca-mcp-production/alertPolicies/14464734765997818401`;
- P1 `TOCA P1 Stale Scheduler Jobs` — `projects/toca-mcp-production/alertPolicies/3398047250843043934`;
- P1 `TOCA P1 Outbox Stalled` — `projects/toca-mcp-production/alertPolicies/3398047250843045119`.

All four policies have both operations channels attached and provider `validity=null`.

Controlled delivery-path proof run `31934254574` produced:

- `DELIVERY_PROOF_LOG=PASS`;
- `DELIVERY_PROOF_PROVIDER_PATH=PASS`;
- artifact ID `9260213391`;
- SHA-256 `af9803d8c9bbb43a8338bbd47ba64a6f61eedbe03922db2bb0479e388ee50575`.

Independent mailbox-level receipt was not visible during the immediate observation window, so it is not claimed as evidence. The managed provider configuration and firing path are proven.

## Cloud SQL recovery — PASS

Production `toca-mcp-db` remains `RUNNABLE`, deletion-protected, backed up and PITR-enabled.

### Backup restore path

Real isolated backup restore evidence proved:

- migration count 16;
- 21 critical tables readable;
- critical foreign keys and append-only triggers valid;
- Audit Ledger verifier valid on the recovery point;
- measured RTO `496s`;
- production unchanged;
- deterministic target cleanup.

Backup cleanup artifact:

- ID `9260108983`;
- SHA-256 `e6adf99c54418b2eb19a751963e2ebfc5d94e26e609dfc10ad8ca39f3dd6cc9c`.

### PITR path

Real isolated timestamp PITR run `31936171307`, attempt 2, proved:

- provider latest-recovery lag `128s`;
- measured PITR RPO `514s` against objective `<=900s` — **PASS**;
- restore-start-to-validated-data RTO `584s` against objective `<=3600s` — **PASS**;
- migration count 16;
- 22 critical tables readable;
- foreign keys and required append-only triggers valid;
- intended temporal before/after boundary reproduced;
- production unchanged;
- temporary target/jobs removed.

PITR artifact:

- ID `9261022842`;
- SHA-256 `6524043e56f2eacef34b129fa7eb2c7130711ce43e3071f67476573527dd5140`.

No temporary DR instance remains.

## Outbox stalled closure — PASS

The original 14 stalled Outbox rows were verified as R29 verifier/test residue rather than business events. All were pending with zero attempts, no consumer receipts and R29-scoped identity/evidence.

PR #157 fixed the verifier-owned drain path and was merged only after exact-head full Quality passed.

Historical cleanup run `31935924301` safely transitioned only the 14 pre-classified verifier events through durable delivery states:

- matched `14`;
- drained `14`;
- delivered `14`;
- pending `0`;
- external publication `false`.

No legitimate business event was deleted.

## Final production verification — PASS

Final push-provenance deployment run `31938116522` completed successfully on runtime source `ac0ba469a57f12c801148b5821e14e34fd86d281`, including exact-head Quality, migrations, scheduler provisioning, Cloud Run rollout and authenticated smoke.

Canonical final R29 run `31938375409` then created fresh verifier events and proved:

- matched `3`;
- drained `3`;
- delivered `3`;
- pending `0`;
- provider/durable/Audit readback valid;
- fail-closed behavior valid;
- migrations 020/021 valid;
- temporary jobs removed;
- external publication `false`;
- full Quality after cleanup PASS.

The earlier documentation promotion in PR #170 occurred while this final R29 run was still executing. Its earlier assessment evidence is superseded for certification by the post-R29 ratification below.

Authoritative post-R29 assessment run `31938670357` measured:

- Core availability `1.000` against target `0.999`;
- scheduler success `1.000` against target `0.995`;
- successful/verified external writes `18/18`;
- Outbox pending/claimed/retryable `0`;
- oldest pending Outbox age `0s`;
- Audit Ledger integrity valid;
- Daily Control durable completion healthy;
- PITR enabled;
- SLO alerts none;
- canonical assessment `healthy=true`.

Final post-R29 artifact:

- ID `9261408650`;
- SHA-256 `b1c4ceb6da7bb0eb3a49e260296ff3bc870635ffa357eea0daae3ac43e7da819`.

## Current closeout

No known current-scope blocker remains in:

- application/runtime;
- telemetry/SLO source plane;
- Foundation Daily Operations;
- Transactional Outbox delivery health;
- Monitoring/Logging IAM;
- managed alert policies/channels;
- Cloud SQL backup restore/data validation;
- Cloud SQL PITR restore/data validation;
- RTO `<=60m` evidence;
- PITR RPO `<=15m` evidence;
- DR cleanup.

Foundation is **PRODUCTION_VERIFIED**, effective after successful post-R29 ratification run `31938670357`.

WhatsApp, Email sending/provider integration and Google Ads remain intentionally deferred in #153.
