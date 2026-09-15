export type CostGateDecision = 'ALLOW' | 'REQUIRE_APPROVAL' | 'BLOCK';

export interface CostGatePolicy {
  readonly policyRef: string;
  readonly automaticLimitMicroUsd: number;
  readonly approvalLimitMicroUsd: number;
}

export interface CostGateInput {
  readonly estimatedCostMicroUsd: number | null;
  readonly priceCatalogVersion: string | null;
  readonly policy: CostGatePolicy;
}

export interface CostGateResult {
  readonly decision: CostGateDecision;
  readonly reason: string;
  readonly estimatedCostMicroUsd: number | null;
  readonly policyRef: string;
  readonly priceCatalogVersion: string | null;
}

/**
 * Additive financial guard only. This never replaces Core Policy or Approval.
 * It may allow a request to continue to those authorities, require approval,
 * or add a hard block. It can never authorize a side effect by itself.
 */
export function evaluateCostGate(input: CostGateInput): CostGateResult {
  validatePolicy(input.policy);

  const cost = input.estimatedCostMicroUsd;
  if (cost === null || input.priceCatalogVersion === null) {
    return result(input, 'BLOCK', 'FINOPS_COST_OR_PRICE_UNKNOWN');
  }
  if (!Number.isSafeInteger(cost) || cost < 0) {
    return result(input, 'BLOCK', 'FINOPS_COST_INVALID');
  }
  if (cost > input.policy.approvalLimitMicroUsd) {
    return result(input, 'BLOCK', 'FINOPS_HARD_COST_LIMIT_EXCEEDED');
  }
  if (cost > input.policy.automaticLimitMicroUsd) {
    return result(input, 'REQUIRE_APPROVAL', 'FINOPS_FORMAL_APPROVAL_REQUIRED');
  }
  return result(input, 'ALLOW', 'FINOPS_WITHIN_AUTOMATIC_LIMIT');
}

function validatePolicy(policy: CostGatePolicy): void {
  if (!policy.policyRef.trim()) throw new Error('FINOPS_COST_POLICY_REF_REQUIRED');

  const limits = [policy.automaticLimitMicroUsd, policy.approvalLimitMicroUsd];
  for (const value of limits) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('FINOPS_COST_POLICY_INVALID');
    }
  }

  if (policy.automaticLimitMicroUsd > policy.approvalLimitMicroUsd) {
    throw new Error('FINOPS_COST_POLICY_LIMIT_ORDER_INVALID');
  }
}

function result(
  input: CostGateInput,
  decision: CostGateDecision,
  reason: string,
): CostGateResult {
  return {
    decision,
    reason,
    estimatedCostMicroUsd: input.estimatedCostMicroUsd,
    policyRef: input.policy.policyRef,
    priceCatalogVersion: input.priceCatalogVersion,
  };
}
