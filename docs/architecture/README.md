# Architecture contract

## Canonical responsibilities

- **ChatGPT**: agent/orchestrator and primary user interface.
- **TOCA_OS / Google Drive**: business source of truth for brand, products, policies, SOPs, approvals and operational context.
- **GitHub**: source of truth for code, schemas, tests and infrastructure.
- **TOCA MCP Server**: deterministic execution layer. It must not contain a competing AI agent or duplicate TOCA_OS knowledge.
- **Providers**: source of truth for external side effects and provider-native state.

## Phase 0 boundaries

Phase 0 establishes only the execution foundation: MCP runtime, typed runtime configuration, tool registry, requester/auth contracts, connected-account model, execution context, policy enforcement, audit, normalized errors, secret references, observability boundaries, testing and CI.

No Meta production credential, provider connection or external write capability is introduced in this phase.

## Execution pipeline

Every future provider mutation must follow the same deterministic path:

1. Resolve requester and execution context.
2. Resolve the registered tool definition.
3. Evaluate policy before invoking a provider.
4. Reject unavailable, unvalidated or unapproved mutations before side effects occur.
5. Record execution audit events with a stable correlation ID.
6. Execute the provider adapter only after authorization succeeds.
7. Normalize provider failures before returning them to ChatGPT.
8. Reconcile provider-native state when required by the operation.

## Capability truth

`system.capabilities` reports only tools registered in the running server. A tool being documented in TOCA_OS or planned in the repository never implies that it is connected or production validated.

The initial runtime intentionally exposes only:

- `system.health`
- `system.capabilities`

Instagram and Meta Ads capabilities must be introduced later with explicit provider adapters, scopes, connectivity and production validation.

## Secret boundary

The repository may contain secret **references**, never secret values. Provider tokens and credentials must be resolved by an external secret manager implementation and must not be returned to ChatGPT, written to TOCA_OS documents or emitted in logs/audit payloads.

## Rules

1. Prefer small, typed MCP tools over generic API/HTTP execution tools.
2. No provider secret may be stored in the repository, TOCA_OS documents or logs.
3. Every future side effect must pass through policy and audit and be idempotent where technically possible.
4. Provider capabilities must be discovered and validated; documentation alone never implies runtime availability.
5. Existing ChatGPT connectors should not be duplicated without a concrete technical requirement.
6. Provider-native state is authoritative for external side effects; local state is derived and must be reconcilable.
7. Phase boundaries must remain explicit: Phase 0 cannot silently introduce production provider writes.
