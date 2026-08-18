import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { BrandAsset, CreativeStandard, VenueAsset } from '../src/contracts/creative-truth.js';
import { CreativeTruthResolver } from '../src/creative/creative-truth-resolver.js';
import {
  resolveThePartyVenueAssetPreferences,
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

const venue0087: VenueAsset = {
  ...venue,
  venueAssetId: 'VENUE-TP-0087',
  sourceAssetId: 'TP-0087',
  sourceDriveFileId: '119XngFf39R1b9JhgDxhketwWRnZE0crm',
  masterAssetId: 'MM-TP-0087-V1',
  masterDriveFileId: '1EFGhtSWfv5G6PGmK5P8ZlJ_FX-9G_6Kn',
  dominantSubject: 'amigos_drink_retrato',
};

const venue0071: VenueAsset = {
  ...venue,
  venueAssetId: 'VENUE-TP-0071',
  sourceAssetId: 'TP-0071',
  sourceDriveFileId: '1VjJHnQTpZrs3gTIZQImYrMK9vdqbg0VW',
  masterAssetId: 'MM-TP-0071-V1',
  masterDriveFileId: '1IOnDnGpRvzzwr4DLQfJbjCroqtYoRUMv',
  locationSignature: 'dj_booth',
  dominantSubject: 'dj_performance',
};

const venue0048: VenueAsset = {
  ...venue,
  venueAssetId: 'VENUE-TP-0048',
  sourceAssetId: 'TP-0048',
  sourceDriveFileId: '1q0zeVdDPzA_odab4cDbi_CY8hRFVFROT',
  masterAssetId: 'MM-TP-0048-V1',
  masterDriveFileId: '1TX_VOw1XmamFzwDmKLnyiw8pOrGWcnkS',
  locationSignature: 'entrada_toca',
  dominantSubject: 'entrada_marca_publico',
};

const venue0113: VenueAsset = {
  ...venue,
  venueAssetId: 'VENUE-TP-0113',
  sourceAssetId: 'TP-0113',
  sourceDriveFileId: '1gpjE0xJk7tAYRkDNZaVup_PpC-UMtDCe',
  masterAssetId: 'MM-TP-0113-V1',
  masterDriveFileId: '1c-oqyVCSx852FgkRPMhEixAu1JV3NjBe',
  dominantSubject: 'publico_luz_vermelha',
};

const venues = [venue, venue0048, venue0087, venue0071, venue0113] as const;

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
    getVenueAsset: vi.fn(async (venueAssetId: string) =>
      venues.find((candidate) => candidate.venueAssetId === venueAssetId),
    ),
    listVenueAssets: vi.fn(async () => [...venues]),
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

describe('resolveThePartyVenueAssetPreferences', () => {
  it('prefers people-first and institutional masters according to minimalist intent', () => {
    expect(resolveThePartyVenueAssetPreferences({ intent: 'PEOPLE_FIRST_CONVERSION' })).toEqual([
      'VENUE-TP-0087',
      'VENUE-TP-0048',
    ]);
    expect(resolveThePartyVenueAssetPreferences({ intent: 'INSTITUTIONAL_COMMUNICATION' })).toEqual([
      'VENUE-TP-0048',
      'VENUE-TP-0087',
    ]);
  });

  it('prefers environment-bound real masters for lineup and crowd-first masters for social', () => {
    expect(
      resolveThePartyVenueAssetPreferences({ intent: 'LINEUP', environment: 'INTERNATIONAL' }),
    ).toEqual(['VENUE-TP-0071', 'VENUE-TP-0130']);
    expect(
      resolveThePartyVenueAssetPreferences({ intent: 'LINEUP', environment: 'NATIONAL' }),
    ).toEqual(['VENUE-TP-0113', 'VENUE-TP-0130']);
    expect(
      resolveThePartyVenueAssetPreferences({ intent: 'SOCIAL_PROMOTION', environment: 'NATIONAL' }),
    ).toEqual(['VENUE-TP-0130', 'VENUE-TP-0113']);
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

  it('selects an intent-appropriate real golden master instead of the first registry row', async () => {
    const resolver = new CreativeTruthResolver(registryMock());

    const institutional = await resolver.resolve({
      contentItemId: 'CONTENT-TP-AUTO-VENUE-INSTITUTIONAL',
      operation: 'THE_PARTY',
      thePartyIntent: 'INSTITUTIONAL_COMMUNICATION',
      requiredBrands: ['THE_PARTY'],
    });
    expect(institutional.venueAsset?.venueAssetId).toBe('VENUE-TP-0048');

    const peopleFirst = await resolver.resolve({
      contentItemId: 'CONTENT-TP-AUTO-VENUE-PEOPLE',
      operation: 'THE_PARTY',
      thePartyIntent: 'PEOPLE_FIRST_CONVERSION',
      requiredBrands: ['THE_PARTY'],
    });
    expect(peopleFirst.venueAsset?.venueAssetId).toBe('VENUE-TP-0087');

    const internationalLineup = await resolver.resolve({
      contentItemId: 'CONTENT-TP-AUTO-VENUE-LINEUP',
      operation: 'THE_PARTY',
      thePartyIntent: 'LINEUP',
      thePartyEnvironment: 'INTERNATIONAL',
      requiredBrands: ['THE_PARTY'],
    });
    expect(internationalLineup.venueAsset?.venueAssetId).toBe('VENUE-TP-0071');

    const nationalLineup = await resolver.resolve({
      contentItemId: 'CONTENT-TP-AUTO-VENUE-LINEUP-NATIONAL',
      operation: 'THE_PARTY',
      thePartyIntent: 'LINEUP',
      thePartyEnvironment: 'NATIONAL',
      requiredBrands: ['THE_PARTY'],
    });
    expect(nationalLineup.venueAsset?.venueAssetId).toBe('VENUE-TP-0113');
  });

  it('fails closed when explicit standard conflicts with the approved intent family', async () => {
    const resolver = new CreativeTruthResolver(registryMock());

    await expect(
      resolver.resolve({
        contentItemId: 'CONTENT-TP-MISMATCH',
        standardId: 'THE_PARTY_HYBRID_NETWORKS_V1',
        operation: 'THE_PARTY',
        thePartyIntent: 'INSTITUTIONAL_COMMUNICATION',
        thePartyEnvironment: 'NATIONAL',
        venueAssetId: venue.venueAssetId,
        requiredBrands: ['THE_PARTY'],
      }),
    ).rejects.toThrow('THE_PARTY_STANDARD_INTENT_MISMATCH');
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

  it('requires intent for automatic venue selection even when the visual standard is explicit', async () => {
    const resolver = new CreativeTruthResolver(registryMock());

    await expect(
      resolver.resolve({
        contentItemId: 'CONTENT-TP-NO-VENUE-INTENT',
        standardId: 'THE_PARTY_HYBRID_MINIMALIST_V1',
        operation: 'THE_PARTY',
        requiredBrands: ['THE_PARTY'],
      }),
    ).rejects.toThrow('THE_PARTY_VISUAL_INTENT_REQUIRED');
  });
});
