# M-FOUND-01 — Baseline & Drift Audit

Status: **EXECUTED — BASELINE CAPTURED**

Milestone: `TOCA_OS_MARKETING_SALES_FOUNDATION_v1`

Date: 2026-08-14 (America/Bahia)

Repository: `luizidebook/toca-mcp-server`

## 1. Purpose

Freeze the observed starting point for the Marketing & Sales Foundation before capability contracts, workflow persistence, approval atomicity, business records, and TOCA Core MCP are changed.

This checkpoint records observed truth. It does not promote any capability and it does not treat planned architecture as implemented runtime behavior.

## 2. GitHub baseline

- Default branch: `main`
- Baseline commit: `285187cf58933f15bc2319955dd19feeae1d2e2a`
- Baseline tree: `2d1004f59e9c5ae64b04124faf64c6df96f54da8`
- Baseline commit message: `security: add least-privilege Artifact Registry cleanup role (#92)`
- Quality Gate run: `31853270406`
- Quality Gate conclusion: `success`
- `main` branch protection observed through the branch endpoint: **disabled** (`protected=false`)

### Open pull requests observed

- PR #78 — draft — Meta Ads account/pixel readiness and settled-delivery hardening. Preserve; do not merge implicitly into foundation work.
- PR #53 — draft — Instagram native scheduling capability probe. Preserve as independent provider research/evidence.
- PR #47 — draft — Meta Ads read expansion. Reconcile against current `main` before any reuse.
- PR #46 — draft — Marketing Autopilot E2E / Story hardening. Reconcile against current `main` before any reuse.

No foundation milestone may assume code from an open PR is present in `main`.

## 3. Google Drive canonical baseline

The TOCA_OS Google Drive remains the canonical business/operational source of truth, while GitHub/runtime/provider evidence remain the source of truth for executable implementation state.

Canonical resources observed:

- Master manual: `TOCA_OS — MANUAL_TECNICO_MESTRE_DO_SISTEMA_COMPLETO_v1.1`; ID `10IIezg-NTT64k2bSsWfn8grcm6wUri2bGhKa3yM14v8`; status `OFFICIAL`.
- AI guide: `TOCA_OS — 04_GUIA_PARA_IA`; ID `1dtbfsMVfjCqm00ZAAl-6EkYxlgfiy9gL_IfqMsoHliY`.
- Canonical resource registry: `TOCA_OS — REGISTRO_CANONICO_DE_RECURSOS_E_IDS_v1.0`; ID `1Pc1tyx0dd9GvJBM_8mewh21tfXayfaOhajbmX-uACsY`.
- Machine routing registry: `TOCA_OS — REGISTRO_MACHINE_ACTIONABLE_DE_ROTEAMENTO_v1.0`; ID `1vnSliJe2duw278DPPdiTylXUooOdzYtVa0nXD24LEtU`.
- Maturity report: `TOCA_OS — RELATORIO_DE_MATURIDADE_COMPLETUDE_E_RISCOS_v3.0 — 2026-08-14`; ID `169QXKZAL9azyFe5nq8hYVgqhoxmK_-dxM_k0G66_pJQ`.

The v1.0 master manual is explicitly superseded. The v1.1 manual is the canonical manual.

### Document/runtime drift identified

The maturity report v3.0 records GitHub snapshot:

`c97002ae294f2e5604f3802513c814acbf3753ab`

The observed `main` baseline for this checkpoint is:

`285187cf58933f15bc2319955dd19feeae1d2e2a`

Therefore the report remains useful historical evidence, but must not be treated as the current executable snapshot.

## 4. Route baseline

`src/governance/types.ts` declares exactly `R01` through `R32`.

Decision for the foundation:

- keep the 32 macro routes;
- do not create `R33`;
- add new provider/domain actions as reusable capabilities and subflows under the existing route architecture;
- allow a future capability to declare one primary route and multiple consumer routes instead of cloning semantically equivalent actions.

## 5. Capability catalog baseline

Observed file: `src/governance/capability-catalog.ts`.

Observed catalog contract version: `1.0.0`.

The current catalog still infers significant metadata from naming conventions:

- human description;
- provider;
- risk class;
- mutation status;
- required scopes;
- idempotency fallback;
- execution surface;
- generic verification/rollback behavior.

Current generated schemas are generic object schemas with `additionalProperties: true`; generated output schemas universally require `status` and `correlation_id` even though runtime handlers are not derived from this catalog contract.

This is a confirmed foundation gap, not a speculative one.

### Registry baseline

`src/registry.ts` contains the following definition families:

- 2 bootstrap/system definitions;
- 3 Instagram read definitions;
- 5 Meta Ads read definitions;
- 2 Meta Ads controlled-write definitions;
- 6 TOCA-managed Instagram scheduler definitions;
- 9 planned Instagram publication definitions.

Total declarative definitions with every optional family counted: **27**.

The six TOCA-managed Instagram scheduler definitions remain the formal `PRODUCTION_VALIDATED` set in this registry baseline.

`meta_ads.campaign.create_paused` remains `IMPLEMENTED`, `WRITE_EXTERNAL`, and non-idempotent in the tool registry; it is not promoted by this checkpoint.

## 6. Approval/R27 baseline

Observed files:

- `src/governance/approval-governance.ts`
- `src/persistence/postgres-approval-store.ts`
- `migrations/005_approval_governance.sql`
- `src/core/executor.ts`

Current approval states:

`REQUESTED → APPROVED → CONSUMED`

with terminal alternatives `REVOKED` and `EXPIRED`.

Strengths already present:

- descriptor SHA-256 binding;
- target/scope/financial ceiling checks;
- approver authority checks;
- PostgreSQL history;
- `SELECT ... FOR UPDATE` during versioned store updates;
- optimistic version sequence protection.

Confirmed missing atomic execution lifecycle:

- `RESERVED`;
- `EXECUTING`;
- `PROVIDER_READBACK`;
- `RELEASED`;
- `FAILED_REVIEW_REQUIRED`;
- atomic approval-to-execution binding;
- automatic consume only after successful provider read-back.

`executeTool()` currently evaluates policy, writes audit STARTED/SUCCEEDED/FAILED, and calls the action; it does not reserve or consume an ApprovalRecord through the ApprovalStore.

## 7. Workflow persistence baseline

The repository has persistent scheduler/publication and approval storage, but no general durable workflow engine implementing the target entities:

- `workflow_instances`;
- `workflow_steps`;
- `workflow_events`;
- `workflow_dependencies`;
- `workflow_human_tasks`;
- `workflow_timers`;
- `workflow_compensations`;
- generic transactional `event_outbox`.

State machines in governance are therefore not yet equivalent to durable business workflow instances.

## 8. Security and supply-chain baseline

Confirmed:

- `main` is currently unprotected;
- Quality Gate exists and is green at the baseline SHA;
- infrastructure/control-plane policies and least-privilege custom roles exist;
- current tree contains no foundation-level mechanism that makes branch protection itself a required repository invariant.

Previously documented Drive ACL findings and provider/IAM findings must be revalidated through the appropriate provider/admin surfaces before they are treated as closed.

## 9. Active operational hygiene debt

The active repository tree still includes campaign/diagnostic one-shots, including The Party 2026-08-15 workflow and Dockerfile artifacts. These are evidence-bearing artifacts and must not be deleted blindly.

Required treatment in later foundation work:

1. preserve evidence;
2. classify reusable vs one-shot behavior;
3. migrate reusable behavior to parameterized permanent workflows;
4. archive/remove temporary active surfaces only after replacement and proof.

## 10. Drift classes for subsequent reconciliation

M-FOUND-01 recognizes the following drift classes:

- `DOCUMENTATION_DRIFT`
- `REGISTRY_DRIFT`
- `RUNTIME_DRIFT`
- `PROVIDER_DRIFT`
- `CONFIGURATION_DRIFT`
- `SECURITY_CONTROL_DRIFT`
- `EVIDENCE_DRIFT`

Every later reconciliation must identify which truth surface is authoritative for the disputed property instead of applying blind two-way synchronization.

## 11. Foundation execution order frozen by this checkpoint

1. `M-FOUND-01` — Baseline & Drift Audit
2. `M-FOUND-02` — Capability Contract v1.1
3. `M-FOUND-03` — Capability Deduplication & Route Consumption
4. `M-FOUND-04` — Identity & Authorization
5. `M-FOUND-05` — Approval Engine Atomicity
6. `M-FOUND-06` — Workflow Persistence
7. `M-FOUND-07` — Event Bus / Transactional Outbox
8. `M-FOUND-08` — Audit Ledger / Observability
9. `M-FOUND-09` — EventRecord
10. `M-FOUND-10` — CRM Core Records
11. `M-FOUND-11` — TOCA Core MCP facade
12. `M-FOUND-12` — End-to-End / Production Validation

Measurement, ticketing, Google Business, video, omnichannel, LGPD and Google Ads are layered on this foundation without creating a new macro route.

## 12. Acceptance criteria

M-FOUND-01 is complete when:

- the exact `main` SHA and tree are captured;
- latest baseline Quality Gate is captured;
- branch-protection state is captured;
- open competing/legacy PRs are recorded;
- canonical Drive documents and IDs are recorded;
- stale-document snapshot drift is explicit;
- route count is frozen at 32;
- current capability-contract weaknesses are documented from code;
- current R27 execution gap is documented from code;
- missing general workflow persistence is documented;
- a machine-readable sibling baseline exists in `control/foundation-baseline.json`;
- no capability has been promoted based only on documentation.

## 13. Exit decision

**GO to M-FOUND-02.**

There is no architectural blocker to starting Capability Contract v1.1. Branch protection is a real security debt and must be remediated through repository administration, but it does not require corrupting or pausing the contract refactor branch. All future merges remain gated by the repository Quality Gate and explicit review while the administrative protection gap is open.
