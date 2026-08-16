import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../src/core/tool-registry.js';
import {
  PRIVACY_CAPABILITY_CONTRACTS,
  PRIVACY_CAPABILITY_IDS,
  registerPrivacyAuditCapabilities,
} from '../src/privacy/index.js';

describe('R16 privacy capability registry', () => {
  it('keeps all requested Privacy/LGPD capabilities implemented under R16', () => {
    expect(PRIVACY_CAPABILITY_CONTRACTS.map((item) => item.capabilityId)).toEqual([
      ...PRIVACY_CAPABILITY_IDS,
    ]);
    expect(PRIVACY_CAPABILITY_CONTRACTS).toHaveLength(13);
    expect(PRIVACY_CAPABILITY_CONTRACTS.every((item) => item.routeId === 'R16')).toBe(true);
    expect(
      PRIVACY_CAPABILITY_CONTRACTS.every((item) => item.lifecycleStatus === 'IMPLEMENTED'),
    ).toBe(true);
  });

  it('requires approval for export/delete and classifies deletion as destructive', () => {
    expect(
      PRIVACY_CAPABILITY_CONTRACTS.find(
        (item) => item.capabilityId === 'privacy.data_export.prepare',
      ),
    ).toMatchObject({ riskClass: 'WRITE_REVERSIBLE', approvalRequired: true });
    expect(
      PRIVACY_CAPABILITY_CONTRACTS.find(
        (item) => item.capabilityId === 'privacy.data_delete.execute',
      ),
    ).toMatchObject({ riskClass: 'DESTRUCTIVE', approvalRequired: true });
  });

  it('registers audit metadata without pretending MCP exposure or production validation', () => {
    const registry = new ToolRegistry();
    registerPrivacyAuditCapabilities(registry);
    registerPrivacyAuditCapabilities(registry);

    expect(registry.list()).toHaveLength(13);
    expect(registry.get('privacy.consent.record')).toMatchObject({
      capabilityStatus: 'IMPLEMENTED',
      provider: 'TOCA_OS+toca-mcp',
      riskClass: 'WRITE_REVERSIBLE',
      sideEffects: true,
    });
    expect(registry.get('privacy.suppression.check')).toMatchObject({
      capabilityStatus: 'IMPLEMENTED',
      riskClass: 'READ',
      sideEffects: false,
    });
  });
});
