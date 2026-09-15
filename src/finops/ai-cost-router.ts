import type { AiPricingMode, AiPricedModel } from './pricing-catalog.js';

export type AiTaskKind =
  | 'CLASSIFICATION'
  | 'EXTRACTION'
  | 'SUMMARY'
  | 'FAQ_RESPONSE'
  | 'COPY'
  | 'PLANNING'
  | 'STRATEGY'
  | 'OTHER';

export type AiTaskComplexity = 'LOW' | 'MEDIUM' | 'HIGH';
export type AiTaskAmbiguity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface AiCostRoutingRequest {
  readonly taskKind: AiTaskKind;
  readonly complexity: AiTaskComplexity;
  readonly ambiguity: AiTaskAmbiguity;
  readonly deterministicAvailable: boolean;
  readonly requiresGenerativeLanguage: boolean;
  readonly backgroundBatchEligible: boolean;
}

export type AiCostRoutingPlan =
  | {
      readonly lane: 'DETERMINISTIC';
      readonly enforcement: 'ADVISORY';
      readonly maxOutputTokens: 0;
      readonly reason: string;
      readonly costGateRequired: true;
    }
  | {
      readonly lane: 'MODEL';
      readonly enforcement: 'ADVISORY';
      readonly model: AiPricedModel;
      readonly pricingMode: AiPricingMode;
      readonly maxOutputTokens: number;
      readonly reason: string;
      readonly costGateRequired: true;
    };

/**
 * Cost-aware recommendation only. The caller must still pass Core Policy,
 * Approval and provider-readback gates. This function performs no model call.
 */
export function routeAiCost(request: AiCostRoutingRequest): AiCostRoutingPlan {
  if (request.deterministicAvailable && !request.requiresGenerativeLanguage) {
    return {
      lane: 'DETERMINISTIC',
      enforcement: 'ADVISORY',
      maxOutputTokens: 0,
      reason: 'FINOPS_DETERMINISTIC_PATH_AVAILABLE',
      costGateRequired: true,
    };
  }

  const pricingMode: AiPricingMode = request.backgroundBatchEligible ? 'FLEX_BATCH' : 'STANDARD';
  const useFlash =
    request.complexity === 'HIGH' ||
    request.ambiguity === 'HIGH' ||
    request.taskKind === 'PLANNING' ||
    request.taskKind === 'STRATEGY';

  if (useFlash) {
    return {
      lane: 'MODEL',
      enforcement: 'ADVISORY',
      model: 'gemini-2.5-flash',
      pricingMode,
      maxOutputTokens: flashOutputCap(request.taskKind),
      reason: 'FINOPS_QUALITY_ESCALATION_TO_FLASH',
      costGateRequired: true,
    };
  }

  return {
    lane: 'MODEL',
    enforcement: 'ADVISORY',
    model: 'gemini-2.5-flash-lite',
    pricingMode,
    maxOutputTokens: liteOutputCap(request.taskKind),
    reason: 'FINOPS_LOW_COST_MODEL_ELIGIBLE',
    costGateRequired: true,
  };
}

function liteOutputCap(taskKind: AiTaskKind): number {
  switch (taskKind) {
    case 'CLASSIFICATION':
      return 256;
    case 'EXTRACTION':
    case 'FAQ_RESPONSE':
      return 512;
    case 'SUMMARY':
      return 768;
    case 'COPY':
      return 1_024;
    default:
      return 1_024;
  }
}

function flashOutputCap(taskKind: AiTaskKind): number {
  switch (taskKind) {
    case 'PLANNING':
      return 2_048;
    case 'STRATEGY':
      return 4_096;
    default:
      return 2_048;
  }
}
