# Foundation v1 — Telemetry, Alerting, SLO and Disaster Recovery

Status: **PRODUCTION_VERIFIED**

Production runtime source: `3977d2f20ec0fb55c2f3b6b99f9ab006b7c10732`.

Canonical Foundation/SLO closeout: `docs/operations/foundation-production-verification-2026-08-16.md`.

Current provider evidence: `docs/operations/controlled-test-readiness-2026-08-16.md`, `docs/operations/foundation-reliability-provider-evidence.md` and `docs/operations/cloud-sql-pitr-rpo-drill-2026-08-16.md`.

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

The previous Monitoring/Logging IAM blockers are closed.

Operational channels:

- primary `adm@tocadomorcego.com`;
- secondary `luizidebook@gmail.com`.

Permanent enabled/valid policies:

- P0 Audit Ledger integrity failure;
- P1 Foundation daily-control failure;
- P1 stale scheduler jobs;
- P1 stalled Outbox.

All four policies have both channels attached.

Controlled provider-path proof run `31934254574` created a temporary log-based policy, emitted a matching structured Cloud Run log, read back ingestion, allowed a notification-processing window, deleted the temporary policy and then re-read all permanent policies as enabled/valid with both channels.

Evidence:

- `DELIVERY_PROOF_LOG=PASS`;
- `DELIVERY_PROOF_PROVIDER_PATH=PASS`;
- artifact `9260213391`;
- SHA-256 `af9803d8c9bbb43a8338bbd47ba64a6f61eedbe03922db2bb0479e388ee50575`.

Independent mailbox-level receipt was not visible during the immediate observation window, so mailbox receipt is not claimed. The managed provider configuration and firing path are proven.

## Disaster recovery — PASS

### Isolated backup restore

The backup restore path was exercised without restoring over production.

Evidence includes:

- isolated target `toca-mcp-dr-final-31932660953`;
- migration count 16;
- 21 critical tables readable;
- critical foreign keys validated;
- append-only triggers enabled;
- Audit Ledger verification valid;
- measured RTO **496s (~8m16s)**;
- production unchanged;
- deterministic target cleanup.

### Isolated PITR restore

Run `31936171307`, attempt 2, exercised a separate timestamp-based PostgreSQL PITR target `toca-mcp-pitr-31936171307`.

Provider recovery-window readback showed latest recoverable data lag of **128s (2m08s)**.

Selected recovery timestamp:

`2026-08-16T08:26:12.648Z`

Measured PITR RPO:

**514s (8m34s)** against objective <=900s — **PASS**.

Measured restore-start-to-validated-data RTO:

**584s (9m44s)** against objective <=3600s — **PASS**.

Restored-data validation proved:

- migration count 16;
- 22 critical tables readable;
- critical foreign keys validated;
- required append-only triggers enabled;
- before-marker present;
- after-marker absent;
- production unchanged after drill.

PITR evidence artifact:

- ID `9261022842`;
- SHA-256 `6524043e56f2eacef34b129fa7eb2c7130711ce43e3071f67476573527dd5140`.

No temporary DR instance remains from either drill.

## Outbox stalled closure — PASS

The previous `OUTBOX_DELIVERY_STALLED` condition was caused by 14 R29 verifier-created events. Direct readback proved all 14 were verifier residue and not business events.

PR #157 added the verifier-owned drain path. The historical cleanup run `31935924301` transitioned only those 14 pre-classified events through durable delivery state changes:

- matched `14`;
- drained `14`;
- delivered `14`;
- pending `0`;
- external publication `false`.

No business event was deleted.

The canonical production rollout run `31937475975` then deployed runtime source `3977d2f20ec0fb55c2f3b6b99f9ab006b7c10732` after exact-head full Quality.

Canonical post-deploy R29 run `31937724476` created fresh verifier events and proved:

- matched `3`;
- drained `3`;
- delivered `3`;
- pending `0`;
- provider/durable/Audit readback valid;
- fail-closed behavior valid;
- migrations 020/021 valid;
- temporary verifier jobs removed;
- no external publication;
- full Quality after cleanup PASS.

## Final SLO Production Assessment — PASS

Final assessment run `31937982829` executed against the deployed Cloud Run image and real production PostgreSQL database.

Measured at `2026-08-16T09:03:30.865Z`:

- Core requests `15`;
- Core failures `0`;
- Core availability `1.000` against target `0.999` — **MET**;
- scheduler ticks `880`;
- scheduler failures `0`;
- scheduler success `1.000` against target `0.995` — **MET**;
- successful external writes `15`;
- verified external writes `15`;
- Outbox pending/claimed/retryable **`0`**;
- oldest pending Outbox age **`0s`**;
- pending Outbox rows **none**;
- Audit Ledger integrity **valid**;
- latest successful backup age approximately `4.60h`;
- PITR **enabled**;
- canonical alerts **`[]`**;
- canonical assessment **`healthy=true`**;
- Foundation daily-control durable value `1`.

Final assessment artifact:

- ID `9261211173`;
- SHA-256 `984ee6bf3f6dac4559cbcdb7636695dd285b57fbe00d7d27bfd0a6653fd266e3`.

The assessment verified before and after execution that repository changes after the deployed runtime source were documentation-only, so no unverified runtime drift was accepted.

## Incident mode for ambiguous provider writes

After restart, timeout or partial failure:

- do not blindly retry external mutations;
- use durable idempotency/execution/approval descriptors;
- reconcile provider truth first;
- repair local state only through approved reconciliation paths;
- execute bounded governed retry only when provider truth proves the mutation did not happen and approval/idempotency still permit it;
- otherwise preserve ambiguity and escalate.

## Current exit state

Foundation reliability/SLO is **PRODUCTION_VERIFIED**:

- telemetry source plane PASS;
- final SLO Production Assessment `healthy=true`;
- Outbox pending `0` and oldest age `0s`;
- R29 fresh-event drain regression proof PASS;
- Foundation Daily Operations durable production evidence PASS;
- Monitoring/Logging IAM PASS;
- managed notification channels PASS;
- four permanent Foundation alert policies PASS;
- controlled alert provider-path firing proof PASS;
- real isolated backup restore PASS;
- real isolated PITR restore PASS;
- restored-data validation PASS;
- RTO <=60m PASS;
- PITR RPO <=15m PASS;
- DR cleanup PASS;
- production unchanged readback PASS.

FOUNDATION, SLO and DAILY_OPERATIONS are **PRODUCTION_VERIFIED** for the verified Foundation scope.

WhatsApp, Email sending/provider integration and Google Ads remain intentionally deferred in #153.
