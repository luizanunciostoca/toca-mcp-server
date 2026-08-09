# Architecture contract

## Canonical responsibilities

- **ChatGPT**: agent/orchestrator and primary user interface.
- **TOCA_OS / Google Drive**: business source of truth for brand, products, policies, SOPs, approvals and operational context.
- **GitHub**: source of truth for code, schemas, tests and infrastructure.
- **TOCA MCP Server**: deterministic execution layer. It must not contain a competing AI agent or duplicate TOCA_OS knowledge.
- **Providers**: source of truth for external side effects and provider-native state.

## Phase 0 boundaries

Phase 0 establishes only the execution foundation: MCP runtime, schemas, policy/audit seams, testing, CI and observability seams. No Meta production credential or write capability is introduced in this phase.

## Rules

1. Prefer small, typed MCP tools over generic API/HTTP execution tools.
2. No provider secret may be stored in the repository, TOCA_OS documents or logs.
3. Every future side effect must be auditable and idempotent where technically possible.
4. Provider capabilities must be discovered and validated; documentation alone never implies runtime availability.
5. Existing ChatGPT connectors should not be duplicated without a concrete technical requirement.
