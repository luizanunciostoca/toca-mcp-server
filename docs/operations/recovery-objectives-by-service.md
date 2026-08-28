# TOCA OS — Recovery objectives by critical surface

Status: **ACTIVE OPERATIONAL CONTRACT**  
Owner: `AG-18 SRE_RELIABILITY`  
Route: `R26 BACKUP_RESTORE_DISASTER_RECOVERY`

This document separates recovery **targets** from measured evidence. A target is not proof. Promotion to a verified lifecycle state requires environment-specific evidence.

## Canonical objectives

### PostgreSQL canonical durable state

- Source of truth: Cloud SQL + PITR + backups.
- RPO target: `<=15m`.
- RTO target: `<=60m`.
- Resume gate: isolated restore, migrations, integrity and readiness.
- Current evidence: **PROVEN in isolated staging** with measured RPO `46s` and RTO `737s`.

### Workflow, timers, scheduler, Outbox and DLQ

- Source of truth: canonical PostgreSQL tables.
- RPO target: inherits database `<=15m`.
- RTO target: `<=60m` after database recovery.
- Resume gate: no duplicate side effect; due work reconciled before resume.
- Current evidence: **PROVEN in isolated staging** as part of the DR surface.

### Audit Ledger / EventRecord

- Source of truth: canonical PostgreSQL tables.
- RPO target: inherits database `<=15m`.
- RTO target: `<=60m`.
- Resume gate: ledger integrity and head consistency.
- Current evidence: **PROVEN in isolated staging** with head mismatch count `0`.

### Approval, Privacy/LGPD, CRM, Conversation/Message and AG-01 durable state

- Source of truth: canonical PostgreSQL tables.
- RPO target: inherits database `<=15m`.
- RTO target: `<=60m`.
- Resume gate: schema readability and domain integrity.
- Current evidence: **PROVEN in isolated staging** as part of the DR surface.

### Cloud Run MCP/Core and webhook runtime

- Source of truth: immutable image digest + deployment configuration.
- RPO target: `0` data loss for source/artifact.
- RTO target: `<=60m` to reconstruct after durable state is healthy.
- Resume gate: exact digest/revision, intended identity and authenticated `/readyz`.
- Current evidence: **STAGING VERIFIED**; 30/30 authenticated readiness samples returned HTTP 200.

### Secret/config references

- Source of truth: Secret Manager references + deployment configuration; never raw secret backup.
- RPO target: `0` repository-side loss of references.
- RTO target: `<=60m` to resolve/rebind, subject to provider/admin availability.
- Resume gate: intended identity is authorized, secret reference resolves and plaintext is never exported.
- Current evidence: contract implemented; environment evidence is required per recovery.

### Provider external state after an ambiguous write

- Source of truth: the provider is authoritative for external resource state; the local ledger preserves correlation and idempotency identity.
- RPO target: not expressed as backup RPO.
- Reconciliation target: provider readback before retry, operational target `<=60m`.
- Resume gate: `WRITE` remains disabled until authoritative readback.
- Current evidence: **PROVEN for Instagram image Fast Lane**; other providers remain provider-gated.

### Provider credentials/bindings

- Source of truth: provider account + Secret Manager binding.
- RPO target: N/A.
- Recovery target: `<=60m` after infrastructure recovery, subject to provider availability.
- Resume gate: safe READ/readback succeeds before provider enablement.
- Current evidence: pending per provider unless separately evidenced.

## Evidence rules

1. PostgreSQL `RPO <=15m` and `RTO <=60m` are the baseline disaster-recovery objectives.
2. Stateless runtime has no independent business-data RPO; its recovery objective is reconstruction from an immutable artifact after durable state is healthy.
3. Workflow, Outbox, scheduler, Approval, Audit, Privacy, CRM and AG-01 inherit the database RPO because their canonical durable truth is persisted there.
4. Provider state is never reconstructed by blindly replaying a mutation. For unknown or ambiguous outcomes, readback is mandatory before retry.
5. Provider credentials and bindings are revalidated after recovery. Database rows or secret references alone never imply `PROVIDER_VERIFIED`.
6. Production verification is environment-specific. Staging proof must not be relabeled as production proof.

## Current measured baseline

The accepted isolated-staging DR evidence records:

- recovery lag: `16s`;
- measured RPO: `46s` against `<=900s` — PASS;
- restore start to target runnable: `450s`;
- full PostgreSQL recovery/validation RTO: `737s` against `<=3600s` — PASS;
- critical tables validated: `28`;
- Audit Ledger head mismatch count: `0`;
- production mutation: `NO`;
- provider mutation: `NO`;
- traffic mutation: `NO`.

Canonical references:

- `docs/operations/disaster-recovery-next-runbook.md`
- `docs/operations/next-version-evidence-index.md`
- `docs/operations/next-staging-dr-evidence-20260822.md`

## Release rule

A release may claim a recovery target only when the target is declared here or in a superseding approved contract. It may claim `DR_VERIFIED` only when a valid drill proves the target for the relevant candidate/environment. If an application/runtime change affects recovery semantics, exact-release evidence is required again.
