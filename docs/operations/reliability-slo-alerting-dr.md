# Foundation v1 — Telemetry, Alerting, SLO and Disaster Recovery

Status: **SLO — PRODUCTION_VERIFIED**

Final deployed runtime source: `ac0ba469a57f12c801148b5821e14e34fd86d281`.

Repository `main` at post-R29 ratification: `90d23d83ed53b1c9e8f73c14409d1329b1826f14`.

The repository delta after the deployed runtime was rechecked before and after the final assessment as documentation-only. No runtime, Outbox, scheduler, persistence or provider execution path changed.

Current provider evidence: `docs/operations/controlled-test-readiness-2026-08-16.md`, `docs/operations/foundation-reliability-provider-evidence.md`, `docs/operations/cloud-sql-pitr-rpo-drill-2026-08-16.md` and `docs/operations/foundation-slo-production-verification-2026-08-16.md`.

## Telemetry and SLO source plane

Foundation v1 includes:

- structured JSON logging;
- RuntimeTelemetry/Prometheus;
- immutable Audit Ledger verification;
- append-only `operational_signals`;
- durable Workflow, Approval, Transactional Outbox and EventRecord persistence;
- Foundation daily control;
- deterministic SLO/error-budget evaluation;
- canonical P0/P1/P2 severity classification.

## Foundation objectives

Operational objectives:

- Core governed request availability >=99.9%;
- managed scheduler tick success >=99.5%;
- verified terminal external writes = 100% invariant;
- oldest pending Outbox age <=300s;
- Audit Ledger integrity = 100% valid invariant;
- latest successful Cloud SQL backup <=36h old;
- Cloud SQL PITR enabled;
- restore-drill evidence <=90d old;
- PostgreSQL recovery RTO <=60m;
- PostgreSQL PITR RPO <=15m.

No ambiguous provider write may be converted into an unverified success.

## Managed alerting — PASS

Operational channels:

- primary `adm@tocadomorcego.com`;
- secondary `luizidebook@gmail.com`.

Permanent enabled/valid policies:

- P0 Audit Ledger integrity failure;
- P1 Foundation daily-control failure;
- P1 stale scheduler jobs;
- P1 stalled Outbox.

All four policies have both operations channels attached.

Controlled provider-path proof run `31934254574` produced:

- `DELIVERY_PROOF_LOG=PASS`;
- `DELIVERY_PROOF_PROVIDER_PATH=PASS`;
- artifact `9260213391`;
- SHA-256 `af9803d8c9bbb43a8338bbd47ba64a6f61eedbe03922db2bb0479e388ee50575`.

Independent mailbox-level receipt was not visible during the immediate observation window, so mailbox receipt is not claimed. The managed provider configuration and firing path are proven.

## Disaster recovery — PASS

### Isolated backup restore

The real isolated backup-restore path proved current schema/data integrity without restoring over production:

- migration count 16;
- 21 critical tables readable;
- critical foreign keys valid;
- append-only triggers enabled;
- Audit Ledger verification valid;
- measured RTO `496s`;
- production unchanged;
- deterministic cleanup PASS.

### Isolated PITR restore

Run `31936171307`, attempt 2, exercised a separate timestamp-based PostgreSQL PITR target and proved:

- provider latest-recovery lag `128s`;
- measured PITR RPO `514s` against objective `<=900s` — **PASS**;
- measured restore-to-validated-data RTO `584s` against objective `<=3600s` — **PASS**;
- migration count 16;
- 22 critical tables readable;
- critical foreign keys and required append-only triggers valid;
- intended before/after temporal boundary reproduced;
- temporary target/jobs removed;
- production unchanged after drill.

PITR artifact:

- ID `9261022842`;
- SHA-256 `6524043e56f2eacef34b129fa7eb2c7130711ce43e3071f67476573527dd5140`.

No temporary DR instance remains.

## Outbox stalled closure — PASS

The original `OUTBOX_DELIVERY_STALLED` condition came from 14 R29 verifier-created rows. Direct readback proved all 14 were verifier residue and not business events.

PR #157 added the verifier-owned drain path and was merged only after exact-head full Quality passed, including the formerly failing Format check.

Historical cleanup run `31935924301` touched only the 14 pre-classified verifier IDs and transitioned them through durable delivery-state changes rather than deletion:

- matched `14`;
- drained `14`;
- delivered `14`;
- pending `0`;
- external publication `false`.

No business event was deleted.

## Final canonical R29 production proof — PASS

Final push-provenance deployment run `31938116522` deployed runtime source `ac0ba469a57f12c801148b5821e14e34fd86d281` after exact-head full Quality and passed migrations, scheduler provisioning, daemon/MCP rollout and authenticated smoke.

Canonical final R29 run `31938375409` executed on that same SHA and proved fresh verifier-event behavior:

- matched `3`;
- drained `3`;
- delivered `3`;
- pending `0`;
- provider/durable/Audit readback valid;
- fail-closed behavior valid;
- migrations 020/021 valid;
- temporary verifier jobs removed;
- external publication `false`;
- full Quality after cleanup PASS.

## Final post-R29 SLO Production Assessment — PASS

PR #170 wrote the initial promotion while the final `ac0ba469...` R29 workflow was still executing. Its earlier assessment is superseded for certification purposes by this post-R29 ratification.

Authoritative assessment run `31938670357` measured the live production state after final R29 completion.

Measured at `2026-08-16T09:19:18.020Z`:

- Core governed requests: `18`;
- Core failures: `0`;
- Core availability: **`1.000`**, target `0.999`, `met=true`;
- scheduler ticks: `879`;
- scheduler failures: `0`;
- scheduler success: **`1.000`**, target `0.995`, `met=true`;
- successful external writes: `18`;
- verified external writes: `18`;
- Outbox pending/claimed/retryable: **`0`**;
- oldest pending Outbox age: **`0s`**;
- pending Outbox rows: none;
- Audit Ledger integrity: valid;
- audit executions checked: `21`;
- Daily Control durable value: `1`;
- PITR: enabled;
- alerts: **`[]`**;
- overall canonical assessment: **`healthy=true`**.

Final post-R29 evidence artifact:

- ID `9261408650`;
- SHA-256 `b1c4ceb6da7bb0eb3a49e260296ff3bc870635ffa357eea0daae3ac43e7da819`.

The assessment also rechecked after execution that repository changes after the deployed runtime were documentation-only.

## Incident mode for ambiguous provider writes

After restart, timeout or partial failure:

- do not blindly retry external mutations;
- use durable idempotency/execution/approval descriptors;
- reconcile provider truth first;
- repair local state only through approved reconciliation paths;
- execute bounded governed retry only when provider truth proves the mutation did not happen and approval/idempotency still permit it;
- otherwise preserve ambiguity and escalate.

## Current exit state

Foundation reliability/SLO is production verified:

- telemetry source plane PASS;
- final post-R29 SLO assessment `healthy=true`;
- Outbox pending `0` and oldest pending age `0s`;
- final fresh-event R29 drain regression proof PASS;
- post-cleanup Quality PASS;
- Foundation Daily Operations durable production evidence PASS;
- Monitoring/Logging IAM PASS;
- managed notification channels PASS;
- four permanent Foundation policies PASS;
- controlled alert provider-path firing proof PASS;
- real isolated backup restore PASS;
- real isolated PITR restore PASS;
- restored-data validation PASS;
- RTO `<=60m` PASS;
- PITR RPO `<=15m` PASS;
- DR cleanup PASS;
- production unchanged readback PASS.

SLO is **PRODUCTION_VERIFIED**, effective after successful post-R29 ratification run `31938670357`.

WhatsApp, Email sending/provider integration and Google Ads remain intentionally deferred in #153. Optional mailbox-level alert receipt recheck remains continuing operational validation and does not alter the SLO/DR production verification.
