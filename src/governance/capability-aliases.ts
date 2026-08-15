import { assertCapabilityNamespace, type RouteId } from './types.js';

export type CapabilityAliasConfidence = 'EXACT';

export interface CapabilityAliasRule {
  readonly alias_id: string;
  readonly canonical_id: string;
  readonly legacy_route_id: RouteId;
  readonly canonical_route_id: RouteId;
  readonly confidence: CapabilityAliasConfidence;
  readonly deprecated_since: string;
  readonly reason: string;
}

/**
 * Only semantic equivalences that are safe to canonicalize are registered here.
 * Provider-specific operations and orchestration-level operations are deliberately
 * kept distinct even when their names are similar.
 */
export const CAPABILITY_ALIAS_RULES: readonly CapabilityAliasRule[] = [
  {
    alias_id: 'social.intent.classify',
    canonical_id: 'engagement.classify_intent',
    legacy_route_id: 'R09',
    canonical_route_id: 'R30',
    confidence: 'EXACT',
    deprecated_since: '1.2.0',
    reason: 'Both classify the business intent of an ingested social engagement.',
  },
  {
    alias_id: 'social.sentiment.classify',
    canonical_id: 'engagement.classify_sentiment',
    legacy_route_id: 'R09',
    canonical_route_id: 'R30',
    confidence: 'EXACT',
    deprecated_since: '1.2.0',
    reason: 'Both classify sentiment for a social engagement.',
  },
  {
    alias_id: 'social.lead.detect',
    canonical_id: 'engagement.identify_lead',
    legacy_route_id: 'R09',
    canonical_route_id: 'R30',
    confidence: 'EXACT',
    deprecated_since: '1.2.0',
    reason: 'Both identify whether an engagement represents a commercial lead.',
  },
  {
    alias_id: 'social.response.draft',
    canonical_id: 'engagement.response.generate',
    legacy_route_id: 'R09',
    canonical_route_id: 'R30',
    confidence: 'EXACT',
    deprecated_since: '1.2.0',
    reason: 'Both generate a proposed response without sending it to the provider.',
  },
  {
    alias_id: 'social.response.send',
    canonical_id: 'engagement.reply.send',
    legacy_route_id: 'R09',
    canonical_route_id: 'R30',
    confidence: 'EXACT',
    deprecated_since: '1.2.0',
    reason: 'Both represent the governed send step for a prepared social reply.',
  },
  {
    alias_id: 'social.escalate',
    canonical_id: 'engagement.escalate',
    legacy_route_id: 'R09',
    canonical_route_id: 'R30',
    confidence: 'EXACT',
    deprecated_since: '1.2.0',
    reason: 'Both escalate an engagement out of the automated response lifecycle.',
  },
  {
    alias_id: 'social.assign',
    canonical_id: 'engagement.assign_human',
    legacy_route_id: 'R09',
    canonical_route_id: 'R30',
    confidence: 'EXACT',
    deprecated_since: '1.2.0',
    reason: 'Both assign the engagement to a human owner after routing/escalation.',
  },
  {
    alias_id: 'social.close',
    canonical_id: 'engagement.close',
    legacy_route_id: 'R09',
    canonical_route_id: 'R30',
    confidence: 'EXACT',
    deprecated_since: '1.2.0',
    reason: 'Both close the engagement lifecycle after resolution.',
  },
] as const;

const aliasMap = new Map(
  CAPABILITY_ALIAS_RULES.map((rule) => [rule.alias_id, rule] as const),
);

const aliasesByCanonical = new Map<string, readonly CapabilityAliasRule[]>(
  [...new Set(CAPABILITY_ALIAS_RULES.map((rule) => rule.canonical_id))].map((canonicalId) => [
    canonicalId,
    CAPABILITY_ALIAS_RULES.filter((rule) => rule.canonical_id === canonicalId),
  ]),
);

export function getCapabilityAliasRule(capabilityId: string): CapabilityAliasRule | undefined {
  return aliasMap.get(capabilityId);
}

export function resolveCanonicalCapabilityId(capabilityId: string): string {
  const visited = new Set<string>();
  let current = capabilityId;

  while (true) {
    if (visited.has(current)) {
      throw new Error(`CAPABILITY_ALIAS_CYCLE:${[...visited, current].join('->')}`);
    }
    visited.add(current);
    const rule = aliasMap.get(current);
    if (!rule) return current;
    current = rule.canonical_id;
  }
}

export function getAliasesForCanonical(capabilityId: string): readonly string[] {
  const canonicalId = resolveCanonicalCapabilityId(capabilityId);
  return (aliasesByCanonical.get(canonicalId) ?? []).map((rule) => rule.alias_id);
}

export function getConsumerRoutesForCanonical(capabilityId: string): readonly RouteId[] {
  const canonicalId = resolveCanonicalCapabilityId(capabilityId);
  return [
    ...new Set((aliasesByCanonical.get(canonicalId) ?? []).map((rule) => rule.legacy_route_id)),
  ].sort();
}

export function validateCapabilityAliasRules(): void {
  const aliases = new Set<string>();
  for (const rule of CAPABILITY_ALIAS_RULES) {
    assertCapabilityNamespace(rule.alias_id);
    assertCapabilityNamespace(rule.canonical_id);
    if (rule.alias_id === rule.canonical_id) {
      throw new Error(`CAPABILITY_ALIAS_SELF_REFERENCE:${rule.alias_id}`);
    }
    if (aliases.has(rule.alias_id)) {
      throw new Error(`CAPABILITY_ALIAS_DUPLICATE:${rule.alias_id}`);
    }
    aliases.add(rule.alias_id);
    if (rule.legacy_route_id === rule.canonical_route_id) {
      throw new Error(`CAPABILITY_ALIAS_ROUTE_NOT_SHARED:${rule.alias_id}`);
    }
    resolveCanonicalCapabilityId(rule.alias_id);
  }
}
