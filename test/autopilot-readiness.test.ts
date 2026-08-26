import { describe, expect, it } from 'vitest';
import { AUTOPILOT_READINESS_CHECKS } from '../src/governance/autonomy-policy.js';
import {
  assertExternalAutopilotReady,
  evaluateAutopilotReadiness,
  type AutopilotReadinessCheck,
} from '../src/health/autopilot-readiness.js';

const now = '2026-08-26T22:00:00Z';
const passingChecks = (): readonly AutopilotReadinessCheck[] =>
  AUTOPILOT_READINESS_CHECKS.map((name) => ({
    name,
    status: 'PASS' as const,
    evidence: [`readiness:${name.toLowerCase()}:verified`],
    checkedAt: '2026-08-26T21:59:00Z',
  }));

describe('autopilot readiness gate', () => {
  it('is ready only when every canonical check passes with evidence', () => {
    const result = evaluateAutopilotReadiness(passingChecks(), { now });
    expect(result.ready).toBe(true);
    expect(result.failedChecks).toEqual([]);
    expect(result.unknownChecks).toEqual([]);
    expect(() => assertExternalAutopilotReady(result)).not.toThrow();
  });

  it('fails closed when a required check is missing', () => {
    const result = evaluateAutopilotReadiness(passingChecks().slice(0, -1), { now });
    expect(result.ready).toBe(false);
    expect(result.unknownChecks).toEqual(['EXACT_HEAD_CERTIFIED']);
    expect(() => assertExternalAutopilotReady(result)).toThrow(
      'AUTOPILOT_NOT_READY_UNKNOWN:EXACT_HEAD_CERTIFIED',
    );
  });

  it('fails closed when any check reports failure', () => {
    const checks = passingChecks().map((check) =>
      check.name === 'PROVIDER_HEALTHY'
        ? {
            ...check,
            status: 'FAIL' as const,
            evidence: ['provider:meta:probe:failed'],
            reasonCode: 'PROVIDER_UNAVAILABLE',
          }
        : check,
    );
    const result = evaluateAutopilotReadiness(checks, { now });
    expect(result.ready).toBe(false);
    expect(result.failedChecks).toEqual(['PROVIDER_HEALTHY']);
  });

  it('rejects duplicate checks and PASS without evidence', () => {
    const checks = passingChecks();
    expect(() => evaluateAutopilotReadiness([...checks, checks[0]!], { now })).toThrow(
      'AUTOPILOT_READINESS_CHECK_DUPLICATE:POLICY_CONSISTENT',
    );
    expect(() =>
      evaluateAutopilotReadiness([{ ...checks[0]!, evidence: [] }, ...checks.slice(1)], { now }),
    ).toThrow('AUTOPILOT_READINESS_PASS_EVIDENCE_REQUIRED:POLICY_CONSISTENT');
  });
});
