import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { BrandAsset, CreativeStandard, VenueAsset } from '../src/contracts/creative-truth.js';
import { CreativeTruthResolver } from '../src/creative/creative-truth-resolver.js';
import {
  resolveThePartyVisualFamily,
  type ThePartyVisualStandardId,
} from '../src/creative/the-party-visual-family-resolver.js';
import type { GoogleSheetsCreativeTruthRegistry } from '../src/providers/google-sheets/creative-truth-registry.js';

const masterBytes = Uint8Array.from([2, 4, 6, 8]);
const masterSha256 = createHash('sha256').update(masterBytes).digest('hex');

const venue: VenueAsset = {
  venueAssetId: 'VENUE-TP-0130',
  sourceAssetId: 'TP-0130',
  sourceDriveFileId: '1wRkNvKPwA9c8y39yQgD7-ioswR-ewGbQ',
  masterAssetId: 'MM-TP-0130-V1',
  masterDriveFileId: '1o0Y7K3e5VbPeCPzI35tq4St9w7J3Avnk',
  sourceSha256: masterSha256,
  masterSha256,
  operation: 'THE_PARTY',
  locationSignature: 'party_pista',
  dominantSubject: 'publico_pico_da_noite',
  venueVerified: true,
  marketingReady: true,
  generativeReferenceAllowed: false,
  protectedElements: ['PISTA', 'TETO', 'COLUNAS'],
  status: 'ACTIVE_APPROVED',
};

function standard(standardId: ThePartyVisualStandardId): CreativeStandard {
  return {
    standardId,
    version: '1.0',
    brandScope: 'TOCA_DO_MORCEGO',
    operation: 'THE_PARTY',
    channel: 'ALL',
    format: 'ALL',
    parentPolicyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
    canonicalDriveId: '1QQRReW6dLwAh0BrJUiVpbXHGsbV-5ze81MOYkSx7WIU',
    repoMirrorPath: `control/creative-standards/${standardId.toLowerCase()}.json`,
    status: 'ACTIVE_CANONICAL',
    realAssetRequired: true,
    deterministicBrandInsertion: true,
    venueFidelityGateRequired: true,
  };
}

function brand(name: string): BrandAsset {
  return {
    brandAssetId: `BRAND-${name}-WHITE-V1`,
    brand: name,
    variant: 'WHITE',
    driveFileId: `drive-${name}`,
    fileName: `${name}.png`,
    contentType: 'image/png',
    integrityMode: 'SHA256_PINNED',
    sha256: 'a'.repeat(64),
    status: 'ACTIVE_APPROVED',
    aiReconstructionAllowed: false,
  };
}

function registryMock() {
  return {
    assertCanonicalPolicy: vi.fn(async () => undefined),
    getCreativeStandard: vi.fn(async (standardId: string) => {
      if (
        standardId === 'THE_PARTY_HYBRID_NETWORKS_V1' ||
        standardId === 'THE_PARTY_HYBRID_MINIMALIST_V1'
      ) {
        return standard(standardId);
      }
      return undefined;
    }),
    getBrandAsset: vi.fn(async (name: string) => brand(name)),
    getVenueAsset: vi.fn(async () => venue),
    listVenueAssets: vi.fn(async () => [venue]),
    getApprovedGenerativeException: vi.fn(async () => undefined),
    getReferenceSet: vi.fn(async () => []),
  } as unknown as GoogleSheetsCreativeTruthRegistry;
}

describe('resolveThePartyVisualFamily', () => {
  it('maps high-impact and lineup work to Hybrid Networks and preserves explicit environment', () => {
    expect(
      resolveThePartyVisualFamily({ intent: 'LINEUP', environment: 'INTERNATIONAL' }),
    ).toEqual({
      standardId: 'THE_PARTY_HYBRID_NETWORKS_V1',
      family: 'HYBRID_NETWORKS',
      environment: 'INTERNATIONAL',
    });

    expect(
      resolveThePartyVisualFamily({ intent: 'HIGH_IMPACT_CAMPAIGN', environment: 'NATIONAL' }),
    ).toEqual({
      standardId: 'THE_PARTY_HYBRID_NETWORKS_V1',
      family: 'HYBRID_NETWORKS',
      environment: 'NATIONAL',
    });
  });

  it('maps institutional and elegant conversion work to Hybrid Minimalist', () => {
    expect(resolveThePartyVisualFamily({ intent: 'ELEGANT_AD' })).toEqual({
      standardId: 'THE_PARTY_HYBRID_MINIMALIST_V1',
      family: 'HYBRID_MINIMALIST',
    });
    expect(resolveThePartyVisualFamily({ intent: 'PEOPLE_FIRST_CONVERSION' })).toEqual({
      standardId: 'THE_PARTY_HYBRID_MINIMALIST_V1',
      family: 'HYBRID_MINIMALIST',
    });
  });

  it('fails closed rather than guessing an International/National energy for Hybrid Networks', () => {
    expect(() => resolveThePartyVisualFamily({ intent: 'LINEUP' })).toThrow(
      'THE_PARTY_ENVIRONMENT_REQUIRED',
    );
  });
});

describe('CreativeTruthResolver The Party automatic standard selection', () => {
  it('auto-resolves a minimalist standard from intent when standardId is omitted', async () => {
    const resolver = new CreativeTruthResolver(registryMock());

    const result = await resolver.resolve({
      contentItemId: 'CONTENT-TP-AUTO-MIN',
      operation: 'THE_PARTY',
      thePartyIntent: 'INSTITUTIONAL_COMMUNICATION',
      venueAssetId: venue.venueAssetId,
      requiredBrands: ['THE_PARTY', 'TOCA_DO_MORCEGO'],
    });

    expect(result.standard.standardId).toBe('THE_PARTY_HYBRID_MINIMALIST_V1');
    expect(result.venueAsset?.venueAssetId).toBe('VENUE-TP-0130');
    expect(result.thePartyEnvironment).toBeUndefined();
  });

  it('auto-resolves Hybrid Networks only with an explicit environment and carries it forward', async () => {
    const resolver = new CreativeTruthResolver(registryMock());

    const result = await resolver.resolve({
      contentItemId: 'CONTENT-TP-AUTO-NETWORKS',
      operation: 'THE_PARTY',
      thePartyIntent: 'SOCIAL_PROMOTION',
      thePartyEnvironment: 'NATIONAL',
      venueAssetId: venue.venueAssetId,
      requiredBrands: ['THE_PARTY', 'TOCA_DO_MORCEGO'],
    });

    expect(result.standard.standardId).toBe('THE_PARTY_HYBRID_NETWORKS_V1');
    expect(result.thePartyEnvironment).toBe('NATIONAL');
  });

  it('fails closed when neither a standard nor a The Party intent is supplied', async () => {
    const resolver = new CreativeTruthResolver(registryMock());

    await expect(
      resolver.resolve({
        contentItemId: 'CONTENT-TP-NO-INTENT',
        operation: 'THE_PARTY',
        venueAssetId: venue.venueAssetId,
        requiredBrands: ['THE_PARTY'],
      }),
    ).rejects.toThrow('THE_PARTY_VISUAL_INTENT_REQUIRED');
  });
});
