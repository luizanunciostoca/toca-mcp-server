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
  codePresence: check('PASS'),
  runtimePresence: check('PASS'),
  featureFlag: check('PASS'),
  credentials: check('PASS'),
  permissions: check('PASS'),
  providerSupport: check('PASS'),
  smokeTest: check('PASS'),
  readback: check('PASS'),
});

describe('R22 capability lifecycle validation', () => {
  it('requires sequential evidence-backed promotion', () => {
    const implemented = validateCapabilityLifecycle('example.resource.read', 'PLANNED', allPass());
    expect(implemented.recommendedStatus).toBe('IMPLEMENTED');
    expect(promoteCapability('PLANNED', implemented)).toBe('IMPLEMENTED');

    const connected = validateCapabilityLifecycle(
      'example.resource.read',
      'IMPLEMENTED',
      allPass(),
    );
    expect(connected.recommendedStatus).toBe('CONNECTED');

    const validated = validateCapabilityLifecycle(
      'example.resource.read',
      'CONNECTED',
      allPass(),
    );
    expect(validated.recommendedStatus).toBe('PRODUCTION_VALIDATED');
    expect(validated.lastValidatedAt).toBe('2026-08-14T20:00:00Z');
  });

  it('suspends a production capability when provider permission changes', () => {
    const evidence = { ...allPass(), permissions: check('FAIL') };
    const report = validateCapabilityLifecycle(
      'example.resource.write',
      'PRODUCTION_VALIDATED',
      evidence,
    );
    expect(report).toMatchObject({ recommendedStatus: 'SUSPENDED', event: 'SUSPEND' });
    expect(report.failedChecks).toContain('permissions');
  });
});
