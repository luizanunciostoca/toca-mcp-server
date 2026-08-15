import { describe, expect, it } from 'vitest';
import {
  promoteCapability,
  validateCapabilityLifecycle,
  type CapabilityCheck,
  type CapabilityLifecycleEvidence,
} from '../src/governance/capability-lifecycle.js';

const check = (result: CapabilityCheck['result']): CapabilityCheck => ({
  result,
  checkedAt: '2026-08-14T20:00:00Z',
  evidence: result === 'PASS' ? [`evidence:${result}`] : [],
});

const allPass = (): CapabilityLifecycleEvidence => ({
  contractDefinition: check('PASS'),
  codePresence: check('PASS'),
  runtimePresence: check('PASS'),
  featureFlag: check('PASS'),
  credentials: check('PASS'),
  permissions: check('PASS'),
  providerSupport: check('PASS'),
  integrationTest: check('PASS'),
  smokeTest: check('PASS'),
  readback: check('PASS'),
});

describe('R22 capability lifecycle validation', () => {
  it('requires sequential evidence-backed promotion through contract v1.1 stages', () => {
    const specified = validateCapabilityLifecycle('example.resource.read', 'PLANNED', allPass());
    expect(specified.recommendedStatus).toBe('SPECIFIED');
    expect(promoteCapability('PLANNED', specified)).toBe('SPECIFIED');

    const implemented = validateCapabilityLifecycle('example.resource.read', 'SPECIFIED', allPass());
    expect(implemented.recommendedStatus).toBe('IMPLEMENTED');

    const connected = validateCapabilityLifecycle('example.resource.read', 'IMPLEMENTED', allPass());
    expect(connected.recommendedStatus).toBe('CONNECTED');

    const integrationValidated = validateCapabilityLifecycle(
      'example.resource.read',
      'CONNECTED',
      allPass(),
    );
    expect(integrationValidated.recommendedStatus).toBe('INTEGRATION_VALIDATED');

    const validated = validateCapabilityLifecycle(
      'example.resource.read',
      'INTEGRATION_VALIDATED',
      allPass(),
    );
    expect(validated.recommendedStatus).toBe('PRODUCTION_VALIDATED');
    expect(validated.lastValidatedAt).toBe('2026-08-14T20:00:00Z');
  });

  it('blocks an operational capability when provider permissions are invalid', () => {
    const evidence = { ...allPass(), permissions: check('FAIL') };
    const report = validateCapabilityLifecycle(
      'example.resource.write',
      'PRODUCTION_VALIDATED',
      evidence,
    );
    expect(report).toMatchObject({ recommendedStatus: 'BLOCKED', event: 'BLOCK' });
    expect(report.failedChecks).toContain('permissions');
  });

  it('degrades production when integration/provider readback evidence regresses', () => {
    const evidence = { ...allPass(), readback: check('FAIL') };
    const report = validateCapabilityLifecycle(
      'example.resource.read',
      'PRODUCTION_VALIDATED',
      evidence,
    );
    expect(report).toMatchObject({ recommendedStatus: 'DEGRADED', event: 'DEGRADE' });
    expect(report.failedChecks).toContain('readback');
  });

  it('blocks promotion when the canonical contract itself fails validation', () => {
    const evidence = { ...allPass(), contractDefinition: check('FAIL') };
    const report = validateCapabilityLifecycle('example.resource.read', 'IMPLEMENTED', evidence);
    expect(report).toMatchObject({ recommendedStatus: 'BLOCKED', event: 'BLOCK' });
  });
});
