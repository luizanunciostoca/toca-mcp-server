import { readFileSync } from 'node:fs';

const policy = JSON.parse(read('control/photo-restoration-policy.v1.json'));
const contract = read('src/contracts/photo-restoration.ts');
const enhancer = read('src/providers/local/local-photo-enhancer.ts');
const guard = read('src/providers/google-sheets/master-promotion-guard.ts');
const promoteCli = read('src/marketing-autopilot-master-promote.ts');
const packageJson = JSON.parse(read('package.json'));

if (
  policy.policyId !== 'TOCA_PHOTO_RESTORATION_POLICY_V1' ||
  policy.version !== '1.0' ||
  policy.status !== 'ACTIVE_CANONICAL_MIRROR' ||
  policy.restorationProfile !== 'SOURCE_FAITHFUL_CINEMATIC_RESTORATION_V1' ||
  policy.defaultPipeline !== 'local-photo-enhancer-v2' ||
  policy.targetLongEdgePixels !== 3840 ||
  policy.proResScope !== 'VIDEO_ONLY_NOT_APPLICABLE_TO_STILL' ||
  policy.sourceImageBindingRequired !== true ||
  policy.identityLockRequired !== true ||
  policy.compositionLockRequired !== true ||
  policy.structureLockRequired !== true ||
  policy.backgroundLockRequired !== true ||
  policy.generativeDetailSynthesisAllowed !== false ||
  policy.semanticAlterationAllowed !== false ||
  policy.promotionFolderClass !== '07_PRONTOS_PARA_MARKETING' ||
  policy.promotionGuardVersion !== 'master-promotion-guard-v1' ||
  policy.autoPromotionBeforeReview !== false ||
  policy.marketingReadyOnlyAfterGuard !== true ||
  policy.promotionReviewerIdentityRequired !== true ||
  policy.promotionReviewTimestampRequired !== true ||
  policy.promotionDecisionReasonRequired !== true
) {
  fail('Photo restoration policy mirror drifted from the canonical source-faithful contract');
}

for (const marker of [
  'TOCA_PHOTO_RESTORATION_POLICY_V1',
  'SOURCE_FAITHFUL_CINEMATIC_RESTORATION_V1',
  'master-promotion-guard-v1',
  "proResApplicability: z.literal('VIDEO_ONLY_NOT_APPLICABLE_TO_STILL')",
  'promotionReviewedBy: z.string().min(1)',
  'promotionReviewedAt: z.string().min(1)',
  'promotionDecisionReason: z.string().min(1)',
]) {
  if (!contract.includes(marker)) fail(`Photo restoration contract missing: ${marker}`);
}

for (const marker of [
  "pipelineVersion: 'local-photo-enhancer-v2'",
  "requestedScale: '4K_LONG_EDGE'",
  "outputLongEdgePixels: 3840",
  "identityLock: true",
  "compositionLock: true",
  "structureLock: true",
  "backgroundLock: true",
  "generativeDetailSynthesisUsed: false",
  "semanticAlterationDetected: false",
  "restorationConfidence: 'REVIEW_REQUIRED'",
  "promotionEligible: false",
  "'3840x3840'",
  "'98'",
]) {
  if (!enhancer.includes(marker)) fail(`Local photo restoration invariant missing: ${marker}`);
}

for (const marker of [
  'assertMarketingMasterPromotion',
  'MASTER_PROMOTION_BLOCKED_MISSING_CANONICAL_METADATA',
  'MASTER_PROMOTION_BLOCKED_DETAIL_CONFIDENCE',
  'MASTER_PROMOTION_BLOCKED_FIDELITY_UNVERIFIED',
  'MASTER_PROMOTION_BLOCKED_GENERATIVE_DETAIL_SYNTHESIS',
  'MASTER_PROMOTION_BLOCKED_SEMANTIC_ALTERATION',
  'MASTER_PROMOTION_BLOCKED_TECH_SPEC',
  "status: 'MARKETING_READY'",
  "targetFolderClass: '07_PRONTOS_PARA_MARKETING'",
  'promotionReviewedBy: value.promotionReviewedBy',
  'promotionReviewedAt: value.promotionReviewedAt',
  'promotionDecisionReason: value.promotionDecisionReason',
]) {
  if (!guard.includes(marker)) fail(`Master promotion guard invariant missing: ${marker}`);
}

for (const marker of [
  'masterPromotionEvidenceSchema.parse',
  'assertMarketingMasterPromotion',
  "promotionStatus: 'APPROVED_FOR_MARKETING'",
  'physicalDriveWriteAuthorizedByThisCommand: false',
  'UPLOAD_OR_MOVE_EXACT_MASTER_BYTES_TO_CANONICAL_07_FOLDER_AND_WRITE_BACK',
]) {
  if (!promoteCli.includes(marker)) fail(`Controlled master promotion CLI invariant missing: ${marker}`);
}

if (
  packageJson.scripts?.['dev:marketing-autopilot-master-promote'] !==
    'tsx src/marketing-autopilot-master-promote.ts' ||
  packageJson.scripts?.['start:marketing-autopilot-master-promote'] !==
    'node dist/src/marketing-autopilot-master-promote.js' ||
  !packageJson.scripts?.['architecture:check']?.includes('check-photo-restoration-contract.mjs')
) {
  fail('Package scripts no longer expose or guard the controlled master promotion path');
}

console.log('Photo restoration and master promotion contract OK');

function read(path) {
  return readFileSync(path, 'utf8');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
