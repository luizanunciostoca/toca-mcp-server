# M-FOUND-12 — End-to-End and Production Validation — PREPARATION ONLY

Status: **PREPARED / NOT EXECUTED / NOT COMPLETE**

Preparation baseline: `main@b0d067e9cc6b469fdb1421ab7a25a25a3b0f1f47`.

This checkpoint is intentionally preparatory. It MUST NOT be used as evidence that M-FOUND-12 is complete, that M-FOUND-11 is mergeable, or that any provider/capability is `CONNECTED`, `INTEGRATION_VALIDATED`, or `PRODUCTION_VALIDATED`.

## Goal of the future milestone

Prove, with real evidence where external state is involved, the governed path:

`ChatGPT/MCP request -> capability discovery -> identity -> typed schema -> authorization -> policy -> risk -> approval -> idempotency -> workflow -> handler/provider -> provider read-back -> EventRecord/CRM when applicable -> Transactional Outbox -> Audit Ledger -> verify -> final response`

The proof must use the canonical Core MCP facade from M-FOUND-11 after its exact head is reconciled with current `main`, passes the official Quality Gate, and is merged. This preparation does not duplicate that facade or create a second MCP server.

## Test layers

1. **Contract matrix** — executable metadata proving every required risk/failure/recovery dimension has at least one scenario.
2. **Deterministic harness** — fake provider and fault controls only. No network, provider credentials, advertising spend, publication, messaging, or financial mutation.
3. **Foundation integration** — after M-FOUND-11 merge, bind scenarios to the real Core facade, identity, approval, durable workflow, outbox, EventRecord/CRM and Audit Ledger implementations.
4. **PostgreSQL recovery** — run the durable cases against the real migrations/store: restart recovery, stale claims, timers, human tasks, retries, compensations and outbox retry.
5. **Provider integration** — only providers whose credentials/scopes/resource binding are independently proven. READ first; writes remain fail-closed until their capability lifecycle permits them.
6. **Production validation** — controlled exact-account executions with provider read-back and immutable evidence. No lifecycle promotion may be inferred from unit tests or CI.

## Canonical E2E scenario matrix

| ID | Dimension | Risk | Expected proof |
|---|---|---|---|
| E2E-001 | READ | READ | discovery -> identity -> schema -> auth/policy -> handler -> audit -> verify; no approval and no side effect |
| E2E-002 | reversible write | WRITE_REVERSIBLE | deterministic idempotency + durable state + read-back/verification where external state applies |
| E2E-003 | external write | WRITE_EXTERNAL | formal approval, exact descriptor binding, one provider mutation, mandatory read-back |
| E2E-004 | financial impact | FINANCIAL_IMPACT | approval ceiling/currency + financial guardrail + read-back before approval consumption |
| E2E-005 | destructive | DESTRUCTIVE | strongest authorization/policy/approval path; fail closed without exact evidence |
| E2E-006 | approval required | WRITE_EXTERNAL | missing approval blocks before handler/provider invocation |
| E2E-007 | human task | WRITE_EXTERNAL | durable wait, role/principal-bound claim/completion, resume same logical attempt |
| E2E-008 | timer | WRITE_REVERSIBLE | durable wait survives process restart and resumes without consuming a retry |
| E2E-009 | retry | WRITE_EXTERNAL | bounded explicit retry receives new execution claim and does not duplicate prior side effect |
| E2E-010 | compensation | WRITE_REVERSIBLE | downstream failure activates persisted compensation in deterministic reverse order |
| E2E-011 | stale claim | WRITE_REVERSIBLE | stale worker cannot complete/fail a step after ownership changes |
| E2E-012 | idempotency replay | WRITE_EXTERNAL | same tenant/key/descriptor returns prior logical outcome without another provider write |
| E2E-013 | duplicate request | WRITE_EXTERNAL | concurrent duplicate collapses to one logical execution/provider mutation |
| E2E-014 | payload drift | WRITE_EXTERNAL | approval descriptor hash mismatch blocks before provider invocation |
| E2E-015 | approval replay | WRITE_EXTERNAL | consumed/expired/wrong-target approval cannot authorize a second execution |
| E2E-016 | cross-tenant attempt | DESTRUCTIVE | tenant/workspace/organization mismatch is denied before data/provider mutation |
| E2E-017 | provider timeout | WRITE_EXTERNAL | ambiguous side-effect state does not blindly retry; reconcile/read-back required |
| E2E-018 | ambiguous provider response | WRITE_EXTERNAL | execution enters review/reconciliation path; no success claim |
| E2E-019 | missing read-back | WRITE_EXTERNAL | side effect cannot be verified/consumed as successful |
| E2E-020 | audit failure | WRITE_EXTERNAL | required durable audit failure prevents a successful terminal response and is recoverable/reconcilable |
| E2E-021 | outbox retry | WRITE_EXTERNAL | domain commit is not repeated; pending outbox delivery retries idempotently |
| E2E-022 | recovery after restart | WRITE_EXTERNAL | persisted workflow/outbox/approval state resumes without duplicate mutation |
| E2E-023 | EventRecord linkage | WRITE_EXTERNAL | event-related side effect binds canonical EventRecord/external ref after verified read-back |
| E2E-024 | CRM linkage | WRITE_EXTERNAL | CRM-applicable flow preserves tenant scope and canonical Contact/CRM identity without duplicate record creation |

## Mandatory invariants

- Every side-effect scenario has a deterministic idempotency binding.
- Every external side effect requires provider read-back before terminal success.
- Approval-required scenarios bind the exact parsed payload, target account, idempotency key and financial context when applicable.
- Payload drift, target drift, tenant drift or approval replay must fail before provider invocation.
- Provider timeout/ambiguity never means success and never permits blind write retry.
- EventRecord and CRM are reused only where the capability contract requires them; no parallel record master is created.
- Outbox/audit/workflow persistence is reused; no second queue, scheduler, ledger or workflow engine is introduced.
- Restart/retry tests must distinguish continuation of the same attempt from a genuine new retry.
- Test providers are deterministic fakes and MUST reject any network URL/credential use.

## Prepared harness

`test/fixtures/m-found-12-harness.ts` defines the canonical scenario dimensions, fault model and a network-free fake provider. `test/m-found-12-e2e-matrix.test.ts` makes the preparation executable by asserting coverage and safety invariants.

These tests intentionally do **not** call `toca.execute` yet because M-FOUND-11 is still an unmerged dependency. After M-FOUND-11 merges, the harness should gain a Core facade adapter rather than copying `src/mcp/*` into this branch.

## Future evidence bundle per scenario

Each executed scenario must retain, as applicable:

- main/head SHA and exact Quality Gate run;
- capability ID + lifecycle snapshot;
- requester principal and tenant/workspace/organization scope;
- normalized typed payload hash (redacted where required);
- policy/risk decision;
- approval ID + descriptor hash + target/financial binding;
- idempotency key and execution ID;
- workflow instance/step/claim identifiers;
- provider request correlation without secret values;
- provider response/read-back evidence;
- EventRecord/CRM references when applicable;
- outbox event ID/delivery state;
- audit record/hash-chain evidence;
- verification result and final response classification.

## Production blockers before execution

1. M-FOUND-11 is not merged and its branch must be reconciled with current `main` before the official Quality Gate.
2. GitHub Actions is currently unable to execute the canonical Quality Gate on blocked PR heads.
3. Provider credentials, granted scopes and exact resource/account binding are not uniformly proven across providers.
4. Google Ads remains on open PR #112 and has no real provider-connectivity claim.
5. Google Business, GA4, Search Console and ticketing are not provider-connected by current repository evidence.
6. Meta Ads legacy PR #78 contains unique provider-settling/readiness hardening that must be cleanly reconciled before relying on its smoke semantics.
7. Legacy PR cleanup should occur before reopening CI-heavy work so superseded branches do not waste Actions minutes.

## Future M-FOUND-12 exit gate

M-FOUND-12 may be declared complete only when all required scenarios are executed against the merged foundation, all exact-head Quality Gates are green, provider-backed cases have real provider evidence/read-back, restart/recovery cases use durable persistence, no unresolved P0/P1 blocker remains, and lifecycle promotions (if any) are separately supported by `CapabilityLifecycleEvidence`.
