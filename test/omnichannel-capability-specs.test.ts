import { describe, expect, it } from 'vitest';
import { createToolRegistry } from '../src/registry.js';
import { CAPABILITY_CATALOG } from '../src/governance/capability-catalog.js';
import { OMNICHANNEL_CAPABILITY_CONTRACT_OVERRIDES } from '../src/governance/omnichannel-capability-contracts.js';
import {
  OMNICHANNEL_CAPABILITY_IDS,
  OMNICHANNEL_CAPABILITY_SPECS,
  OMNICHANNEL_DEPENDENCY_BLOCKERS,
  validateOmnichannelCapabilitySpecs,
} from '../src/omnichannel/capability-specs.js';

describe('omnichannel dependency-gated capability specifications', () => {
  it('specifies exactly the requested capabilities without mutating the canonical catalog', () => {
    expect(() => validateOmnichannelCapabilitySpecs()).not.toThrow();
    expect(OMNICHANNEL_CAPABILITY_IDS).toHaveLength(18);

    const catalogIds = new Set(CAPABILITY_CATALOG.map((definition) => definition.capability_id));
    for (const capabilityId of OMNICHANNEL_CAPABILITY_IDS) {
      expect(catalogIds.has(capabilityId)).toBe(false);
    }
  });

  it('keeps every capability non-runtime and non-production while Privacy remains absent', () => {
    expect(OMNICHANNEL_DEPENDENCY_BLOCKERS).toEqual([
      'PRIVACY_CONSENT_SUPPRESSION_NOT_CANONICAL_ON_MAIN',
    ]);
    for (const spec of OMNICHANNEL_CAPABILITY_SPECS) {
      expect(spec.lifecycleStatus).toBe('SPECIFIED');
      expect(spec.runtimeExposed).toBe(false);
      expect(spec.productionExecutionAllowed).toBe(false);
      expect(spec.blockedBy).toEqual(OMNICHANNEL_DEPENDENCY_BLOCKERS);
    }
  });

  it('maps channel engagement to R30 and nurture to R10 without creating R33', () => {
    for (const spec of OMNICHANNEL_CAPABILITY_SPECS) {
      expect(spec.primaryRouteId).toBe(spec.capabilityId.startsWith('nurture.') ? 'R10' : 'R30');
      expect(spec.primaryRouteId).not.toBe('R32');
    }
  });

  it('does not expose the blocked specifications through the MCP runtime', () => {
    const runtimeIds = new Set(
      createToolRegistry({
        instagramReadsEnabled: true,
        metaAdsReadsEnabled: true,
        metaAdsWritesEnabled: true,
        tocaManagedInstagramSchedulerEnabled: true,
      })
        .list()
        .map((definition) => definition.name),
    );

    for (const capabilityId of OMNICHANNEL_CAPABILITY_IDS) {
      expect(runtimeIds.has(capabilityId)).toBe(false);
    }
  });

  it('makes external sends explicit, approval-gated and provider-unbound', () => {
    for (const capabilityId of ['whatsapp.message.send', 'email.campaign.send'] as const) {
      expect(OMNICHANNEL_CAPABILITY_CONTRACT_OVERRIDES[capabilityId]).toMatchObject({
        contract_quality: 'EXPLICIT',
        risk_class: 'WRITE_EXTERNAL',
        side_effects: true,
        approval_required: true,
        idempotent: false,
        authentication_mode: 'UNKNOWN',
        required_scopes: [],
        permission_requirements: [],
      });
      expect(OMNICHANNEL_CAPABILITY_CONTRACT_OVERRIDES[capabilityId].provider).toContain('unbound');
    }
  });

  it('binds nurture semantics to the existing durable workflow engine, not a scheduler', () => {
    for (const capabilityId of OMNICHANNEL_CAPABILITY_IDS.filter((id) =>
      id.startsWith('nurture.'),
    )) {
      const contract = OMNICHANNEL_CAPABILITY_CONTRACT_OVERRIDES[capabilityId];
      expect(contract.provider).toBe('TOCA Core workflow engine');
      expect(contract.operation).not.toContain('scheduler');
    }
  });
});
