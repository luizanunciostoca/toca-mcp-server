import {
  MASTER_PROMOTION_GUARD_VERSION,
  SOURCE_FAITHFUL_CINEMATIC_RESTORATION_PROFILE,
  TOCA_PHOTO_RESTORATION_POLICY_ID,
  masterPromotionEvidenceSchema,
  type MasterPromotionEvidence,
} from '../../contracts/photo-restoration.js';
import { ExecutionError } from '../../core/errors.js';

export interface MarketingReadyMasterDecision {
  readonly eligible: true;
  readonly status: 'MARKETING_READY';
  readonly targetFolderClass: '07_PRONTOS_PARA_MARKETING';
  readonly promotionGuardVersion: typeof MASTER_PROMOTION_GUARD_VERSION;
  readonly masterAssetId: string;
  readonly masterDriveFileId: string;
  readonly sourceAssetId: string;
  readonly sourceDriveFileId: string;
  readonly sourceSha256: string;
  readonly masterSha256: string;
  readonly promotionReviewedBy: string;
  readonly promotionReviewedAt: string;
  readonly promotionDecisionReason: string;
}

export function assertMarketingMasterPromotion(
  input: MasterPromotionEvidence,
): MarketingReadyMasterDecision {
  const parsed = masterPromotionEvidenceSchema.safeParse(input);
  if (!parsed.success) {
    throw new ExecutionError(
      'POLICY_DENIED',
      'MASTER_PROMOTION_BLOCKED_MISSING_CANONICAL_METADATA',
      false,
    );
  }
  const value = parsed.data;

  if (
    value.policyId !== TOCA_PHOTO_RESTORATION_POLICY_ID ||
    value.restorationProfile !== SOURCE_FAITHFUL_CINEMATIC_RESTORATION_PROFILE
  ) {
    throw new ExecutionError('POLICY_DENIED', 'MASTER_PROMOTION_BLOCKED_POLICY_DRIFT', false);
  }
  if (
    value.restorationConfidence !== 'HIGH' ||
    value.microDetailConfidence !== 'HIGH' ||
    !['HIGH', 'NOT_APPLICABLE'].includes(value.textDetailConfidence) ||
    !['HIGH', 'NOT_APPLICABLE'].includes(value.iconDetailConfidence) ||
    value.reviewRequiredReason?.trim()
  ) {
    throw new ExecutionError(
      'QUALITY_GATE_FAILED',
      'MASTER_PROMOTION_BLOCKED_DETAIL_CONFIDENCE',
      false,
    );
  }
  if (
    !value.identityLock ||
    !value.compositionLock ||
    !value.structureLock ||
    !value.backgroundLock ||
    !value.sourceImageBound
  ) {
    throw new ExecutionError(
      'FIDELITY_GATE_FAILED',
      'MASTER_PROMOTION_BLOCKED_FIDELITY_UNVERIFIED',
      false,
    );
  }
  if (value.generativeDetailSynthesisUsed) {
    throw new ExecutionError(
      'FIDELITY_GATE_FAILED',
      'MASTER_PROMOTION_BLOCKED_GENERATIVE_DETAIL_SYNTHESIS',
      false,
    );
  }
  if (value.semanticAlterationDetected) {
    throw new ExecutionError(
      'FIDELITY_GATE_FAILED',
      'MASTER_PROMOTION_BLOCKED_SEMANTIC_ALTERATION',
      false,
    );
  }
  if (value.outputLongEdgePixels < 3840) {
    throw new ExecutionError(
      'OUTPUT_TECH_SPEC_MISMATCH',
      'MASTER_PROMOTION_BLOCKED_TECH_SPEC',
      false,
    );
  }

  return {
    eligible: true,
    status: 'MARKETING_READY',
    targetFolderClass: '07_PRONTOS_PARA_MARKETING',
    promotionGuardVersion: MASTER_PROMOTION_GUARD_VERSION,
    masterAssetId: value.masterAssetId,
    masterDriveFileId: value.masterDriveFileId,
    sourceAssetId: value.sourceAssetId,
    sourceDriveFileId: value.sourceDriveFileId,
    sourceSha256: value.sourceSha256,
    masterSha256: value.outputSha256,
    promotionReviewedBy: value.promotionReviewedBy,
    promotionReviewedAt: value.promotionReviewedAt,
    promotionDecisionReason: value.promotionDecisionReason,
  };
}
