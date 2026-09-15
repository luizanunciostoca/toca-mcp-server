export type BudgetUtilizationStatus =
  'BELOW_50' | 'NOTICE_50' | 'WARNING_70' | 'CRITICAL_85' | 'EXCEEDED_100';

export interface BudgetUtilizationInput {
  readonly actualCostMicroUsd: number;
  readonly budgetMicroUsd: number;
}

export interface BudgetUtilizationAssessment {
  readonly status: BudgetUtilizationStatus;
  readonly thresholdPercent: 0 | 50 | 70 | 85 | 100;
  readonly actualCostMicroUsd: number;
  readonly budgetMicroUsd: number;
  readonly remainingMicroUsd: number;
  readonly overageMicroUsd: number;
  readonly utilizationBasisPoints: number;
  readonly utilizationBasisPointsCapped: boolean;
  readonly advisoryOnly: true;
  readonly sideEffects: false;
}

export function evaluateBudgetUtilization(
  input: BudgetUtilizationInput,
): BudgetUtilizationAssessment {
  const actualCostMicroUsd = safeNonNegative(input.actualCostMicroUsd, 'ACTUAL_COST');
  const budgetMicroUsd = safePositive(input.budgetMicroUsd, 'BUDGET');
  const actual = BigInt(actualCostMicroUsd);
  const budget = BigInt(budgetMicroUsd);

  const rawBasisPoints = (actual * 10_000n) / budget;
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  const utilizationBasisPointsCapped = rawBasisPoints > maxSafe;
  const utilizationBasisPoints = utilizationBasisPointsCapped
    ? Number.MAX_SAFE_INTEGER
    : Number(rawBasisPoints);

  let status: BudgetUtilizationStatus = 'BELOW_50';
  let thresholdPercent: 0 | 50 | 70 | 85 | 100 = 0;
  if (actual >= budget) {
    status = 'EXCEEDED_100';
    thresholdPercent = 100;
  } else if (actual * 100n >= budget * 85n) {
    status = 'CRITICAL_85';
    thresholdPercent = 85;
  } else if (actual * 100n >= budget * 70n) {
    status = 'WARNING_70';
    thresholdPercent = 70;
  } else if (actual * 100n >= budget * 50n) {
    status = 'NOTICE_50';
    thresholdPercent = 50;
  }

  return {
    status,
    thresholdPercent,
    actualCostMicroUsd,
    budgetMicroUsd,
    remainingMicroUsd: Math.max(budgetMicroUsd - actualCostMicroUsd, 0),
    overageMicroUsd: Math.max(actualCostMicroUsd - budgetMicroUsd, 0),
    utilizationBasisPoints,
    utilizationBasisPointsCapped,
    advisoryOnly: true,
    sideEffects: false,
  };
}

function safeNonNegative(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`FINOPS_${field}_INVALID`);
  }
  return value;
}

function safePositive(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`FINOPS_${field}_INVALID`);
  }
  return value;
}
