# TOCA OS routes, capabilities and subflows v1

## Decision

TOCA OS has exactly 32 official routes. A route is a stable macroprocess, a subflow is a
process variation inside a route, and a capability is one deterministic action or query.
New API actions normally become capabilities or subflows; they do not create a route unless
they introduce a genuinely independent business intent.

The machine-readable sources are:

- `src/governance/route-catalog.ts`: R01-R32, owners, priorities, subflows and terminal states;
- `src/governance/capability-ids.ts`: requested capability identifiers by route plus transversal
  and existing technical identifiers;
- `src/governance/capability-catalog.ts`: normalized metadata for all 731 catalog entries;
- `src/registry.ts`: the intentionally smaller set exposed by the running MCP server.

Catalog presence does not imply execution. `execution_surface: CATALOG_ONLY` and
`lifecycle_status: PLANNED` are non-executable declarations. The runtime must never advertise a
provider capability merely because it is present in the catalog.

## Structural routes R21-R32

| Route | Name                                  | Priority | Deterministic outcome                                  |
| ----- | ------------------------------------- | -------- | ------------------------------------------------------ |
| R21   | `GOVERNANCE_DRIFT_RECONCILIATION`     | P0       | `RECONCILED` or `BLOCKED_PENDING_HUMAN_DECISION`       |
| R22   | `CAPABILITY_LIFECYCLE_VALIDATION`     | P0       | evidence-backed promotion, demotion or suspension      |
| R23   | `RELEASE_DEPLOYMENT_ROLLBACK`         | P0       | `COMPLETED`, `ROLLBACK_VERIFIED` or `FAILED`           |
| R24   | `SECURITY_AND_SUPPLY_CHAIN`           | P1       | `SECURITY_POSTURE_VALIDATED` or remediation/block      |
| R25   | `OBSERVABILITY_AND_INCIDENT_RESPONSE` | P1       | `POSTMORTEM_COMPLETE`                                  |
| R26   | `BACKUP_RESTORE_DISASTER_RECOVERY`    | P1       | proven `RECOVERY_VALIDATED` or recorded gaps           |
| R27   | `APPROVAL_GOVERNANCE`                 | P0       | `CONSUMED`, `REVOKED` or `EXPIRED`                     |
| R28   | `META_ADS_CONTROLLED_LIFECYCLE`       | P1       | paused-first lifecycle ending in `REPORT` or `BLOCKED` |
| R29   | `CONTENT_ITEM_LIFECYCLE`              | P2       | content lineage through `PUBLISHED` and `MEASURED`     |
| R30   | `SOCIAL_ENGAGEMENT_LIFECYCLE`         | P2       | provider-confirmed response or human escalation        |
| R31   | `PERFORMANCE_FEEDBACK_OPTIMIZATION`   | P2       | `APPROVED_LEARNING` or `REJECTED`                      |
| R32   | `MASTER_DATA_AND_REGISTRY_GOVERNANCE` | P1       | validated write-back or `BLOCKED`                      |

R21 compares the physical Drive, canonical registry, current master manual, routing registry,
Drive capability registry, GitHub/runtime and real provider. It prepares optimistic reconciliation
commands, but owner, approval, financial ceiling, target-account and uncertain provider-state
conflicts always require a human decision.

R32 complements R21: R21 reconciles truth between systems; R32 validates information quality
inside registries, including unique IDs, ownership, status, paths, existence, freshness and
canonical integrity.

## Capability lifecycle

R22 is the only promotion authority for executable lifecycle state:

`PLANNED -> IMPLEMENTED -> CONNECTED -> PRODUCTION_VALIDATED`

- `IMPLEMENTED` requires code evidence.
- `CONNECTED` requires runtime exposure plus satisfied feature flag, credentials, permissions and
  provider support checks.
- `PRODUCTION_VALIDATED` additionally requires a successful smoke test and provider read-back.
- A failed code, permission, credential, provider, smoke or read-back check suspends a previously
  validated provider capability.

Promotion is sequential. Documentation, a green CI run or a successful build alone cannot skip a
state.

## Approval governance

An `approved: true` boolean never authorizes a side effect. R27 binds authorization to an immutable
descriptor SHA-256, requester, approver, route, capability, target account, scope, optional financial
ceiling, expiry, evidence and correlation ID. The durable schema lives in
`migrations/005_approval_governance.sql` and records every version in an append-only history table.

Core policy requires a valid `ApprovalRecord` for external writes, financially impactful operations
and destructive operations. Execution audit records the consumed approval identifier. Provider and
capability-specific guardrails remain additive.

## Release and structural lifecycles

R23 requires branch, tests, architecture check, Quality Gate, PR review, merge, deploy, smoke,
provider verification and release evidence. A failure after merge or deploy enters
`ROLLBACK_REQUIRED`; release closure requires evidence and a known rollback target.

R24-R26 and R28-R32 use typed state-machine definitions. Security fails closed on mandatory
`FAIL` or `UNKNOWN` evidence. Disaster recovery requires an executed restore, integrity proof and
measured RPO/RTO; the existence of a backup alone is insufficient. Paid media is paused-first and
keeps activation and budget changes behind financial policy. Performance observations become
hypotheses before they can become approved knowledge.

## Namespace and mandatory metadata

The preferred namespace is `<domain>.<resource>.<action>`. Existing canonical two-segment names
remain accepted for compatibility. Every catalog entry carries:

`capability_id`, `route_id`, `version`, `description`, `lifecycle_status`, `risk_class`,
`side_effects`, `approval_required`, `idempotent`, `provider`, `required_scopes`, `required_config`,
`input_schema`, `output_schema`, `timeout_ms`, `retry_policy`, `verification_method`,
`rollback_method`, `owner`, `last_validated_at`, `evidence` and `execution_surface`.

The architecture check makes R01-R32 and these fields mandatory. Tests also enforce that the MCP
runtime remains a strict, lifecycle-consistent subset of the canonical capability catalog.
