import {
  FINOPS_PRICE_CATALOG_VERSION,
  resolveAiTokenPricing,
  type AiPricingMode,
} from './pricing-catalog.js';

export interface AiTextUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
}

export interface AiTextCostEstimate {
  readonly priceCatalogVersion: string;
  readonly model: string;
  readonly pricingMode: AiPricingMode;
  readonly currency: 'USD';
  readonly nonCachedInputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly inputCostMicroUsd: number;
  readonly cachedInputCostMicroUsd: number;
  readonly outputCostMicroUsd: number;
  readonly totalCostMicroUsd: number;
}

export function estimateAiTextCost(
  model: string,
  pricingMode: AiPricingMode,
  usage: AiTextUsage,
): AiTextCostEstimate {
  assertUsage(usage);
  const price = resolveAiTokenPricing(model, pricingMode);
  if (usage.cachedInputTokens > 0 && price.cachedInputMicroUsdPerMillion === null) {
    throw new Error(`FINOPS_CACHED_INPUT_PRICE_UNAVAILABLE:${model}:${pricingMode}`);
  }

  const nonCachedInputTokens = usage.inputTokens - usage.cachedInputTokens;
  const inputCostMicroUsd = priceUnits(nonCachedInputTokens, price.inputMicroUsdPerMillion);
  const cachedInputCostMicroUsd =
    usage.cachedInputTokens === 0
      ? 0
      : priceUnits(usage.cachedInputTokens, price.cachedInputMicroUsdPerMillion ?? 0);
  const outputCostMicroUsd = priceUnits(usage.outputTokens, price.outputMicroUsdPerMillion);

  return {
    priceCatalogVersion: FINOPS_PRICE_CATALOG_VERSION,
    model,
    pricingMode,
    currency: 'USD',
    nonCachedInputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    outputTokens: usage.outputTokens,
    inputCostMicroUsd,
    cachedInputCostMicroUsd,
    outputCostMicroUsd,
    totalCostMicroUsd: inputCostMicroUsd + cachedInputCostMicroUsd + outputCostMicroUsd,
  };
}

function assertUsage(usage: AiTextUsage): void {
  for (const [name, value] of Object.entries(usage)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`FINOPS_USAGE_INVALID:${name}`);
    }
  }
  if (usage.cachedInputTokens > usage.inputTokens) {
    throw new Error('FINOPS_CACHED_INPUT_EXCEEDS_INPUT');
  }
}

function priceUnits(units: number, microUsdPerMillion: number): number {
  if (!Number.isSafeInteger(microUsdPerMillion) || microUsdPerMillion < 0) {
    throw new Error('FINOPS_PRICE_INVALID');
  }
  const numerator = BigInt(units) * BigInt(microUsdPerMillion);
  const result = (numerator + 999_999n) / 1_000_000n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('FINOPS_COST_OVERFLOW');
  return Number(result);
}
