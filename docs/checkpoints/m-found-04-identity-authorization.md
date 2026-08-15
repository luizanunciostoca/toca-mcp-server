# M-FOUND-04 — Identity & Authorization

Status: **IMPLEMENTED IN BRANCH — VALIDATION REQUIRED**

Milestone: `TOCA_OS_MARKETING_SALES_FOUNDATION_v1`

Base main SHA: `1ef865344943d3f75f2471bd150fcae987879cd5`

## Objective

Replace untrusted requester strings at mutable execution boundaries with an evidence-backed execution identity and explicit authorization decision before any side effect can run.

M-FOUND-04 intentionally precedes approval atomicity. Approval records can only be made safe against replay and concurrent consumption after the execution boundary knows which principal is requesting the action.

## Canonical execution identity

The new `ExecutionIdentity` separates authentication from authorization.

### Principal

Every authenticated principal carries:

- `principalId`;
- `principalType` (`HUMAN`, `SERVICE`, `AGENT`);
- `tenantId`;
- authentication method;
- authentication timestamp;
- optional expiry;
- evidence.

### Authorization grant

Authorization is a separate snapshot bound to the same principal and tenant. It contains:

- roles;
- optional route restrictions;
- optional capability restrictions;
- optional target-account restrictions;
- authorization evidence.

A grant whose principal or tenant differs from the authenticated principal is invalid.

## Roles and risk classes

The authorization model is deny-by-default and maps risk classes to explicit execution roles.

- `READ`: reader/operator-capable roles;
- `WRITE_REVERSIBLE`: operator-capable roles;
- `WRITE_EXTERNAL`: `EXTERNAL_WRITER` or `ADMIN`;
- `FINANCIAL_IMPACT`: `FINANCIAL_OPERATOR` or `ADMIN`;
- `DESTRUCTIVE`: `DESTRUCTIVE_OPERATOR` or `ADMIN`.

`APPROVER` is intentionally not an execution role by itself. Approval authority and execution authority remain separate concerns.

## MCP/OAuth identity path

When the MCP SDK supplies verified `ctx.http.authInfo`, the runtime resolves it into a TOCA execution identity.

Supported TOCA scopes include:

- `toca:read`;
- `toca:write`;
- `toca:write:external`;
- `toca:financial`;
- `toca:destructive`;
- `toca:approve`;
- `toca:admin`;
- `toca:route:<R01-R32>`;
- `toca:capability:<capability_id>`;
- `toca:account:<target_account>`.

Access tokens are not persisted into the identity or audit model.

A presented but expired MCP identity is rejected. It never falls back to a broader service identity.

## Current Cloud Run production compatibility path

The current production MCP deployment already requires authenticated Cloud Run invocation through `--no-allow-unauthenticated`.

Until a dedicated application-level MCP OAuth verifier is configured for caller-specific identities, `createTocaServer()` may construct a bounded infrastructure service identity only when all of the following are true:

1. `NODE_ENV=production`;
2. MCP is enabled;
3. the Cloud Run-provided `K_SERVICE` environment variable exists.

That fallback identity is deliberately restricted to the three already production-validated internal scheduler mutations:

- `instagram.toca_schedule.create`;
- `instagram.toca_schedule.reschedule`;
- `instagram.toca_schedule.cancel`.

It receives `OPERATOR` only and no target-account grant. It cannot authorize Meta Ads external writes, financial actions or destructive actions.

Tests couple this fallback to the deployment workflow's authenticated Cloud Run boundary so removal of `--no-allow-unauthenticated` becomes a Quality Gate failure.

## Policy integration

For side-effecting tools, `evaluatePolicy()` now requires a valid `ExecutionIdentity` and evaluates:

1. lifecycle eligibility;
2. identity validity and expiry;
3. principal/tenant consistency;
4. capability restriction;
5. route restriction when present;
6. target-account restriction when applicable;
7. role required by risk class;
8. formal ApprovalRecord for risk classes that require approval.

Approval verification binds `ApprovalRecord.requester` to `identity.principal.principalId`.

A plain requester string or the deprecated boolean `approved=true` cannot authorize a side effect.

## Audit integration

Audit events now record, when available:

- principal ID through the existing actor/requester column;
- principal type;
- tenant ID;
- authentication method;
- authorization roles;
- approval ID;
- connected account;
- correlation ID and execution ID.

The additional identity metadata is stored inside the existing JSON audit payload, so M-FOUND-04 does not require a destructive audit-table migration.

## Mutable MCP registration changes

The hard-coded `requester: 'mcp-client'` path has been removed from:

- TOCA-managed Instagram scheduler writes;
- Meta Ads controlled writes;
- server registration.

Mutable tool callbacks resolve identity from the MCP request context before calling `executeTool()`.

## Security invariants

M-FOUND-04 establishes the following invariants:

1. a side effect is never authorized by a free-form requester string;
2. authentication and authorization are separate records;
3. an expired presented identity never downgrades into a fallback identity;
4. target-account operations require an account grant when an account is supplied;
5. execution roles are risk-class aware;
6. approval requester identity must equal the authenticated execution principal;
7. audit events preserve principal and authorization metadata;
8. the infrastructure fallback has an exact capability allowlist;
9. Meta Ads external writes are not enabled by the fallback;
10. no capability lifecycle status is promoted by this milestone.

## Deferred to later checkpoints

M-FOUND-04 does not implement approval reservation/consumption atomicity. That is M-FOUND-05.

It also does not claim that caller-specific MCP OAuth is already deployed in production. The SDK-compatible `AuthInfo` resolution path is implemented, while current production compatibility remains bounded to the authenticated Cloud Run service boundary described above.

## Acceptance criteria

M-FOUND-04 is complete when:

1. no mutable MCP registration uses the generic `mcp-client` requester;
2. side effects require a valid execution identity;
3. identity expiry is enforced;
4. capability, route, account and risk-role authorization restrictions are test-covered;
5. approval verification is requester-bound to principal identity;
6. audit records principal metadata;
7. Cloud Run fallback remains exact-capability and authenticated-boundary constrained;
8. existing 32-route and capability-resolution architecture remains unchanged;
9. Quality Gate passes fully;
10. merge uses a fixed head SHA;
11. post-merge `main` Quality Gate passes.

## Exit

After validation, proceed to `M-FOUND-05 — Approval Engine Atomicity`.
