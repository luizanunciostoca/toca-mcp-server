import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertCanonicalSchedulingSources,
  compileEffectiveAutonomyPolicy,
  loadEffectiveAutonomyPolicy,
} from '../src/governance/autonomy-policy.js';

const rawPolicy = (): Record<string, unknown> =>
  JSON.parse(readFileSync('control/effective-autonomy-policy.v1.json', 'utf8')) as Record<
    string,
    unknown
  >;

describe('effective autonomy policy', () => {
  it('loads the canonical managed-scheduling policy with supervised autonomy by default', () => {
    const compiled = loadEffectiveAutonomyPolicy();
    expect(compiled.policy.scheduling.canonicalPolicy).toBe('TOCA_MANAGED_SCHEDULING');
    expect(compiled.policy.modes.default).toBe('SUPERVISED_AUTO');
    expect(compiled.policy.preapprovedClasses).toEqual([]);
  });

  it('resolves internal work and external publication to distinct authority levels', () => {
    const compiled = loadEffectiveAutonomyPolicy();
    expect(
      compiled.resolve({
        capabilityId: 'content.plan',
        operation: 'PLAN',
        provider: 'TOCA_OS',
        tenantId: 'toca',
        riskClass: 'READ',
        sideEffect: false,
      })?.authority,
    ).toBe('AUTO_INTERNAL');
    expect(
      compiled.resolve({
        capabilityId: 'instagram.publish.image',
        operation: 'PUBLISH',
        provider: 'Meta/Instagram',
        tenantId: 'toca',
        riskClass: 'WRITE_EXTERNAL',
        sideEffect: true,
      })?.authority,
    ).toBe('EXPLICIT_APPROVAL');
  });

  it('detects scheduling drift instead of choosing the least restrictive source', () => {
    expect(() =>
      assertCanonicalSchedulingSources([
        { source: 'drive', policy: 'TOCA_MANAGED_SCHEDULING' },
        { source: 'runtime', policy: 'NATIVE_PROVIDER_SCHEDULING_ONLY' },
      ]),
    ).toThrow('AUTONOMY_POLICY_SCHEDULING_DRIFT');
  });

  it('rejects overlapping rules that grant different authority', () => {
    const value = rawPolicy();
    const rules = value.rules as Record<string, unknown>[];
    rules.push({
      ...rules[1],
      ruleId: 'CONFLICTING_DIRECT_PUBLICATION',
      authority: 'AUTO_EXTERNAL_PREAPPROVED',
      allowedModes: ['PREAPPROVED_AUTO'],
    });
    expect(() => compileEffectiveAutonomyPolicy(value)).toThrow(
      'AUTONOMY_POLICY_DECISION_CONFLICT',
    );
  });

  it('rejects preapproved authority without a formally approved class', () => {
    const value = rawPolicy();
    const rules = value.rules as Record<string, unknown>[];
    rules[1] = {
      ...rules[1],
      authority: 'AUTO_EXTERNAL_PREAPPROVED',
      allowedModes: ['PREAPPROVED_AUTO'],
    };
    expect(() => compileEffectiveAutonomyPolicy(value)).toThrow(
      'AUTONOMY_POLICY_PREAPPROVED_AUTHORITY_WITHOUT_CLASS',
    );
  });
});
