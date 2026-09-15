import { describe, expect, it } from 'vitest';
import { parseBillingSnapshot } from '../src/finops/billing-snapshot.js';
import { reconcileBillingAmounts } from '../src/finops/billing-reconciliation.js';
import { evaluateBudgetUtilization } from '../src/finops/budget-intelligence.js';

const baseSnapshot = {
  snapshotId: 'billing-snapshot-1',
  tenantId: 'tenant-finops',
  workspaceId: 'workspace-finops',
  organizationId: 'organization-finops',
  provider: 'GOOGLE_VERTEX_AI',
  model: 'gemini-2.5-flash',
  category: 'AI_TEXT' as const,
  periodStart: '2026-09-15T22:00:00Z',
  periodEnd: '2026-09-15T23:00:00Z',
  currency: 'USD' as const,
  billedCostMicroUsd: 10_000,
  evidenceRef: 'billing:gcp:2026-09-15:22',
  observedAt: '2026-09-15T23:05:00Z',
};

describe('TOCA OS FinOps billing reconciliation and budget intelligence', () => {
  it('accepts strict USD billing evidence and rejects unsupported currency or window', () => {
    expect(parseBillingSnapshot(baseSnapshot)).toMatchObject({
      snapshotId: 'billing-snapshot-1',
      currency: 'USD',
      billedCostMicroUsd: 10_000,
    });
    expect(() => parseBillingSnapshot({ ...baseSnapshot, currency: 'BRL' })).toThrow();
    expect(() =>
      parseBillingSnapshot({
        ...baseSnapshot,
        periodEnd: baseSnapshot.periodStart,
      }),
    ).toThrow('FINOPS_BILLING_PERIOD_INVALID');
  });

  it('classifies exact, tolerated and material billing differences without side effects', () => {
    expect(
      reconcileBillingAmounts({
        ledgerActualCostMicroUsd: 10_000,
        billedCostMicroUsd: 10_000,
      }),
    ).toMatchObject({ status: 'MATCHED', deltaMicroUsd: 0, sideEffects: false });
    expect(
      reconcileBillingAmounts({
        ledgerActualCostMicroUsd: 10_000,
        billedCostMicroUsd: 10_500,
        toleranceMicroUsd: 500,
      }),
    ).toMatchObject({ status: 'WITHIN_TOLERANCE', deltaMicroUsd: 500 });
    expect(
      reconcileBillingAmounts({
        ledgerActualCostMicroUsd: 0,
        billedCostMicroUsd: 500,
      }),
    ).toMatchObject({ status: 'MISSING_LEDGER_COST' });
    expect(
      reconcileBillingAmounts({
        ledgerActualCostMicroUsd: 8_000,
        billedCostMicroUsd: 10_000,
      }),
    ).toMatchObject({ status: 'BILLING_EXCEEDS_LEDGER' });
    expect(
      reconcileBillingAmounts({
        ledgerActualCostMicroUsd: 12_000,
        billedCostMicroUsd: 10_000,
      }),
    ).toMatchObject({ status: 'LEDGER_EXCEEDS_BILLING' });
  });

  it('emits advisory budget bands at 50, 70, 85 and 100 percent', () => {
    const budgetMicroUsd = 100_000;
    expect(evaluateBudgetUtilization({ actualCostMicroUsd: 49_999, budgetMicroUsd })).toMatchObject(
      {
        status: 'BELOW_50',
        thresholdPercent: 0,
        advisoryOnly: true,
        sideEffects: false,
      },
    );
    expect(evaluateBudgetUtilization({ actualCostMicroUsd: 50_000, budgetMicroUsd })).toMatchObject(
      {
        status: 'NOTICE_50',
        thresholdPercent: 50,
      },
    );
    expect(evaluateBudgetUtilization({ actualCostMicroUsd: 70_000, budgetMicroUsd })).toMatchObject(
      {
        status: 'WARNING_70',
        thresholdPercent: 70,
      },
    );
    expect(evaluateBudgetUtilization({ actualCostMicroUsd: 85_000, budgetMicroUsd })).toMatchObject(
      {
        status: 'CRITICAL_85',
        thresholdPercent: 85,
      },
    );
    expect(
      evaluateBudgetUtilization({ actualCostMicroUsd: 110_000, budgetMicroUsd }),
    ).toMatchObject({
      status: 'EXCEEDED_100',
      thresholdPercent: 100,
      remainingMicroUsd: 0,
      overageMicroUsd: 10_000,
    });
  });
});
