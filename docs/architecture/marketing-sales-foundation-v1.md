# TOCA OS Marketing & Sales Foundation v1

## Architectural objective

`TOCA_OS_MARKETING_SALES_FOUNDATION_v1` converts the existing 32-route / capability-catalog architecture into a durable, governed execution foundation without creating a new macro route and without exposing the complete internal capability catalog as hundreds of independent MCP tools.

The foundation preserves the canonical separation of responsibilities:

- ChatGPT: reasoning, routing and orchestration;
- TOCA_OS / Google Drive: canonical business rules, policies, SOPs and institutional knowledge;
- TOCA Core: governed operational contracts and lifecycle control inside the existing MCP codebase;
- `toca-mcp-server`: deterministic execution boundary;
- external providers: source of truth for external side effects;
- provider read-back + audit: completion evidence.

## Non-goals

This milestone does **not**:

- create `R33`;
- create a second MCP server;
- turn all catalog entries into MCP tools;
- promote catalog-only capabilities without evidence;
- replace working provider adapters solely for architectural uniformity;
- permit writes to bypass policy or approval requirements.

## Execution sequence

1. `M-FOUND-01` — Baseline & Drift Audit
2. `M-FOUND-02` — Capability Contract v1.1
3. `M-FOUND-03` — Capability Deduplication & Multi-route Consumption
4. `M-FOUND-04` — Identity & Authorization
5. `M-FOUND-05` — Approval Engine Atomicity
6. `M-FOUND-06` — Durable Workflow Persistence
7. `M-FOUND-07` — Event Bus / Transactional Outbox
8. `M-FOUND-08` — Audit Ledger / Observability
9. `M-FOUND-09` — EventRecord
10. `M-FOUND-10` — CRM Core Records
11. `M-FOUND-11` — TOCA Core MCP Facade
12. `M-FOUND-12` — End-to-End and Production Validation

## Foundation invariants

### Routes

There are 32 macro routes, `R01` through `R32`. Provider additions and professional functions should normally enter as capabilities/subflows under these routes.

### Capabilities

A catalog entry is not equivalent to an executable automation. Lifecycle status must be evidence-backed.

Target lifecycle:

`PLANNED → SPECIFIED → IMPLEMENTED → CONNECTED → INTEGRATION_VALIDATED → PRODUCTION_VALIDATED`

Operational exception states may include `DEGRADED`, `DISABLED`, `DEPRECATED`, `RETIRED` and `BLOCKED` as the contract evolves.

### Side effects

Any governed external side effect must pass, as applicable:

`schema → identity → authorization → policy → risk → approval → idempotency → execution → provider read-back → audit → reconciliation`

The system fails closed when required evidence is unavailable.

### Durable workflows

A route state machine is not a durable workflow by itself. Business processes become operationally durable only after persisted instances, steps, events, dependencies, timers/human tasks, concurrency control and compensations exist.

### Approval atomicity

The target approval execution sequence is:

`APPROVED → RESERVED → EXECUTING → PROVIDER_READBACK → CONSUMED`

Controlled failure must release or escalate the approval instead of silently reusing it.

### Core MCP surface

The future ChatGPT-facing Core surface should remain intentionally small and governed, centered on discovery, workflow, approval, execution, verification and audit. Internal capability cardinality must not dictate MCP tool cardinality.

## Business expansion after foundation

The architecture is intended to support, without new macro routes:

- Event Master Record and event lineage;
- CRM lead-to-sale lifecycle;
- engagement-to-lead handoff;
- ticketing read-only and event sales pacing;
- GA4, Search Console, Meta measurement and attribution;
- Google Business Profile and reputation lifecycle;
- video/Reels and content repurposing;
- consent-governed WhatsApp/email lifecycle;
- LGPD/privacy controls;
- Google Ads within paid media;
- forecasting, experimentation, retention, reactivation, influencer and partnership lifecycles.

## Definition of foundation completion

The foundation is complete only when a governed workflow can be created and advanced through capability discovery, policy evaluation, approval, atomic execution, provider verification and immutable evidence without relying on undocumented contextual state.

The canonical baseline for this sequence is `docs/checkpoints/m-found-01-baseline-drift-audit.md` and `control/foundation-baseline.json`.
