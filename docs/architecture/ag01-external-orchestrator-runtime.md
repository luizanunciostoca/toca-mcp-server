# AG-01 external orchestrator runtime

Status: **CI_VERIFIED — provider and production promotion remain pending canonical evidence**

## Purpose

The AG-01 runtime is the durable orchestration layer outside the ChatGPT session. It preserves the canonical TOCA OS control flow without turning the TOCA MCP server into a second strategic brain.

Canonical flow:

`USER -> CHATGPT / AG-01 -> TOCA_OS / GOOGLE DRIVE -> ROUTE_ID -> AGENT(S) -> SOP / TEMPLATE -> QUALITY GATE -> APPROVAL / POLICY GATE -> CORE CAPABILITY -> TOCA MCP -> PROVIDER -> READBACK -> AUDIT / OUTBOX / EVENT RECORD -> LEARNING`

The runtime must never require ChatGPT session memory as the only state needed to continue an in-flight workflow.

## Ownership boundaries

The AG-01 runtime owns only orchestration state that did not previously have a durable owner:

- orchestration conversation/session identity and tenant binding;
- an append-only internal turn journal with redacted content and source-content SHA-256;
- correlation and causation linkage;
- canonical route, agent, SOP and template references;
- context summary;
- orchestration checkpoint and resume cursor;
- orchestration budgets;
- circuit-breaker state local to orchestration decisions.

The AG-01 runtime explicitly does **not** own or duplicate:

- MCP transport or capability registry;
- scheduler;
- durable business workflow engine/store;
- Approval Store or Approval Engine;
- Policy Engine;
- transactional outbox;
- audit ledger;
- provider-specific idempotency contract;
- CRM;
- canonical CRM/omnichannel ConversationRecord or MessageRecord;
- EventRecord store.

Those existing components remain authoritative and are reused through their current contracts.

## Canonical MessageRecord integration

`ag01_message_records` is an internal orchestration journal, not a second CRM message ledger.

When an AG-01 request originates from a canonical CRM/omnichannel `MessageRecord`, the caller supplies the existing canonical `messageId` and correlation/causation identifiers. AG-01 reuses those identifiers for lineage and stores only the minimum redacted turn material needed to resume orchestration. It does not create, update or replace `crm_conversations` or `crm_messages`.

For direct ChatGPT/internal orchestration turns that have no CRM or provider message source, AG-01 derives deterministic internal identifiers from tenant plus idempotency key. This lets an internal workflow survive restart without forcing every ChatGPT request to become a CRM contact or lead.

The CRM Sales Engine / Conversation and Message records workstream remains the source of truth for commercial/channel conversations. The two domains are linked by identifiers and correlation, not duplicated tables or competing ownership.

## AG-01 to Core contract

Every external action is represented as an existing Core capability. The orchestrator may inspect, request approval for, and execute that capability, but it never invokes a provider directly.

Execution boundary:

`AG-01 -> ExistingCoreCapabilityGateway -> resolveCoreRuntimeExecution -> executeCoreCapability -> existing TOCA MCP/provider path`

The existing Core remains responsible for:

1. capability resolution;
2. typed payload schema validation;
3. authenticated identity and tenant scope;
4. authorization;
5. policy/risk evaluation;
6. formal approval when required;
7. side-effect idempotency;
8. provider invocation;
9. provider readback;
10. audit evidence.

The AG-01 checkpoint is persisted before Core execution so process loss never requires reconstructing intent from ChatGPT memory.

## Persistence

Migration `026_ag01_orchestrator_runtime.sql` adds three narrowly scoped tables in the existing canonical PostgreSQL database:

- `ag01_conversations` — versioned orchestration state and checkpoint;
- `ag01_message_records` — append-only redacted internal orchestration turn journal;
- `ag01_runtime_circuits` — persistent circuit-breaker state.

No separate database is introduced. Migration 026 is deliberately placed after currently observed Next-Version reservations through 025. Parallel workstreams still have their own unresolved collisions at earlier numbers, so the integration coordinator must globally serialize migrations again immediately before merge; AG-01 must be renumbered again if 026 becomes occupied before integration.

`ag01_message_records` is append-only. The raw source message is not required for restart: the persisted record stores redacted content plus a SHA-256 of the source content for idempotency/conflict detection.

## Restart and uncertainty rules

A checkpoint records the next step, attempt counters, tool-call budget, current ApprovalRecord reference and causal identifiers.

On restart:

- a completed/dead-lettered run is returned without re-execution;
- `HUMAN_REQUIRED` remains a terminal no-op until a separate governed recovery decision exists;
- pre-checkpoint HUMAN_REQUIRED reason persisted across restart;
- a read-only step that was in `RUNNING` may be recovered and retried within budget;
- a side-effect step found in `RUNNING` is treated as provider-outcome uncertainty and escalated to `HUMAN_REQUIRED` rather than blindly retried.

After a live provider-side-effect call throws or times out, the runtime also escalates to `HUMAN_REQUIRED`. It does not assume the provider did nothing.

## Approval behavior

When the existing Core reports that a capability requires formal approval, the orchestrator requests a canonical `ApprovalRecord` through the existing Approval Store and checkpoints the returned `approvalId`.

The run remains `WAITING_APPROVAL` until the existing approval record is usable. Revoked, expired or review-required approvals escalate to `HUMAN_REQUIRED`.

No second approval store or approval state machine is introduced.

## Budgets and failure controls

The runtime enforces independent bounded limits for:

- plan tool calls;
- tool calls per resume;
- total attempts;
- summarized context tokens;
- runtime duration;
- individual tool timeout;
- circuit-breaker failure threshold/open interval;
- approval TTL.

Read-only failures retry only inside the declared step/runtime budgets. Terminal read-only failures use the existing `DeadLetterSink`. Provider uncertainty and open circuits use a safe no-op plus human escalation.

## Prompt-injection and redaction boundary

Incoming text is redacted before durable storage and before context summarization. High-confidence instructions attempting to bypass policy/approval/governance, exfiltrate secrets/system prompts, or force direct-provider bypass are treated as untrusted control input.

A blocked injection produces a safe `HUMAN_REQUIRED` no-op before route resolution or Core execution.

This defense is additive. It never replaces existing identity, policy, authorization, approval or provider controls.

## Dependency boundary

The central Next-Version registry declares AG-01 external runtime (`NEXT-004`) dependent on Security and Supply-chain Hardening (`NEXT-020`). The runtime can be implemented and CI-verified independently, but governed merge/release ordering must preserve that dependency and re-run exact-head gates after integration.

The active R31 Marketing Autopilot / Learning workstream is also an integration predecessor for the final `... -> LEARNING` feedback loop. AG-01 does not copy or own the learning engine; it only preserves the causal/evidence boundary needed to hand outcomes into that canonical subsystem once merged.

## Evidence and promotion

Required scenarios are covered by unit/integration tests for:

- resume;
- process restart;
- duplicate request/idempotency;
- approval pending;
- provider uncertainty;
- tool timeout;
- dead-letter;
- human escalation;
- PostgreSQL checkpoint/internal-turn/circuit persistence across restart.

The exact tested head and Quality/PostgreSQL E2E run IDs are recorded in PR #21. `CI_VERIFIED` requires both permanent exact-head workflows to remain green and must be re-established after any code or migration change. Provider evidence is not manufactured by executing a real side effect solely for this runtime. `PROVIDER_VERIFIED` and `PRODUCTION_VERIFIED` require their own canonical evidence and are not implied by CI success.
