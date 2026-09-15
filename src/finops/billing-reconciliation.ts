export type BillingReconciliationStatus =
  | 'MATCHED'
  | 'WITHIN_TOLERANCE'
  | 'MISSING_LEDGER_COST'
  | 'BILLING_EXCEEDS_LEDGER'
  | 'LEDGER_EXCEEDS_BILLING';

export interface BillingReconciliationInput {
  readonly ledgerActualCostMicroUsd: number;
  readonly billedCostMicroUsd: number;
  readonly toleranceMicroUsd?: number | undefined;
}

export interface BillingReconciliationResult {
  readonly status: BillingReconciliationStatus;
  readonly ledgerActualCostMicroUsd: number;
  readonly billedCostMicroUsd: number;
  readonly deltaMicroUsd: number;
  readonly absoluteDeltaMicroUsd: number;
  readonly toleranceMicroUsd: number;
  readonly sideEffects: false;
}

export function reconcileBillingAmounts(
  input: BillingReconciliationInput,
): BillingReconciliationResult {
  const ledgerActualCostMicroUsd = safeCost(
    input.ledgerActualCostMicroUsd,
    'LEDGER_ACTUAL_COST',
  );
  const billedCostMicroUsd = safeCost(input.billedCostMicroUsd, 'BILLED_COST');
  const toleranceMicroUsd = safeCost(input.toleranceMicroUsd ?? 0, 'TOLERANCE');
  const deltaMicroUsd = billedCostMicroUsd - ledgerActualCostMicroUsd;
  const absoluteDeltaMicroUsd = Math.abs(deltaMicroUsd);

  let status: BillingReconciliationStatus;
  if (ledgerActualCostMicroUsd === 0 && billedCostMicroUsd > 0) {
    status = 'MISSING_LEDGER_COST';
  } else if (deltaMicroUsd === 0) {
    status = 'MATCHED';
  } else if (absoluteDeltaMicroUsd <= toleranceMicroUsd) {
    status = 'WITHIN_TOLERANCE';
  } else if (deltaMicroUsd > 0) {
    status = 'BILLING_EXCEEDS_LEDGER';
  } else {
    status = 'LEDGER_EXCEEDS_BILLING';
  }

  return {
    status,
    ledgerActualCostMicroUsd,
    billedCostMicroUsd,
    deltaMicroUsd,
    absoluteDeltaMicroUsd,
    toleranceMicroUsd,
    sideEffects: false,
  };
}

function safeCost(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`FINOPS_${field}_INVALID`);
  }
  return value;
}
