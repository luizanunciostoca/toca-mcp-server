# Architecture contract

## Canonical responsibilities

- **ChatGPT**: agent/orchestrator and primary user interface.
- **TOCA_OS / Google Drive**: business source of truth for brand, products, policies, SOPs, approvals and operational context.
- **GitHub**: source of truth for code, schemas, tests and infrastructure.
- **TOCA MCP Server**: deterministic execution layer. It must not contain a competing AI agent or duplicate TOCA_OS knowledge.
- **Providers**: source of truth for external side effects and provider-native state.

## Runtime transports

- `stdio` remains available for local development and process-spawned validation.
- Streamable HTTP at `/mcp` is the remote MCP transport intended for ChatGPT connectivity.
- `/healthz` and `/readyz` expose operational state only and no business payloads.
- Production MCP and daemon surfaces remain private; provider OAuth is not a substitute for client authentication to the MCP endpoint.

## Active production foundation

The production runtime has progressed beyond the original bootstrap phase. Depending on environment flags, it can register:

- `system.health` and `system.capabilities`;
- Instagram media/account insight reads;
- Meta Ads account/campaign/ad-set/ad/insight reads;
- TOCA-managed Instagram schedule prepare/create/reschedule/cancel/status/list operations.

Instagram publication is executed by a controlled internal worker/daemon path rather than exposed as a generic unrestricted MCP write. Direct publication tools that remain `PLANNED` in the registry must not be interpreted as available merely because the internal executor exists.

## Execution pipeline

Every provider mutation and every application mutation with side effects must follow the deterministic path:

1. Resolve requester and execution context.
2. Resolve the registered tool definition.
3. Evaluate generic policy before mutation.
4. Apply capability-specific approval/guardrails.
5. Reject unavailable, unvalidated or unapproved mutations before side effects occur.
6. Record audit events with a stable correlation ID and execution ID.
7. Execute the application/provider adapter only after authorization succeeds.
8. Normalize failures and persist state.
9. Reconcile provider-native state when the operation can diverge from local state.
10. Write back provider evidence before promoting business state.

Application writes such as TOCA-managed scheduling are not exempt from the generic policy/audit pipeline. Capability-specific checks such as immutable descriptor SHA approval are additive controls, not replacements for core policy.

## Active Instagram scheduling topology

Individual publication times are stored in PostgreSQL `scheduled_jobs`. The production temporal executor is the singleton Cloud Run service `toca-managed-instagram-daemon`, which polls at a short fixed cadence and calls `claimDue()`.

The former Cloud Scheduler + one-shot Cloud Run Job heartbeat topology is superseded and must not be recreated by active infrastructure policy. A Git commit or application redeploy is not the normal scheduling API. Protected MCP scheduling tools persist schedules directly in PostgreSQL.

## Capability truth

`system.capabilities` reports tools registered in the running server and their declared lifecycle status. Registration and implementation alone do not prove provider connectivity. Provider-backed capabilities must have explicit production evidence before they are promoted to `PRODUCTION_VALIDATED`.

A documented TOCA_OS capability or an internal implementation never implies that a public MCP tool is available.

## Secret boundary

The repository may contain secret **references**, never secret values. Provider tokens and credentials must be persisted/resolved through approved secret stores and must not be returned to ChatGPT, written to TOCA_OS documents or emitted in logs/audit payloads.

OAuth to Meta authenticates/authorizes TOCA MCP against Meta. Authentication protecting the TOCA MCP remote endpoint from unauthorized clients is a separate concern.

## Rules

1. Prefer small, typed MCP tools over generic API/HTTP execution tools.
2. No provider secret may be stored in the repository, TOCA_OS documents or logs.
3. Every side effect must pass through generic policy/audit plus capability-specific gates and be idempotent where technically possible.
4. Provider capabilities must be discovered and validated; documentation alone never implies runtime availability.
5. Existing ChatGPT connectors should not be duplicated without a concrete technical requirement.
6. Provider-native state is authoritative for external side effects; local state is derived and must be reconcilable.
7. Scheduling is application state persisted in PostgreSQL; deployment pipelines must not be used as the normal scheduling transport.
8. Production services must remain private unless an explicit externally authenticated boundary is reviewed and approved.
9. `PUBLISHING`, uncertain provider results and stale local state must fail closed until provider-backed reconciliation is performed.
