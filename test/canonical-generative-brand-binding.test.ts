import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { BrandAsset, CreativeStandard } from '../src/contracts/creative-truth.js';
import {
  resolveCanonicalGenerativeBrandInputs,
  type CanonicalBrandAssetRegistry,
} from '../src/creative/canonical-generative-brand-binding.js';

const tocaBytes = Uint8Array.from([1, 2, 3]);
const partyBytes = Uint8Array.from([4, 5, 6]);

const toca: BrandAsset = {
  brandAssetId: 'BRAND-TOCA-WHITE-V1',
  brand: 'TOCA_DO_MORCEGO',
  variant: 'WHITE',
  driveFileId: 'drive-toca',
  fileName: 'TOCA.png',
  contentType: 'image/png',
  integrityMode: 'SHA256_PINNED',
  sha256: createHash('sha256').update(tocaBytes).digest('hex'),
  status: 'ACTIVE_APPROVED',
  aiReconstructionAllowed: false,
};

const party: BrandAsset = {
  brandAssetId: 'BRAND-THE-PARTY-WHITE-V1',
  brand: 'THE_PARTY',
  variant: 'WHITE',
  driveFileId: 'drive-party',
  fileName: 'THE_PARTY.png',
  contentType: 'image/png',
  integrityMode: 'SHA256_PINNED',
  sha256: createHash('sha256').update(partyBytes).digest('hex'),
  status: 'ACTIVE_APPROVED',
  aiReconstructionAllowed: false,
};

function standard(
  standardId: string,
  operation: 'SUNSET' | 'THE_PARTY' | 'ALL',
): CreativeStandard {
  return {
    standardId,
    version: '1.0',
    brandScope: 'TOCA_DO_MORCEGO',
    operation,
    channel: 'ALL',
    format: 'ALL',
    parentPolicyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
    canonicalDriveId: 'drive-standard',
    repoMirrorPath: `control/${standardId}.json`,
    status: 'ACTIVE_CANONICAL',
    realAssetRequired: true,
    deterministicBrandInsertion: true,
    venueFidelityGateRequired: true,
  };
}

function brandInput(asset: BrandAsset, bytes: Uint8Array, overrides: Record<string, unknown> = {}) {
  return {
    registry: asset,
    bytes,
    contentType: 'image/png' as const,
    driveFileId: asset.driveFileId,
    ...overrides,
  };
}

function registry(assets: readonly BrandAsset[] = [toca, party]): CanonicalBrandAssetRegistry {
  return {
    getBrandAsset: vi.fn(async (brand: string, variant: string) =>
      assets.find((asset) => asset.brand === brand && asset.variant === variant),
    ),
  };
}

describe('resolveCanonicalGenerativeBrandInputs', () => {
  it('replaces caller registry metadata with the exact canonical official BRAND_ASSETS record', async () => {
    const forged: BrandAsset = {
      ...toca,
      brandAssetId: 'FORGED-TOCA',
      driveFileId: 'forged-drive',
      sha256: 'f'.repeat(64),
    };

    const resolved = await resolveCanonicalGenerativeBrandInputs(registry(), {
      outputStandard: standard('SUNSET_FEED_V1', 'SUNSET'),
      requiredBrands: ['TOCA_DO_MORCEGO'],
      suppliedBrandAssets: [
        brandInput(forged, tocaBytes, { driveFileId: toca.driveFileId }),
      ],
    });

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.registry).toEqual(toca);
    expect(resolved[0]?.driveFileId).toBe(toca.driveFileId);
  });

  it('requires Toca branding for Sunset standards and rejects unrequired extras', async () => {
    await expect(
      resolveCanonicalGenerativeBrandInputs(registry(), {
        outputStandard: standard('SUNSET_FEED_V1', 'SUNSET'),
        requiredBrands: ['MORRO_DIGITAL'],
        suppliedBrandAssets: [],
      }),
    ).rejects.toThrow('FAILED_BRAND_ASSET_MISSING');

    await expect(
      resolveCanonicalGenerativeBrandInputs(registry(), {
        outputStandard: standard('SUNSET_FEED_V1', 'SUNSET'),
        requiredBrands: ['TOCA_DO_MORCEGO'],
        suppliedBrandAssets: [brandInput(toca, tocaBytes), brandInput(party, partyBytes)],
      }),
    ).rejects.toThrow('FAILED_BRAND_ASSET_MISSING');
  });

  it('requires the official white The Party hero asset for either Party visual family', async () => {
    const wrongPartyHero: BrandAsset = {
      ...party,
      brandAssetId: 'BRAND-THE-PARTY-OTHER-V1',
    };
    await expect(
      resolveCanonicalGenerativeBrandInputs(registry([toca, wrongPartyHero]), {
        outputStandard: standard('THE_PARTY_HYBRID_MINIMALIST_V1', 'THE_PARTY'),
        requiredBrands: ['THE_PARTY'],
        suppliedBrandAssets: [brandInput(wrongPartyHero, partyBytes)],
      }),
    ).rejects.toThrow('FAILED_BRAND_ASSET_MISSING');
  });

  it('requires an explicit environment for The Party networks instead of inferring it from color or image', async () => {
    await expect(
      resolveCanonicalGenerativeBrandInputs(registry(), {
        outputStandard: standard('THE_PARTY_HYBRID_NETWORKS_V1', 'THE_PARTY'),
        requiredBrands: ['THE_PARTY'],
        suppliedBrandAssets: [brandInput(party, partyBytes)],
      }),
    ).rejects.toThrow('THE_PARTY_ENVIRONMENT_REQUIRED');
  });

  it('accepts Party networks only with canonical hero branding and explicit environment', async () => {
    const resolved = await resolveCanonicalGenerativeBrandInputs(registry(), {
      outputStandard: standard('THE_PARTY_HYBRID_NETWORKS_V1', 'THE_PARTY'),
      requiredBrands: ['THE_PARTY'],
      suppliedBrandAssets: [brandInput(party, partyBytes)],
      partyEnvironment: 'INTERNATIONAL',
    });

    expect(resolved[0]?.registry.brandAssetId).toBe('BRAND-THE-PARTY-WHITE-V1');
  });
});
