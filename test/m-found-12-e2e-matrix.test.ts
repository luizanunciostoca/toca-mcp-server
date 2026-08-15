import { describe, expect, it } from 'vitest';
import type { RiskClass } from '../src/core/tool-registry.js';
import {
  M_FOUND_12_DIMENSIONS,
  M_FOUND_12_PIPELINE,
  M_FOUND_12_SCENARIOS,
  MFound12FakeProvider,
} from './fixtures/m-found-12-harness.js';

const requiredRiskClasses: readonly RiskClass[] = [
  'READ',
  'WRITE_REVERSIBLE',
  'WRITE_EXTERNAL',
  'FINANCIAL_IMPACT',
  'DESTRUCTIVE',
];

describe('M-FOUND-12 executable coverage matrix', () => {
  it('keeps the full governed pipeline explicit', () => {
    expect(M_FOUND_12_PIPELINE).toEqual([
      'CAPABILITY_DISCOVERY',
      'IDENTITY',
      'TYPED_SCHEMA',
      'AUTHORIZATION',
      'POLICY',
      'RISK',
      'APPROVAL',
      'IDEMPOTENCY',
      'WORKFLOW',
      'HANDLER_PROVIDER',
      'PROVIDER_READBACK',
      'DOMAIN_LINKAGE',
      'TRANSACTIONAL_OUTBOX',
      'AUDIT_LEDGER',
      'VERIFY',
      'FINAL_RESPONSE',
    ]);
  });

  it('covers every required scenario dimension exactly once', () => {
    const covered = M_FOUND_12_SCENARIOS.map((entry) => entry.dimension).sort();
    expect(covered).toEqual([...M_FOUND_12_DIMENSIONS].sort());
    expect(new Set(M_FOUND_12_SCENARIOS.map((entry) => entry.id)).size).toBe(
      M_FOUND_12_SCENARIOS.length,
    );
  });

  it('covers every canonical risk class', () => {
    const covered = new Set(M_FOUND_12_SCENARIOS.map((entry) => entry.riskClass));
    for (const riskClass of requiredRiskClasses) expect(covered.has(riskClass)).toBe(true);
  });

  it('requires deterministic idempotency for every side-effect scenario', () => {
    for (const entry of M_FOUND_12_SCENARIOS.filter((scenario) => scenario.sideEffects)) {
      expect(entry.idempotencyRequired, entry.id).toBe(true);
    }
  });

  it('requires provider read-back for external, financial and destructive side effects', () => {
    const providerCritical = new Set<RiskClass>([
      'WRITE_EXTERNAL',
      'FINANCIAL_IMPACT',
      'DESTRUCTIVE',
    ]);
    for (const entry of M_FOUND_12_SCENARIOS.filter(
      (scenario) => scenario.sideEffects && providerCritical.has(scenario.riskClass),
    )) {
      expect(entry.providerReadbackRequired, entry.id).toBe(true);
    }
  });

  it('keeps approval-sensitive drift/replay/tenant cases before provider execution', () => {
    for (const dimension of [
      'APPROVAL_REQUIRED',
      'PAYLOAD_DRIFT',
      'APPROVAL_REPLAY',
      'CROSS_TENANT_ATTEMPT',
    ] as const) {
      const scenario = M_FOUND_12_SCENARIOS.find((entry) => entry.dimension === dimension);
      expect(scenario?.approvalRequired, dimension).toBe(true);
      expect(scenario?.expectedOutcome, dimension).toBe('DENIED_BEFORE_PROVIDER');
    }
  });

  it('forces provider ambiguity, timeout and missing read-back away from success', () => {
    for (const dimension of [
      'PROVIDER_TIMEOUT',
      'AMBIGUOUS_PROVIDER_RESPONSE',
      'MISSING_READBACK',
    ] as const) {
      const scenario = M_FOUND_12_SCENARIOS.find((entry) => entry.dimension === dimension);
      expect(scenario?.expectedOutcome, dimension).not.toBe('SUCCEEDS_VERIFIED');
      expect(scenario?.providerReadbackRequired, dimension).toBe(true);
    }
  });

  it('keeps EventRecord and CRM linkage explicit rather than universal', () => {
    expect(
      M_FOUND_12_SCENARIOS.filter((entry) => entry.eventRecordApplicable).map(
        (entry) => entry.dimension,
      ),
    ).toEqual(['EVENT_RECORD_LINKAGE']);
    expect(
      M_FOUND_12_SCENARIOS.filter((entry) => entry.crmApplicable).map((entry) => entry.dimension),
    ).toEqual(['CRM_LINKAGE']);
  });
});

describe('M-FOUND-12 deterministic fault provider', () => {
  it('rejects endpoint or credential injection so the contract suite cannot invent connectivity', () => {
    expect(() => new MFound12FakeProvider({ endpoint: 'https://provider.invalid' })).toThrow(
      'M_FOUND_12_HARNESS_EXTERNAL_CONNECTIVITY_FORBIDDEN',
    );
    expect(() => new MFound12FakeProvider({ credential: 'not-a-real-secret' })).toThrow(
      'M_FOUND_12_HARNESS_EXTERNAL_CONNECTIVITY_FORBIDDEN',
    );
  });

  it('returns deterministic verified read-back without network access', async () => {
    const provider = new MFound12FakeProvider();
    const result = await provider.execute({ idempotencyKey: 'fixture-key' });
    const readback = await provider.readback();

    expect(result).toEqual({ accepted: true, providerId: 'fake-provider-resource-1' });
    expect(provider.calls).toEqual([{ idempotencyKey: 'fixture-key' }]);
    expect(readback).toEqual({ verified: true, evidence: ['fake:provider:verified'] });
  });

  it('models ambiguous and missing read-back as unverified evidence', async () => {
    const ambiguous = new MFound12FakeProvider({ behavior: 'AMBIGUOUS' });
    const missing = new MFound12FakeProvider({ behavior: 'MISSING_READBACK' });

    expect((await ambiguous.readback()).verified).toBe(false);
    expect((await missing.readback()).verified).toBe(false);
  });
});
