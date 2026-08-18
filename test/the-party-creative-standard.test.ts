import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type {
  BrandAsset,
  CreativeStandard,
  VenueAsset,
} from '../src/contracts/creative-truth.js';
import { CreativeTruthResolver } from '../src/creative/creative-truth-resolver.js';
import type { GoogleSheetsCreativeTruthRegistry } from '../src/providers/google-sheets/creative-truth-registry.js';
import { LocalCreativeComposer } from '../src/providers/local/local-creative-composer.js';

const masterBytes = Uint8Array.from([4, 3, 2, 1]);
const masterSha256 = createHash('sha256').update(masterBytes).digest('hex');

const venue: VenueAsset = {
  venueAssetId: 'VENUE-PARTY-001',
  sourceAssetId: 'PARTY-001',
  sourceDriveFileId: 'party-source-drive',
  masterAssetId: 'MM-PARTY-001-V1',
  masterDriveFileId: 'party-master-drive',
  sourceSha256: 'a'.repeat(64),
  masterSha256,
  operation: 'THE_PARTY',
  locationSignature: 'toca_party_real',
  dominantSubject: 'people_experience',
  venueVerified: true,
  marketingReady: true,
  generativeReferenceAllowed: true,
  protectedElements: ['ARCHITECTURE', 'LIGHTING', 'STAGE'],
  status: 'ACTIVE_APPROVED',
};

function standard(standardId: string, operation = 'THE_PARTY'): CreativeStandard {
  return {
    standardId,
    version: '1.0',
    brandScope: 'TOCA_DO_MORCEGO',
    operation,
    channel: 'ALL',
    format: 'ALL',
    parentPolicyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
    canonicalDriveId: '1yFY-1NXjWs1bKvRP3smRuRKWT6OR3WK-FkDcoLqAmPk',
    repoMirrorPath: `control/creative-standards/${standardId.toLowerCase()}.json`,
    status: 'ACTIVE_CANONICAL',
    realAssetRequired: true,
    deterministicBrandInsertion: true,
    venueFidelityGateRequired: true,
  };
}

function brandBytes(name: string): Uint8Array {
  return Uint8Array.from(Buffer.from(`official:${name}`, 'utf8'));
}

function brand(name: string, index: number): BrandAsset {
  const bytes = brandBytes(name);
  return {
    brandAssetId: `BRAND-${name}-${index}`,
    brand: name,
    variant: 'WHITE',
    driveFileId: `drive-${name}-${index}`,
    fileName: `${name}.png`,
    contentType: 'image/png',
    integrityMode: 'SHA256_PINNED',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    status: 'ACTIVE_APPROVED',
    aiReconstructionAllowed: false,
  };
}

function registryMock(resolvedStandard: CreativeStandard) {
  const assets = new Map(
    ['THE_PARTY', 'TOCA_DO_MORCEGO', 'CORONA', 'RED_BULL', 'MORRO_DIGITAL'].map(
      (name, index) => [name, brand(name, index)] as const,
    ),
  );
  return {
    assertCanonicalPolicy: vi.fn(async () => undefined),
    getCreativeStandard: vi.fn(async () => resolvedStandard),
    getBrandAsset: vi.fn(async (name: string) => assets.get(name)),
    getVenueAsset: vi.fn(async () => venue),
    listVenueAssets: vi.fn(async () => [venue]),
    getApprovedGenerativeException: vi.fn(async () => undefined),
    getReferenceSet: vi.fn(async () => []),
  } as unknown as GoogleSheetsCreativeTruthRegistry;
}

function successfulRunner() {
  return vi.fn(async (_command: string, args: readonly string[]) => {
    const outputPath = args.at(-1);
    if (!outputPath) throw new Error('missing output path');
    await writeFile(outputPath, Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
  });
}

describe('The Party Creative Truth standard resolution', () => {
  it('rejects a generic ALL standard as the final visual identity for THE_PARTY', async () => {
    const resolver = new CreativeTruthResolver(registryMock(standard('TOCA_VIDEO_V1', 'ALL')));

    await expect(
      resolver.resolve({
        contentItemId: 'CONTENT-PARTY-GENERIC',
        standardId: 'TOCA_VIDEO_V1',
        operation: 'THE_PARTY',
        venueAssetId: venue.venueAssetId,
        requiredBrands: ['THE_PARTY'],
      }),
    ).rejects.toThrow('FAILED_STANDARD_NOT_RESOLVED');
  });

  it('requires the official THE_PARTY hero brand in every The Party creative', async () => {
    const resolver = new CreativeTruthResolver(
      registryMock(standard('THE_PARTY_HYBRID_MINIMALIST_V1')),
    );

    await expect(
      resolver.resolve({
        contentItemId: 'CONTENT-PARTY-NO-HERO',
        standardId: 'THE_PARTY_HYBRID_MINIMALIST_V1',
        operation: 'THE_PARTY',
        venueAssetId: venue.venueAssetId,
        requiredBrands: ['TOCA_DO_MORCEGO'],
      }),
    ).rejects.toThrow('FAILED_BRAND_ASSET_MISSING');
  });

  it('resolves the approved minimalist family with real venue lineage and official brand assets', async () => {
    const resolver = new CreativeTruthResolver(
      registryMock(standard('THE_PARTY_HYBRID_MINIMALIST_V1')),
    );

    const result = await resolver.resolve({
      contentItemId: 'CONTENT-PARTY-MINIMAL',
      standardId: 'THE_PARTY_HYBRID_MINIMALIST_V1',
      operation: 'THE_PARTY',
      venueAssetId: venue.venueAssetId,
      requiredBrands: ['THE_PARTY', 'TOCA_DO_MORCEGO', 'MORRO_DIGITAL'],
    });

    expect(result.standard.standardId).toBe('THE_PARTY_HYBRID_MINIMALIST_V1');
    expect(result.venueAsset?.venueAssetId).toBe('VENUE-PARTY-001');
    expect(result.brandAssets.map((asset) => asset.brand)).toEqual([
      'THE_PARTY',
      'TOCA_DO_MORCEGO',
      'MORRO_DIGITAL',
    ]);
  });
});

describe('The Party deterministic compositor', () => {
  it('requires an explicit international/national energy for Hybrid Networks', async () => {
    const composer = new LocalCreativeComposer(vi.fn());
    const hero = brand('THE_PARTY', 0);

    await expect(
      composer.compose({
        contentItemId: 'CONTENT-PARTY-NETWORKS-NO-ENV',
        creativeId: 'CREATIVE-PARTY-NETWORKS-NO-ENV',
        standard: standard('THE_PARTY_HYBRID_NETWORKS_V1'),
        creativeMode: 'REAL_COMPOSITE',
        venueAsset: venue,
        sourceImageBytes: masterBytes,
        sourceContentType: 'image/jpeg',
        canvas: '1080x1920',
        requiredBrands: ['THE_PARTY'],
        brandAssets: [
          {
            registry: hero,
            bytes: brandBytes('THE_PARTY'),
            contentType: 'image/png',
            driveFileId: hero.driveFileId,
          },
        ],
      }),
    ).rejects.toThrow('THE_PARTY_ENVIRONMENT_REQUIRED');
  });

  it('renders the official hero separately and the institutional footer in canonical order', async () => {
    const runner = successfulRunner();
    const composer = new LocalCreativeComposer(runner);
    const orderedInputNames = ['THE_PARTY', 'MORRO_DIGITAL', 'RED_BULL', 'CORONA', 'TOCA_DO_MORCEGO'];
    const assets = orderedInputNames.map((name, index) => brand(name, index));

    const result = await composer.compose({
      contentItemId: 'CONTENT-PARTY-INTERNATIONAL',
      creativeId: 'CREATIVE-PARTY-INTERNATIONAL',
      standard: standard('THE_PARTY_HYBRID_NETWORKS_V1'),
      creativeMode: 'REAL_COMPOSITE',
      venueAsset: venue,
      sourceImageBytes: masterBytes,
      sourceContentType: 'image/jpeg',
      canvas: '1080x1920',
      headline: 'A noite encontra a ilha',
      supportCopy: 'Pessoas, música e energia real da Toca.',
      cta: 'Garanta seu ingresso',
      functionalInfo: 'SÁBADO',
      partyEnvironment: 'INTERNATIONAL',
      requiredBrands: orderedInputNames,
      brandAssets: assets.map((asset) => ({
        registry: asset,
        bytes: brandBytes(asset.brand),
        contentType: 'image/png' as const,
        driveFileId: asset.driveFileId,
      })),
      createdAt: '2026-08-18T01:00:00-03:00',
    });

    expect(result.readyForReview).toBe(true);
    expect(result.manifest.standardId).toBe('THE_PARTY_HYBRID_NETWORKS_V1');
    const args = runner.mock.calls[0]?.[1] ?? [];
    const joined = args.join(' ');
    expect(joined).toContain('#8F5AB7');
    expect(joined).toContain('brand-0');
    const toca = joined.indexOf('brand-4');
    const corona = joined.indexOf('brand-3');
    const redBull = joined.indexOf('brand-2');
    const morro = joined.indexOf('brand-1');
    expect(toca).toBeGreaterThan(-1);
    expect(toca).toBeLessThan(corona);
    expect(corona).toBeLessThan(redBull);
    expect(redBull).toBeLessThan(morro);
  });
});
