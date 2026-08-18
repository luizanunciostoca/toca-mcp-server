import { readFile } from 'node:fs/promises';
import { masterPromotionEvidenceSchema } from './contracts/photo-restoration.js';
import { assertMarketingMasterPromotion } from './providers/google-sheets/master-promotion-guard.js';

const evidencePath = parseEvidencePath(process.argv.slice(2));
const raw = JSON.parse(await readFile(evidencePath, 'utf8')) as unknown;
const evidence = masterPromotionEvidenceSchema.parse(raw);
const decision = assertMarketingMasterPromotion(evidence);

process.stdout.write(
  `${JSON.stringify({
    ...decision,
    promotionStatus: 'APPROVED_FOR_MARKETING',
    physicalDriveWriteAuthorizedByThisCommand: false,
    nextStep: 'UPLOAD_OR_MOVE_EXACT_MASTER_BYTES_TO_CANONICAL_07_FOLDER_AND_WRITE_BACK',
  })}\n`,
);

function parseEvidencePath(argv: readonly string[]): string {
  if (argv.length !== 2 || argv[0] !== '--evidence' || !argv[1]?.trim()) {
    throw new Error('MASTER_PROMOTION_EVIDENCE_PATH_REQUIRED');
  }
  return argv[1].trim();
}
