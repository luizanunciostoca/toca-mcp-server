import { describe, expect, it } from 'vitest';
import { routeAiCost } from '../src/finops/ai-cost-router.js';
import { estimateAiTextCost } from '../src/finops/cost-estimator.js';
import { evaluateCostGate } from '../src/finops/cost-gate.js';
import { parseCostEvent } from '../src/finops/cost-event.js';

const policy = {
  policyRef: 'TOCA_OS:FINOPS_TEST_POLICY',
  automaticLimitMicroUsd: 10_000,
  approvalLimitMicroUsd: 1_000_000,
} as const;

describe('TOCA OS FinOps cost control', () => {
  it('prices Flash and Flash Lite in integer micro-USD', () => {
    const usage = {
      inputTokens: 10_000,
      cachedInputTokens: 0,
      outputTokens: 2_000,
    };
    const flash = estimateAiTextCost('gemini-2.5-flash', 'STANDARD', usage);
    const lite = estimateAiTextCost('gemini-2.5-flash-lite', 'STANDARD', usage);

    expect(flash.totalCostMicroUsd).toBe(8_000);
    expect(lite.totalCostMicroUsd).toBe(1_800);
  });

  it('charges cached input at the pinned cached-token rate', () => {
    const result = estimateAiTextCost('gemini-2.5-flash', 'STANDARD', {
      inputTokens: 10_000,
      cachedInputTokens: 8_000,
      outputTokens: 2_000,
    });

    expect(result.inputCostMicroUsd).toBe(600);
    expect(result.cachedInputCostMicroUsd).toBe(240);
    expect(result.outputCostMicroUsd).toBe(5_000);
    expect(result.totalCostMicroUsd).toBe(5_840);
  });

  it('fails closed when the combined micro-USD total would overflow', () => {
    expect(() =>
      estimateAiTextCost('gemini-2.5-flash', 'STANDARD', {
        inputTokens: Number.MAX_SAFE_INTEGER,
        cachedInputTokens: 0,
        outputTokens: 2_800_000_000_000_000,
      }),
    ).toThrow('FINOPS_COST_OVERFLOW');
  });

  it('fails closed when pricing is unknown', () => {
    const usage = {
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 1,
    };

    expect(() => estimateAiTextCost('unknown-model', 'STANDARD', usage)).toThrow(
      'FINOPS_PRICE_UNKNOWN_MODEL',
    );
  });

  it('routes deterministic work before using a model', () => {
    const plan = routeAiCost({
      taskKind: 'CLASSIFICATION',
      complexity: 'LOW',
      ambiguity: 'LOW',
      deterministicAvailable: true,
      requiresGenerativeLanguage: false,
      backgroundBatchEligible: false,
    });

    expect(plan).toMatchObject({ lane: 'DETERMINISTIC', maxOutputTokens: 0 });
  });

  it('routes routine work to Lite and complex planning to Flash', () => {
    const routine = routeAiCost({
      taskKind: 'FAQ_RESPONSE',
      complexity: 'LOW',
      ambiguity: 'LOW',
      deterministicAvailable: false,
      requiresGenerativeLanguage: true,
      backgroundBatchEligible: false,
    });
    expect(routine).toMatchObject({
      lane: 'MODEL',
      model: 'gemini-2.5-flash-lite',
      maxOutputTokens: 512,
      enforcement: 'ADVISORY',
    });

    const complex = routeAiCost({
      taskKind: 'PLANNING',
      complexity: 'HIGH',
      ambiguity: 'MEDIUM',
      deterministicAvailable: false,
      requiresGenerativeLanguage: true,
      backgroundBatchEligible: false,
    });
    expect(complex).toMatchObject({
      lane: 'MODEL',
      model: 'gemini-2.5-flash',
      maxOutputTokens: 2_048,
    });
  });

  it('uses Flex/Batch only for background-eligible work', () => {
    const plan = routeAiCost({
      taskKind: 'SUMMARY',
      complexity: 'LOW',
      ambiguity: 'LOW',
      deterministicAvailable: false,
      requiresGenerativeLanguage: true,
      backgroundBatchEligible: true,
    });

    expect(plan).toMatchObject({ pricingMode: 'FLEX_BATCH' });
  });

  it('adds financial restrictions without authorizing a side effect', () => {
    const allow = evaluateCostGate({
      estimatedCostMicroUsd: 8_000,
      priceCatalogVersion: 'v1',
      policy,
    });
    const approval = evaluateCostGate({
      estimatedCostMicroUsd: 20_000,
      priceCatalogVersion: 'v1',
      policy,
    });
    const block = evaluateCostGate({
      estimatedCostMicroUsd: 2_000_000,
      priceCatalogVersion: 'v1',
      policy,
    });
    const unknown = evaluateCostGate({
      estimatedCostMicroUsd: null,
      priceCatalogVersion: null,
      policy,
    });

    expect(allow).toMatchObject({ decision: 'ALLOW' });
    expect(approval).toMatchObject({ decision: 'REQUIRE_APPROVAL' });
    expect(block).toMatchObject({ decision: 'BLOCK' });
    expect(unknown).toMatchObject({
      decision: 'BLOCK',
      reason: 'FINOPS_COST_OR_PRICE_UNKNOWN',
    });
  });

  it('requires actual cost evidence for ACTUAL ledger events', () => {
    expect(() =>
      parseCostEvent({
        eventId: 'cost-1',
        executionId: 'exec-1',
        correlationId: 'corr-1',
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        organizationId: 'org-1',
        provider: 'GOOGLE_VERTEX_AI',
        model: 'gemini-2.5-flash',
        category: 'AI_TEXT',
        phase: 'ACTUAL',
        priceCatalogVersion: 'v1',
        currency: 'USD',
        usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20 },
        createdAt: '2026-09-15T20:20:00Z',
      }),
    ).toThrow();
  });

  it('allows only sanitized opaque-reference metadata', () => {
    const base = {
      eventId: 'cost-metadata-1',
      executionId: 'exec-metadata-1',
      correlationId: 'corr-metadata-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      organizationId: 'org-1',
      provider: 'GOOGLE_VERTEX_AI',
      model: 'gemini-2.5-flash',
      category: 'AI_TEXT',
      phase: 'ESTIMATE',
      priceCatalogVersion: 'v1',
      currency: 'USD',
      estimatedCostMicroUsd: 100,
      usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20 },
      createdAt: '2026-09-15T20:20:00Z',
    } as const;

    expect(
      parseCostEvent({
        ...base,
        metadata: {
          providerReadbackRef: 'provider:readback-1',
          evidenceRefs: ['audit:event-1', 'usage:vertex-1'],
        },
      }).metadata,
    ).toEqual({
      providerReadbackRef: 'provider:readback-1',
      evidenceRefs: ['audit:event-1', 'usage:vertex-1'],
    });

    expect(() =>
      parseCostEvent({
        ...base,
        metadata: { rawProviderPayload: 'must-not-be-persisted' },
      }),
    ).toThrow();
    expect(() =>
      parseCostEvent({
        ...base,
        metadata: { evidenceRefs: ['contains free-form user data'] },
      }),
    ).toThrow('FINOPS_METADATA_REF_INVALID');
  });
});
