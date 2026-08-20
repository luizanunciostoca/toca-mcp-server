# TOCA OS Next Version — Roadmap

Status: **ACTIVE COORDINATION**

This roadmap coordinates implementation; it does not authorize side effects and does not replace canonical Google Drive business policy.

## Guardrails

- V1 remains frozen at `abfb09b17e90c83790e803dcda091c8142c7407f` and `PRODUCTION_VERIFIED`.
- Live `main` is the technical baseline for every new/updated branch.
- Reuse existing TOCA Core, MCP, CRM records, scheduler, durable workflows, Policy Engine, Approval Engine, idempotency, outbox, audit and EventRecord.
- No provider write is used merely as a test.
- Exact-head evidence is mandatory for every promotion state.

## Phase 0 — Coordination and convergence

### P0.1 Baseline and registries

- Freeze `V1_BASE_SHA`.
- Maintain `control/next-version-feature-registry.v1.json`.
- Maintain PR/branch/dependency/evidence tracker.
- Maintain release/evidence index continuously.
- Re-read `main` before every merge-order decision.

### P0.2 Current recovery convergence

Parallel first wave:

1. **PR #14 — Creative Truth / Venue Fidelity**
   - update from live `main`;
   - re-run exact-head Quality;
   - preserve Creative Truth / Venue Fidelity fail-closed invariants.
2. **PR #15 — Morro Demand Intelligence**
   - update from live `main` independently of #14;
   - recheck migration numbering;
   - reconcile hotspots deliberately;
   - run exact-head Quality + PostgreSQL E2E;
   - provider READ/durable sample remains a separate promotion gate.
3. **PR #16 — Photo-to-Video**
   - do not update independently first;
   - wait for refreshed #14 head;
   - rebase/update on refreshed #14;
   - run fresh exact-head Quality;
   - provider evidence only when rights/likeness/approval prerequisites are canonical and valid.

Recommended merge order for this wave: **#14 -> #16**, while **#15 may merge before or after that stack** if independent conflict review remains clean. If #15 touches a hotspot changed by #14/#16 during synchronization, re-evaluate order before merge.

## Phase 1 — Business-control foundation for autonomy

These items can begin in parallel as contracts/design work, but implementation commits must avoid shared-hotspot collisions.

- `NEXT-016` Privacy/LGPD policy expansion.
- `NEXT-020` Security and supply-chain hardening.
- `NEXT-023` Capability/data governance.
- `NEXT-008` CRM/Sales expansion using existing Contact/Lead/Opportunity records.
- `NEXT-010` Conversation/Message records using existing Core identity/correlation/audit.

Primary objective: create the durable business-state and policy substrate needed before new outbound providers or autonomous sales actions.

## Phase 2 — External AG-01 and omnichannel

Dependencies: Privacy + core CRM/message identity first.

- `NEXT-004` External AG-01 orchestrator runtime.
- `NEXT-005` TOCA Omnichannel Gateway.
- `NEXT-006` WhatsApp real provider.
- `NEXT-007` Email real provider.

Architecture rule: the orchestrator may be a separate runtime, but **TOCA MCP remains the single deterministic execution layer**. Channels must not call business/provider handlers directly.

Provider promotion sequence for outbound channels must preserve `VERIFY/READ -> PREPARE -> CONTROLLED_SEND -> provider readback -> production promotion` as applicable.

## Phase 3 — Sales automation and attribution

- `NEXT-009` Canonical sales pipeline.
- `NEXT-011` Deterministic, explainable lead scoring.
- `NEXT-012` Durable follow-up/nurture using the existing scheduler/workflow engine.
- `NEXT-013` Attribution and Revenue Intelligence.
- `NEXT-019` Conversion/ticketing/checkout evidence.

Critical invariant: `WON`/revenue must come from reliable external evidence; never infer conversion merely from a message, offer or checkout link.

## Phase 4 — Closed-loop marketing

- `NEXT-014` Marketing Autopilot R19.
- `NEXT-015` Social Engagement R30 -> CRM.
- `NEXT-017` Meta Ads closed-loop optimization.
- `NEXT-018` Google Ads real provider, only after attribution is functional.

Meta budget changes must continue through the existing governed financial path. Demand Intelligence is a planning signal, not physical footfall measurement and not autonomous budget authority.

## Phase 5 — Operability, learning and release hardening

- `NEXT-021` Growth/Sales observability, extending existing Foundation/SLO rather than replacing it.
- `NEXT-022` DR coverage for newly introduced state, queues, messages and attribution.
- `NEXT-024` R31 governed learning loop.

The learning loop may propose or persist approved learnings, but must not silently rewrite canonical policy or bypass evidence/approval gates.

## Shared-hotspot policy

Before modifying any of these files, inspect parallel PRs and isolate integration changes when possible:

- `src/server.ts`
- `src/registry.ts`
- `src/mcp/runtime-capability-resolver.ts`
- `scripts/architecture-check.mjs`
- `package.json`

Migrations are globally serialized. Every PR that introduces persistence must re-read the live migration directory immediately before finalizing its migration number.

## Definition of a merge-ready Next Version PR

A PR is merge-ready only when:

- based on/refreshed from the live intended base;
- 0-behind its intended base;
- mergeable;
- free of temporary/diagnostic workflow residue;
- Quality green on the exact final HEAD;
- PostgreSQL E2E green where persistence/migrations are involved;
- restart/retry/idempotency evidence present when applicable;
- provider READ/readback evidence present when the claimed state requires it;
- evidence state is not overstated;
- dependencies and merge order are documented.

No automatic merge to `main` is authorized by this roadmap.