import { describe, expect, it } from 'vitest';
import { discoverInstagramCapabilities } from '../src/providers/instagram/instagram-capabilities.js';
import { evaluateBudgetChange } from '../src/providers/meta-ads/budget-guardrail.js';

describe('preconnection provider contracts', () => {
  it('promotes Instagram capabilities only with positive provider evidence', () => {
    expect(
      discoverInstagramCapabilities({
        scopes: ['instagram_basic'],
        accountEligible: true,
        providerEvidence: ['instagram.profile.read'],
      }),
    ).toEqual(['instagram.profile.read']);
  });

  it('does not infer write capabilities from scopes alone', () => {
    expect(
      discoverInstagramCapabilities({
        scopes: ['instagram_basic'],
        accountEligible: true,
        providerEvidence: [],
      }),
    ).toEqual([]);
  });

  it('denies budgets beyond absolute policy limits', () => {
    expect(
      evaluateBudgetChange(
        {
          currency: 'BRL',
          maxDailyBudgetMinor: 100_000,
          maxLifetimeBudgetMinor: 500_000,
          maxSingleIncreasePercent: 25,
        },
        { currency: 'BRL', type: 'DAILY', requestedBudgetMinor: 150_000 },
      ),
    ).toEqual({ decision: 'DENY', reason: 'absolute_budget_limit' });
  });

  it('requires approval for a large single budget increase inside absolute limits', () => {
    expect(
      evaluateBudgetChange(
        {
          currency: 'BRL',
          maxDailyBudgetMinor: 100_000,
          maxLifetimeBudgetMinor: 500_000,
          maxSingleIncreasePercent: 20,
        },
        {
          currency: 'BRL',
          type: 'DAILY',
          currentBudgetMinor: 50_000,
          requestedBudgetMinor: 65_000,
        },
      ),
    ).toEqual({ decision: 'REQUIRE_APPROVAL', reason: 'increase_threshold' });
  });
});
