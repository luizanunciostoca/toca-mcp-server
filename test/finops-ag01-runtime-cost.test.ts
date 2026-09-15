import { describe, expect, it } from 'vitest';
import {
  Ag01RuntimeCostContext,
  Ag01VertexRuntimeCostObserver,
} from '../src/finops/ag01-runtime-cost-observer.js';
import type {
  CostLedger,
  CostLedgerAppendResult,
  CostLedgerCorrelationQuery,
} from '../src/finops/postgres-cost-ledger.js';
import type { CostEvent } from '../src/finops/cost-event.js';

class MemoryLedger implements CostLedger {
  readonly events: CostEvent[] = [];

  append(event: CostEvent): Promise<CostLedgerAppendResult> {
    this.events.push(event);
    return Promise.resolve({ status: 'APPENDED', eventHash: `hash-${this.events.length}` });
  }

  listByCorrelation(query: CostLedgerCorrelationQuery): Promise<readonly CostEvent[]> {
    return Promise.resolve(
      this.events.filter(
        (event) =>
          event.tenantId === query.tenantId &&
          event.workspaceId === query.workspaceId &&
          event.organizationId === query.organizationId &&
          event.correlationId === query.correlationId,
      ),
    );
  }
}

const scope = {
  executionId: 'ag01-cost-execution-1',
  correlationId: 'ag01-cost-correlation-1',
  tenantId: 'toca',
  workspaceId: 'toca',
  organizationId: 'toca',
  startedAt: '2026-09-15T22:00:00.000Z',
} as const;

describe('AG-01 runtime FinOps observer', () => {
  it('records ESTIMATE, ACTUAL and WITHIN_ESTIMATE reconciliation', async () => {
    const ledger = new MemoryLedger();
    const context = new Ag01RuntimeCostContext();
    const observer = new Ag01VertexRuntimeCostObserver(ledger, context);

    await context.run(scope, async () => {
      await observer.beforeRequest({
        configuredModel: 'gemini-2.5-flash',
        estimatedInputTokens: 10_000,
        maxOutputTokens: 2_000,
      });
      await observer.afterResponse({
        configuredModel: 'gemini-2.5-flash',
        responseModel: 'gemini-2.5-flash-001',
        responseId: 'vertex-response-sensitive/provider-shape',
        routeId: 'R17',
        agentId: 'AG-01',
        usage: { inputTokens: 8_000, cachedInputTokens: 1_000, outputTokens: 1_000 },
      });
    });

    expect(ledger.events.map((event) => event.phase)).toEqual([
      'ESTIMATE',
      'ACTUAL',
      'RECONCILIATION',
    ]);
    expect(ledger.events[0]).toMatchObject({
      provider: 'GOOGLE_VERTEX_AI',
      model: 'gemini-2.5-flash',
      estimatedCostMicroUsd: 8_000,
    });
    expect(ledger.events[1]).toMatchObject({
      routeId: 'R17',
      agentId: 'AG-01',
      actualCostMicroUsd: 4_620,
    });
    expect(ledger.events[2]?.metadata?.reconciliationRef).toContain('WITHIN_ESTIMATE');
    expect(ledger.events[1]?.metadata?.providerUsageRef).toMatch(
      /^vertex:response-sha256:[0-9a-f]{64}$/,
    );
  });

  it('records a reconciliation gap instead of fabricating zero cost when usage is absent', async () => {
    const ledger = new MemoryLedger();
    const context = new Ag01RuntimeCostContext();
    const observer = new Ag01VertexRuntimeCostObserver(ledger, context);

    await context.run(scope, async () => {
      await observer.beforeRequest({
        configuredModel: 'gemini-2.5-flash',
        estimatedInputTokens: 1_000,
        maxOutputTokens: 512,
      });
      await observer.afterResponse({
        configuredModel: 'gemini-2.5-flash',
        responseModel: 'gemini-2.5-flash',
        responseId: 'vertex-response-without-usage',
        routeId: 'R17',
        agentId: 'AG-01',
        usage: null,
      });
    });

    expect(ledger.events.map((event) => event.phase)).toEqual(['ESTIMATE', 'RECONCILIATION']);
    expect(ledger.events.some((event) => event.phase === 'ACTUAL')).toBe(false);
    expect(ledger.events[1]?.actualCostMicroUsd).toBeUndefined();
    expect(ledger.events[1]?.metadata?.reconciliationRef).toContain('MISSING_ACTUAL_USAGE');
  });

  it('fails closed before provider accounting when the configured model has no verified price', async () => {
    const ledger = new MemoryLedger();
    const context = new Ag01RuntimeCostContext();
    const observer = new Ag01VertexRuntimeCostObserver(ledger, context);

    await expect(
      context.run(scope, () =>
        observer.beforeRequest({
          configuredModel: 'gemini-unpriced',
          estimatedInputTokens: 1_000,
          maxOutputTokens: 512,
        }),
      ),
    ).rejects.toThrow('FINOPS_RUNTIME_PRICE_UNKNOWN:gemini-unpriced');
    expect(ledger.events).toHaveLength(0);
  });
});
