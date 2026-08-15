import { CAPABILITY_CATALOG, getCapabilityDefinition } from './capability-catalog.js';
import {
  CAPABILITY_ALIAS_RULES,
  getAliasesForCanonical,
  getCapabilityAliasRule,
  getConsumerRoutesForCanonical,
  resolveCanonicalCapabilityId,
  validateCapabilityAliasRules,
  type CapabilityAliasRule,
} from './capability-aliases.js';
import { getRouteDefinition } from './route-catalog.js';
import type { CapabilityDefinition, RouteId } from './types.js';

export const CAPABILITY_RESOLUTION_VERSION = '1.0.0';

export interface ResolvedCapabilityDefinition {
  readonly requested_id: string;
  readonly canonical_id: string;
  readonly is_compatibility_alias: boolean;
  readonly replacement_capability_id: string | null;
  readonly deprecated_since: string | null;
  readonly alias_rule: CapabilityAliasRule | null;
  readonly requested_definition: CapabilityDefinition;
  readonly canonical_definition: CapabilityDefinition;
  readonly primary_route_id: CapabilityDefinition['primary_route_id'];
  readonly consumer_route_ids: readonly RouteId[];
  readonly aliases: readonly string[];
}

export interface EffectiveCapabilityCatalog {
  readonly raw_count: number;
  readonly compatibility_alias_count: number;
  readonly effective_count: number;
  readonly capabilities: readonly CapabilityDefinition[];
}

export function resolveCapabilityDefinition(
  capabilityId: string,
): ResolvedCapabilityDefinition | undefined {
  const requestedDefinition = getCapabilityDefinition(capabilityId);
  if (!requestedDefinition) return undefined;

  const canonicalId = resolveCanonicalCapabilityId(capabilityId);
  const canonicalDefinition = getCapabilityDefinition(canonicalId);
  if (!canonicalDefinition) {
    throw new Error(`CAPABILITY_CANONICAL_TARGET_NOT_FOUND:${capabilityId}->${canonicalId}`);
  }

  const aliasRule = getCapabilityAliasRule(capabilityId) ?? null;
  const consumerRoutes = [
    ...new Set([
      ...canonicalDefinition.consumer_route_ids,
      ...getConsumerRoutesForCanonical(canonicalId),
    ]),
  ].sort();

  return {
    requested_id: capabilityId,
    canonical_id: canonicalId,
    is_compatibility_alias: aliasRule !== null,
    replacement_capability_id: aliasRule?.canonical_id ?? null,
    deprecated_since: aliasRule?.deprecated_since ?? null,
    alias_rule: aliasRule,
    requested_definition: requestedDefinition,
    canonical_definition: canonicalDefinition,
    primary_route_id: canonicalDefinition.primary_route_id,
    consumer_route_ids: consumerRoutes,
    aliases: getAliasesForCanonical(canonicalId),
  };
}

export function getCanonicalCapabilityDefinition(
  capabilityId: string,
): CapabilityDefinition | undefined {
  return resolveCapabilityDefinition(capabilityId)?.canonical_definition;
}

export function getEffectiveCapabilitiesForRoute(
  routeId: RouteId,
): readonly ResolvedCapabilityDefinition[] {
  const byCanonicalId = new Map<string, ResolvedCapabilityDefinition>();

  for (const capabilityId of getRouteDefinition(routeId).capabilityIds) {
    const resolved = resolveCapabilityDefinition(capabilityId);
    if (!resolved) {
      throw new Error(`ROUTE_CAPABILITY_NOT_FOUND:${routeId}:${capabilityId}`);
    }
    byCanonicalId.set(resolved.canonical_id, resolved);
  }

  return [...byCanonicalId.values()].sort((left, right) =>
    left.canonical_id.localeCompare(right.canonical_id),
  );
}

export function getEffectiveCapabilityCatalog(): EffectiveCapabilityCatalog {
  const byCanonicalId = new Map<string, CapabilityDefinition>();

  for (const definition of CAPABILITY_CATALOG) {
    const canonicalId = resolveCanonicalCapabilityId(definition.capability_id);
    const canonicalDefinition = getCapabilityDefinition(canonicalId);
    if (!canonicalDefinition) {
      throw new Error(
        `CAPABILITY_CANONICAL_TARGET_NOT_FOUND:${definition.capability_id}->${canonicalId}`,
      );
    }
    byCanonicalId.set(canonicalId, canonicalDefinition);
  }

  const capabilities = [...byCanonicalId.values()].sort((left, right) =>
    left.capability_id.localeCompare(right.capability_id),
  );

  return {
    raw_count: CAPABILITY_CATALOG.length,
    compatibility_alias_count: CAPABILITY_ALIAS_RULES.length,
    effective_count: capabilities.length,
    capabilities,
  };
}

export function validateCapabilityResolution(): void {
  validateCapabilityAliasRules();

  for (const rule of CAPABILITY_ALIAS_RULES) {
    const aliasDefinition = getCapabilityDefinition(rule.alias_id);
    const canonicalDefinition = getCapabilityDefinition(rule.canonical_id);

    if (!aliasDefinition) {
      throw new Error(`CAPABILITY_ALIAS_SOURCE_NOT_FOUND:${rule.alias_id}`);
    }
    if (!canonicalDefinition) {
      throw new Error(`CAPABILITY_ALIAS_TARGET_NOT_FOUND:${rule.canonical_id}`);
    }
    if (getCapabilityAliasRule(rule.canonical_id)) {
      throw new Error(`CAPABILITY_ALIAS_TARGET_IS_ALIAS:${rule.canonical_id}`);
    }
    if (aliasDefinition.route_id !== rule.legacy_route_id) {
      throw new Error(`CAPABILITY_ALIAS_LEGACY_ROUTE_MISMATCH:${rule.alias_id}`);
    }
    if (canonicalDefinition.route_id !== rule.canonical_route_id) {
      throw new Error(`CAPABILITY_ALIAS_CANONICAL_ROUTE_MISMATCH:${rule.alias_id}`);
    }
    if (aliasDefinition.risk_class !== canonicalDefinition.risk_class) {
      throw new Error(`CAPABILITY_ALIAS_RISK_MISMATCH:${rule.alias_id}`);
    }
    if (aliasDefinition.side_effects !== canonicalDefinition.side_effects) {
      throw new Error(`CAPABILITY_ALIAS_SIDE_EFFECT_MISMATCH:${rule.alias_id}`);
    }
    if (aliasDefinition.approval_required !== canonicalDefinition.approval_required) {
      throw new Error(`CAPABILITY_ALIAS_APPROVAL_MISMATCH:${rule.alias_id}`);
    }
    if (aliasDefinition.idempotent !== canonicalDefinition.idempotent) {
      throw new Error(`CAPABILITY_ALIAS_IDEMPOTENCY_MISMATCH:${rule.alias_id}`);
    }
    if (aliasDefinition.provider !== canonicalDefinition.provider) {
      throw new Error(`CAPABILITY_ALIAS_PROVIDER_MISMATCH:${rule.alias_id}`);
    }

    const resolved = resolveCapabilityDefinition(rule.alias_id);
    if (!resolved || resolved.canonical_id !== rule.canonical_id) {
      throw new Error(`CAPABILITY_ALIAS_RESOLUTION_MISMATCH:${rule.alias_id}`);
    }
    if (!resolved.consumer_route_ids.includes(rule.legacy_route_id)) {
      throw new Error(`CAPABILITY_ALIAS_CONSUMER_ROUTE_MISSING:${rule.alias_id}`);
    }
  }

  const effective = getEffectiveCapabilityCatalog();
  if (effective.effective_count !== effective.raw_count - effective.compatibility_alias_count) {
    throw new Error('CAPABILITY_EFFECTIVE_COUNT_MISMATCH');
  }
}
