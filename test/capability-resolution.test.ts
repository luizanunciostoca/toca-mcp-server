import { describe, expect, it } from 'vitest';
import { CAPABILITY_ALIAS_RULES } from '../src/governance/capability-aliases.js';
import {
  getEffectiveCapabilitiesForRoute,
  getEffectiveCapabilityCatalog,
  resolveCapabilityDefinition,
  validateCapabilityResolution,
} from '../src/governance/capability-resolution.js';

describe('M-FOUND-03 capability canonicalization', () => {
  it('extends the catalog while preserving exact semantic compatibility aliases', () => {
    expect(() => validateCapabilityResolution()).not.toThrow();

    const effective = getEffectiveCapabilityCatalog();
    expect(CAPABILITY_ALIAS_RULES).toHaveLength(8);
    expect(effective).toMatchObject({
      raw_count: 796,
      compatibility_alias_count: 8,
      effective_count: 788,
    });
  });

  it.each([
    ['social.intent.classify', 'engagement.classify_intent'],
    ['social.sentiment.classify', 'engagement.classify_sentiment'],
    ['social.lead.detect', 'engagement.identify_lead'],
    ['social.response.draft', 'engagement.response.generate'],
    ['social.response.send', 'engagement.reply.send'],
    ['social.escalate', 'engagement.escalate'],
    ['social.assign', 'engagement.assign_human'],
    ['social.close', 'engagement.close'],
  ])('resolves %s to canonical %s without breaking the compatibility ID', (alias, canonical) => {
    const resolved = resolveCapabilityDefinition(alias);
    expect(resolved).toBeDefined();
    expect(resolved).toMatchObject({
      requested_id: alias,
      canonical_id: canonical,
      is_compatibility_alias: true,
      replacement_capability_id: canonical,
      deprecated_since: '1.2.0',
      primary_route_id: 'R30',
    });
    expect(resolved?.consumer_route_ids).toContain('R09');
    expect(resolved?.aliases).toContain(alias);
  });

  it('lets R09 consume the R30 canonical capabilities instead of creating duplicate actions', () => {
    const effectiveR09 = getEffectiveCapabilitiesForRoute('R09');
    const ids = effectiveR09.map((definition) => definition.canonical_id);

    expect(ids).toContain('engagement.classify_intent');
    expect(ids).toContain('engagement.classify_sentiment');
    expect(ids).toContain('engagement.identify_lead');
    expect(ids).toContain('engagement.response.generate');
    expect(ids).toContain('engagement.reply.send');
    expect(ids).toContain('engagement.escalate');
    expect(ids).toContain('engagement.assign_human');
    expect(ids).toContain('engagement.close');

    expect(ids).not.toContain('social.response.draft');
    expect(ids).not.toContain('social.response.send');
    expect(ids).not.toContain('social.escalate');
  });

  it('does not collapse similar names that represent different abstraction levels or material intent', () => {
    expect(resolveCapabilityDefinition('instagram.publication.publish')?.canonical_id).toBe(
      'instagram.publication.publish',
    );
    expect(resolveCapabilityDefinition('content_item.publish')?.canonical_id).toBe(
      'content_item.publish',
    );
    expect(resolveCapabilityDefinition('instagram.publish.image')?.canonical_id).toBe(
      'instagram.publish.image',
    );
    expect(resolveCapabilityDefinition('meta_ads.campaign.prepare_paused')?.canonical_id).toBe(
      'meta_ads.campaign.prepare_paused',
    );
    expect(resolveCapabilityDefinition('meta_ads.campaign.prepare')?.canonical_id).toBe(
      'meta_ads.campaign.prepare',
    );
  });
});
