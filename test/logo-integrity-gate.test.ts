import { describe, expect, it } from 'vitest';
import type { BrandAsset } from '../src/contracts/creative-truth.js';
import {
  TOCA_CANONICAL_WHITE_LOGO,
  assertCanonicalTocaLogoAsset,
  assertDeterministicTocaLogoComposite,
  assertGenerativeBaseHasNoBrandOverlay,
} from '../src/creative/logo-integrity-gate.js';

function canonicalAsset(overrides: Partial<BrandAsset> = {}): BrandAsset {
  return {
    brandAssetId: TOCA_CANONICAL_WHITE_LOGO.brandAssetId,
    brand: TOCA_CANONICAL_WHITE_LOGO.brand,
    variant: TOCA_CANONICAL_WHITE_LOGO.variant,
    driveFileId: TOCA_CANONICAL_WHITE_LOGO.driveFileId,
    fileName: 'Logomarca Toca do Morcego Branca.png',
    contentType: TOCA_CANONICAL_WHITE_LOGO.contentType,
    integrityMode: 'SHA256_PINNED',
    sha256: TOCA_CANONICAL_WHITE_LOGO.sha256,
    status: 'ACTIVE_APPROVED',
    aiReconstructionAllowed: false,
    ...overrides,
  };
}

describe('Logo Integrity Gate', () => {
  it('accepts only the pinned canonical white Toca logo binding', () => {
    expect(assertCanonicalTocaLogoAsset(canonicalAsset())).toEqual(canonicalAsset());
  });

  it('fails closed when the Toca Drive file ID drifts', () => {
    expect(() =>
      assertCanonicalTocaLogoAsset(canonicalAsset({ driveFileId: 'wrong-drive-file-id' })),
    ).toThrow(/TOCA_CANONICAL_LOGO_BINDING_MISMATCH/);
  });

  it('fails closed when the pinned logo SHA-256 drifts', () => {
    expect(() =>
      assertCanonicalTocaLogoAsset(canonicalAsset({ sha256: 'a'.repeat(64) })),
    ).toThrow(/TOCA_CANONICAL_LOGO_BINDING_MISMATCH/);
  });

  it('rejects an AI-generated base that already contains a graphic brand overlay', () => {
    expect(() =>
      assertGenerativeBaseHasNoBrandOverlay({
        generatedByAi: true,
        containsGeneratedBrandOverlay: true,
      }),
    ).toThrow(/AI_GENERATED_LOGO_DETECTED/);
  });

  it('accepts an AI-generated base only when no generated brand overlay is present', () => {
    expect(() =>
      assertGenerativeBaseHasNoBrandOverlay({
        generatedByAi: true,
        containsGeneratedBrandOverlay: false,
      }),
    ).not.toThrow();
  });

  it('requires deterministic composition from the exact official asset', () => {
    expect(() =>
      assertDeterministicTocaLogoComposite({
        brandAssetId: TOCA_CANONICAL_WHITE_LOGO.brandAssetId,
        driveFileId: TOCA_CANONICAL_WHITE_LOGO.driveFileId,
        observedSha256: TOCA_CANONICAL_WHITE_LOGO.sha256,
        deterministicComposite: true,
        aiGeneratedBrandPixels: false,
      }),
    ).not.toThrow();
  });

  it('rejects a final brand composite that contains AI-generated brand pixels', () => {
    expect(() =>
      assertDeterministicTocaLogoComposite({
        brandAssetId: TOCA_CANONICAL_WHITE_LOGO.brandAssetId,
        driveFileId: TOCA_CANONICAL_WHITE_LOGO.driveFileId,
        observedSha256: TOCA_CANONICAL_WHITE_LOGO.sha256,
        deterministicComposite: true,
        aiGeneratedBrandPixels: true,
      }),
    ).toThrow(/TOCA_LOGO_COMPOSITE_INTEGRITY_FAILED/);
  });
});
