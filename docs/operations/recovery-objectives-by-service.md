# TOCA OS — Recovery objectives by critical surface

Status: **ACTIVE OPERATIONAL CONTRACT**  
Owner: `AG-18 SRE_RELIABILITY`  
Route: `R26 BACKUP_RESTORE_DISASTER_RECOVERY`

This document separates recovery **targets** from measured evidence. A target is not proof. Promotion to a verified lifecycle state requires environment-specific evidence.

## Canonical objectives

| Critical surface | Durable source of truth | RPO target | RTO / reconciliation target | Resume gate | Current evidence |
| --- | --- | ---: | ---: | --- | --- |
| PostgreSQL canonical durable state | Cloud SQL + PITR + backups | `<=15m` | `<=60m` | isolated restore, migrations, integrity, readiness | **PROVEN in isolated staging**: measured RPO `46s`, RTO `737s` |
| Workflow, timers, scheduler, Outbox and DLQ | PostgreSQL canonical tables | inherits DB `<=15m` | `<=60m` after DB recovery | no duplicate side effect; due work reconciled before resume | **PROVEN in isolated staging** as part of DR surface |
| Audit Ledger / EventRecord | PostgreSQL canonical tables | inherits DB `<=15m` | `<=60m` | ledger integrity and head consistency | **PROVEN in isolated staging**; head mismatch count `0` |
| Approval, Privacy/LGPD, CRM, Conversation/Message, AG-01 durable state | PostgreSQL canonical tables | inherits DB `<=15m` | `<=60m` | schema/readability + domain integrity | **PROVEN in isolated staging** as part of DR surface |
| Cloud Run MCP/Core and webhook runtime | immutable image digest + deployment configuration | `0` data loss for source/artifact | `<=60m` to reconstruct after durable state is healthy | exact digest/revision, intended identity, authenticated `/readyz` | **STAGING VERIFIED**; 30/30 authenticated readiness samples returned HTTP 200 |
| Secret/config references | Secret Manager references + deployment config; never raw secret backup | `0` repository-side loss of references | `<=60m` to resolve/rebind, subject to provider/admin availability | identity authorized; secret reference resolves; no plaintext export | contract implemented; environment evidence required per recovery |
| Provider external state after an ambiguous write | provider is authoritative for external resource state; local ledger preserves correlation/idempotency | not expressed as backup RPO | provider readback before retry; target `<=60m` for operational reconciliation | `WRITE` remains disabled until authoritative readback | **PROVEN for Instagram image Fast Lane**; other providers remain provider-gated |
| Provider credentials/bindings | provider account + Secret Manager binding | N/A | `<=60m` target after infra recovery, subject to provider availability | safe READ/readback succeeds before provider enablement | pending per provider unless separately evidenced |

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
