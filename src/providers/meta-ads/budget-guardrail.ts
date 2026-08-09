export interface BudgetGuardrailPolicy {
  readonly currency: string;
  readonly maxDailyBudgetMinor: number;
  readonly maxLifetimeBudgetMinor: number;
  readonly maxSingleIncreasePercent: number;
}

export interface BudgetChangeRequest {
  readonly currency: string;
  readonly type: 'DAILY' | 'LIFETIME';
  readonly currentBudgetMinor?: number;
  readonly requestedBudgetMinor: number;
}

export type BudgetDecision =
  | { readonly decision: 'ALLOW' }
  | { readonly decision: 'REQUIRE_APPROVAL'; readonly reason: string }
  | { readonly decision: 'DENY'; readonly reason: string };

export function evaluateBudgetChange(
  policy: BudgetGuardrailPolicy,
  request: BudgetChangeRequest,
): BudgetDecision {
  if (request.currency !== policy.currency) return { decision: 'DENY', reason: 'currency_not_allowed' };
  if (!Number.isSafeInteger(request.requestedBudgetMinor) || request.requestedBudgetMinor <= 0) {
    return { decision: 'DENY', reason: 'invalid_budget' };
  }

  const absoluteLimit = request.type === 'DAILY' ? policy.maxDailyBudgetMinor : policy.maxLifetimeBudgetMinor;
  if (request.requestedBudgetMinor > absoluteLimit) return { decision: 'DENY', reason: 'absolute_budget_limit' };

  if (request.currentBudgetMinor && request.requestedBudgetMinor > request.currentBudgetMinor) {
    const increase = ((request.requestedBudgetMinor - request.currentBudgetMinor) / request.currentBudgetMinor) * 100;
    if (increase > policy.maxSingleIncreasePercent) {
      return { decision: 'REQUIRE_APPROVAL', reason: 'increase_threshold' };
    }
  }

  return { decision: 'ALLOW' };
}
