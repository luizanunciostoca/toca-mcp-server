import type { BrandAsset } from '../contracts/creative-truth.js';
import { ExecutionError } from '../core/errors.js';

export const TOCA_CANONICAL_WHITE_LOGO = {
  brandAssetId: 'BRAND-TOCA-WHITE-V1',
  brand: 'TOCA_DO_MORCEGO',
  variant: 'WHITE',
  driveFileId: '1kd_Kk6SpAoFexwMgZsk1S1FpGpV-rdef',
  contentType: 'image/png',
  sha256: '87e81cdbd2ef6ae7f9263f4cf3973d1c55ac991da2708b2e15d2674f45f65d5e',
} as const;

export const TOCA_GENERATIVE_BRAND_BOUNDARY_INSTRUCTION = [
  'LOGO INTEGRITY GATE — mandatory.',
  'Do not draw, generate, reconstruct, repair, imitate, approximate or typeset the Toca do Morcego logo, symbol or wordmark.',
  'Do not add any graphic brand overlay to the generated image.',
  'Generate the visual base without a Toca graphic logo overlay; official brand pixels are fetched from Google Drive, hash-verified and composited later by a deterministic renderer.',
  'If real physical Toca signage already exists inside the source photograph, preserve it only as a factual scene element and never reconstruct or redesign it.',
].join('\n');

export interface GenerativeBrandBoundaryEvidence {
  readonly generatedByAi: boolean;
  readonly containsGeneratedBrandOverlay: boolean;
}

export interface DeterministicBrandCompositeEvidence {
  readonly brandAssetId: string;
  readonly driveFileId: string;
  readonly observedSha256: string;
  readonly deterministicComposite: boolean;
  readonly aiGeneratedBrandPixels: boolean;
}

export function assertCanonicalTocaLogoAsset(asset: BrandAsset): BrandAsset {
  if (asset.brand !== TOCA_CANONICAL_WHITE_LOGO.brand) return asset;
  if (asset.variant !== TOCA_CANONICAL_WHITE_LOGO.variant) return asset;

  if (
    asset.brandAssetId !== TOCA_CANONICAL_WHITE_LOGO.brandAssetId ||
    asset.driveFileId !== TOCA_CANONICAL_WHITE_LOGO.driveFileId ||
    asset.contentType !== TOCA_CANONICAL_WHITE_LOGO.contentType ||
    asset.integrityMode !== 'SHA256_PINNED' ||
    asset.sha256?.toLowerCase() !== TOCA_CANONICAL_WHITE_LOGO.sha256 ||
    asset.status !== 'ACTIVE_APPROVED' ||
    asset.aiReconstructionAllowed !== false
  ) {
    throw new ExecutionError('POLICY_DENIED', 'TOCA_CANONICAL_LOGO_BINDING_MISMATCH', false);
  }
  return asset;
}

export function assertGenerativeBaseHasNoBrandOverlay(
  evidence: GenerativeBrandBoundaryEvidence,
): void {
  if (evidence.generatedByAi && evidence.containsGeneratedBrandOverlay) {
    throw new ExecutionError('POLICY_DENIED', 'AI_GENERATED_LOGO_DETECTED', false);
  }
}

export function assertDeterministicTocaLogoComposite(
  evidence: DeterministicBrandCompositeEvidence,
): void {
  if (
    evidence.brandAssetId !== TOCA_CANONICAL_WHITE_LOGO.brandAssetId ||
    evidence.driveFileId !== TOCA_CANONICAL_WHITE_LOGO.driveFileId ||
    evidence.observedSha256.toLowerCase() !== TOCA_CANONICAL_WHITE_LOGO.sha256 ||
    !evidence.deterministicComposite ||
    evidence.aiGeneratedBrandPixels
  ) {
    throw new ExecutionError('POLICY_DENIED', 'TOCA_LOGO_COMPOSITE_INTEGRITY_FAILED', false);
  }
}
