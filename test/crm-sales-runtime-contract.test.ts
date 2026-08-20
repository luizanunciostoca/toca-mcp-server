import { describe, expect, it } from 'vitest';
import { getCapabilityDefinition } from '../src/governance/capability-catalog.js';
import { createToolRegistry } from '../src/registry.js';

const READ_CAPABILITIES = ['sales.lead.enrich', 'sales.report.generate'] as const;
const WRITE_CAPABILITIES = [
  'sales.lead.create',
  'sales.lead.qualify',
  'sales.pipeline.update',
  'sales.followup.create',
  'sales.followup.schedule',
] as const;

describe('CRM Sales R10 runtime contract', () => {
  it('keeps catalog and registry lifecycle/risk contracts aligned', () => {
    const registry = createToolRegistry({ crmSalesRuntimeEnabled: true });

    for (const capabilityId of READ_CAPABILITIES) {
      expect(registry.get(capabilityId)).toMatchObject({
        capabilityStatus: 'IMPLEMENTED',
        riskClass: 'READ',
        sideEffects: false,
        idempotent: true,
      });
      expect(getCapabilityDefinition(capabilityId)).toMatchObject({
        lifecycle_status: 'IMPLEMENTED',
        risk_class: 'READ',
        side_effects: false,
        idempotent: true,
        execution_surface: 'MCP_TOOL',
      });
    }

    for (const capabilityId of WRITE_CAPABILITIES) {
      expect(registry.get(capabilityId)).toMatchObject({
        capabilityStatus: 'IMPLEMENTED',
        riskClass: 'WRITE_REVERSIBLE',
        sideEffects: true,
        idempotent: true,
      });
      expect(getCapabilityDefinition(capabilityId)).toMatchObject({
        lifecycle_status: 'IMPLEMENTED',
        risk_class: 'WRITE_REVERSIBLE',
        side_effects: true,
        idempotent: true,
        execution_surface: 'MCP_TOOL',
      });
    }
  });
});
