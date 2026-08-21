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

function requireOmnichannelContract(capabilityId: string) {
  const contract = OMNICHANNEL_CAPABILITY_CONTRACT_OVERRIDES[capabilityId];
  if (!contract) throw new Error(`OMNICHANNEL_CONTRACT_MISSING:${capabilityId}`);
  return contract;
}

describe('omnichannel capability specifications after canonical Privacy integration', () => {
  it('keeps only the four reconciled channel capabilities in the canonical catalog', () => {
    expect(() => validateOmnichannelCapabilitySpecs()).not.toThrow();
    expect(OMNICHANNEL_CAPABILITY_IDS).toHaveLength(18);

    const catalogIds = new Set(CAPABILITY_CATALOG.map((definition) => definition.capability_id));
    for (const capabilityId of OMNICHANNEL_CAPABILITY_IDS) {
      expect(catalogIds.has(capabilityId)).toBe(
        [
          'email.campaign.send',
          'email.delivery.readback',
          'whatsapp.message.send',
          'whatsapp.message.readback',
        ].includes(capabilityId),
      );
    }
  });

  it('exposes WhatsApp send as IMPLEMENTED while production execution remains disabled', () => {
    expect(OMNICHANNEL_DEPENDENCY_BLOCKERS).toEqual([]);
    for (const spec of OMNICHANNEL_CAPABILITY_SPECS) {
      const readback = spec.capabilityId.endsWith('.readback');
      const whatsappSend = spec.capabilityId === 'whatsapp.message.send';
      const emailSend = spec.capabilityId === 'email.campaign.send';
      expect(spec.lifecycleStatus).toBe(
        readback || whatsappSend ? 'IMPLEMENTED' : emailSend ? 'PLANNED' : 'SPECIFIED',
      );
      expect(spec.runtimeExposed).toBe(readback || whatsappSend);
      expect(spec.productionExecutionAllowed).toBe(readback);
      expect(spec.blockedBy).toEqual([]);
    }
  });

  it('binds outbound wire schemas to canonical Privacy state instead of parallel consent/suppression contracts', () => {
    for (const capabilityId of [
      'whatsapp.opt_in.verify',
      'whatsapp.message.prepare',
      'whatsapp.message.send',
      'email.suppression.verify',
      'email.campaign.prepare',
      'email.campaign.send',
      'nurture.sequence.enroll',
    ] as const) {
      const serialized = JSON.stringify(requireOmnichannelContract(capabilityId));
      expect(serialized).toContain('privacy_');
      expect(serialized).not.toContain('consent_decision_id');
      expect(serialized).not.toContain('consent_status');
      expect(serialized).not.toContain('suppression_decision_id');
    }
  });

  it('maps Email to R07 and WhatsApp/nurture to R10 without creating R33', () => {
    for (const spec of OMNICHANNEL_CAPABILITY_SPECS) {
      expect(spec.primaryRouteId).toBe(spec.capabilityId.startsWith('email.') ? 'R07' : 'R10');
      expect(spec.primaryRouteId).not.toBe('R32');
    }
  });

  it('registers provider readbacks and whatsapp.message.send through the reconciled omnichannel surface', () => {
    const runtimeIds = new Set(
      createToolRegistry({
        instagramReadsEnabled: true,
        metaAdsReadsEnabled: true,
        metaAdsWritesEnabled: true,
        tocaManagedInstagramSchedulerEnabled: true,
        omnichannelReadbacksEnabled: true,
      })
        .list()
        .map((definition) => definition.name),
    );

    for (const capabilityId of OMNICHANNEL_CAPABILITY_IDS) {
      expect(runtimeIds.has(capabilityId)).toBe(
        capabilityId.endsWith('.readback') || capabilityId === 'whatsapp.message.send',
      );
    }
  });

  it('keeps external sends explicit, approval-gated and idempotent without production promotion', () => {
    for (const capabilityId of ['whatsapp.message.send', 'email.campaign.send'] as const) {
      const contract = requireOmnichannelContract(capabilityId);
      expect(contract).toMatchObject({
        contract_quality: 'EXPLICIT',
        risk_class: 'WRITE_EXTERNAL',
        side_effects: true,
        approval_required: true,
        idempotent: true,
        authentication_mode: 'UNKNOWN',
        required_scopes: [],
        permission_requirements: [],
      });
      expect(contract.provider).not.toContain('unbound');
    }
    expect(
      CAPABILITY_CATALOG.find((definition) => definition.capability_id === 'whatsapp.message.send')
        ?.lifecycle_status,
    ).toBe('IMPLEMENTED');
  });

  it('binds nurture semantics to the existing durable workflow engine, not a scheduler', () => {
    for (const capabilityId of OMNICHANNEL_CAPABILITY_IDS.filter((id) =>
      id.startsWith('nurture.'),
    )) {
      const contract = requireOmnichannelContract(capabilityId);
      expect(contract.provider).toBe('TOCA Core workflow engine');
      expect(contract.operation).not.toContain('scheduler');
    }
  });
});
