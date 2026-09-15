export const FINOPS_PRICE_CATALOG_VERSION = 'google-vertex-ai-2026-09-15-v1' as const;

export type AiPricingMode = 'STANDARD' | 'FLEX_BATCH';
export type AiPricedModel = 'gemini-2.5-flash' | 'gemini-2.5-flash-lite';

export interface AiTokenPrice {
  readonly inputMicroUsdPerMillion: number;
  readonly cachedInputMicroUsdPerMillion: number | null;
  readonly outputMicroUsdPerMillion: number;
}

export interface AiModelPricing {
  readonly provider: 'GOOGLE_VERTEX_AI';
  readonly model: AiPricedModel;
  readonly modes: Readonly<Record<AiPricingMode, AiTokenPrice>>;
}

export interface FinOpsPricingCatalog {
  readonly version: string;
  readonly currency: 'USD';
  readonly verifiedAt: string;
  readonly sourceUrl: string;
  readonly models: Readonly<Record<AiPricedModel, AiModelPricing>>;
}

/**
 * Official list prices expressed as integer micro-USD per 1M tokens.
 *
 * The business/runtime must pin the catalog version used for every estimate so
 * historical cost decisions remain reproducible when provider pricing changes.
 */
export const FINOPS_PRICE_CATALOG: FinOpsPricingCatalog = {
  version: FINOPS_PRICE_CATALOG_VERSION,
  currency: 'USD',
  verifiedAt: '2026-09-15T20:15:00Z',
  sourceUrl: 'https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing',
  models: {
    'gemini-2.5-flash': {
      provider: 'GOOGLE_VERTEX_AI',
      model: 'gemini-2.5-flash',
      modes: {
        STANDARD: {
          inputMicroUsdPerMillion: 300_000,
          cachedInputMicroUsdPerMillion: 30_000,
          outputMicroUsdPerMillion: 2_500_000,
        },
        FLEX_BATCH: {
          inputMicroUsdPerMillion: 150_000,
          cachedInputMicroUsdPerMillion: null,
          outputMicroUsdPerMillion: 1_250_000,
        },
      },
    },
    'gemini-2.5-flash-lite': {
      provider: 'GOOGLE_VERTEX_AI',
      model: 'gemini-2.5-flash-lite',
      modes: {
        STANDARD: {
          inputMicroUsdPerMillion: 100_000,
          cachedInputMicroUsdPerMillion: 10_000,
          outputMicroUsdPerMillion: 400_000,
        },
        FLEX_BATCH: {
          inputMicroUsdPerMillion: 50_000,
          cachedInputMicroUsdPerMillion: null,
          outputMicroUsdPerMillion: 200_000,
        },
      },
    },
  },
};

export function isAiPricedModel(value: string): value is AiPricedModel {
  return Object.prototype.hasOwnProperty.call(FINOPS_PRICE_CATALOG.models, value);
}

export function resolveAiTokenPricing(model: string, mode: AiPricingMode): AiTokenPrice {
  if (!isAiPricedModel(model)) throw new Error(`FINOPS_PRICE_UNKNOWN_MODEL:${model}`);
  return FINOPS_PRICE_CATALOG.models[model].modes[mode];
}
