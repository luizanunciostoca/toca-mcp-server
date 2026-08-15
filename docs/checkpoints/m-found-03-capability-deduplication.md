# M-FOUND-03 — Capability Deduplication & Multi-route Consumption

Status: **IMPLEMENTED IN BRANCH — VALIDATION REQUIRED**

Milestone: `TOCA_OS_MARKETING_SALES_FOUNDATION_v1`

Base main SHA: `b05f17cbe0bb4dbdd9bf11e2d3e8947aba3c99e5`

## Objective

Remove semantic duplication from orchestration without deleting compatibility IDs, without changing the 32-route macro architecture, and without conflating provider-level operations with higher-level business lifecycle operations.

## Architectural decision

The raw capability catalog remains a compatibility inventory of **731 IDs**.

M-FOUND-03 adds a separate canonical resolution layer so orchestration reasons over effective semantic capabilities while legacy route IDs continue to resolve safely.

This avoids a destructive renumbering/rewrite and makes later TOCA Core capability discovery able to expose canonical actions instead of duplicate aliases.

## Exact aliases canonicalized

The following R09 capabilities are exact semantic aliases of the R30 engagement lifecycle and now resolve to the R30 canonical identity:

| Compatibility ID (R09) | Canonical ID (R30) |
|---|---|
| `social.intent.classify` | `engagement.classify_intent` |
| `social.sentiment.classify` | `engagement.classify_sentiment` |
| `social.lead.detect` | `engagement.identify_lead` |
| `social.response.draft` | `engagement.response.generate` |
| `social.response.send` | `engagement.reply.send` |
| `social.escalate` | `engagement.escalate` |
| `social.assign` | `engagement.assign_human` |
| `social.close` | `engagement.close` |

All eight mappings are marked `EXACT` and deprecated as compatibility identities since semantic resolution contract `1.2.0`.

## Effective catalog size

- raw compatibility IDs: **731**
- exact compatibility aliases: **8**
- effective semantic capabilities after resolution: **723**

This does **not** mean eight capabilities were removed from source compatibility. It means orchestration no longer treats those eight aliases as independent business actions.

## Multi-route consumption

R30 remains the primary route for the canonical engagement lifecycle capabilities above.

R09 is a consumer route. Calling an R09 compatibility ID resolves to the corresponding R30 capability and records R09 as a consumer route.

This establishes the architectural pattern required by the foundation:

`one canonical capability -> one primary route -> zero or more consumer routes -> compatibility aliases`

## Similar names deliberately NOT collapsed

### Publication lifecycle

The following remain distinct:

- `instagram.publication.publish`
- `content_item.publish`
- `instagram.publish.image` / other provider-format operations

Reason: they operate at different abstraction levels. A content lifecycle transition, an Instagram publication orchestration step, and a provider-format-specific publish operation are dependencies/compositions, not aliases.

### Meta Ads preparation

The following remain distinct:

- `meta_ads.campaign.prepare_paused`
- `meta_ads.campaign.prepare`

Reason: the current runtime `prepare_paused` capability belongs to the constrained create-paused boundary, while the R28 planning capability is broader. The paused-state constraint is material and must not be erased by aliasing until the typed contracts prove equivalence.

### Analytics / performance

R18 social analytics and R31 cross-channel performance remain separate because one is source/domain-specific and the other is the cross-channel measurement/optimization lifecycle.

### Drive / systemic reconciliation

R12 Drive organization and R21/R32 systemic governance/reconciliation remain separate because their authority and truth surfaces differ.

## New governed components

### `src/governance/capability-aliases.ts`

Contains only audited `EXACT` aliases and provides:

- alias lookup;
- cycle-safe canonical ID resolution;
- reverse alias lookup;
- consumer-route derivation;
- structural validation of alias rules.

### `src/governance/capability-resolution.ts`

Provides the orchestration view:

- `resolveCapabilityDefinition`;
- `getCanonicalCapabilityDefinition`;
- `getEffectiveCapabilitiesForRoute`;
- `getEffectiveCapabilityCatalog`;
- `validateCapabilityResolution`.

The resolver verifies that compatibility aliases and canonical targets agree on risk, side effects, approval requirement, idempotency and provider before the mapping is accepted.

## Safety properties

M-FOUND-03 does not:

- delete or rename any of the 731 compatibility IDs;
- create R33;
- expose a new external write;
- promote any capability lifecycle status;
- change provider credentials, budgets or campaigns;
- merge provider-specific and orchestration-level semantics;
- change the existing production MCP registry.

## Acceptance criteria

M-FOUND-03 is complete when:

1. all alias rules validate without cycles or missing targets;
2. all alias pairs have compatible risk/write/approval/idempotency/provider contracts;
3. R09 resolves the eight exact overlaps to R30 canonical identities;
4. the raw catalog remains 731 entries;
5. the effective semantic catalog is 723 entries;
6. known near-overlaps remain intentionally distinct;
7. Quality Gate passes fully;
8. merge uses a fixed head SHA;
9. post-merge `main` Quality Gate passes.

## Exit

After validation, proceed to `M-FOUND-04 — Identity & Authorization`.
