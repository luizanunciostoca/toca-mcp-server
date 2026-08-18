import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type {
  BrandAsset,
  CreativeEnhancementProvenance,
  CreativeStandard,
  FidelityEvidence,
  VenueAsset,
} from '../src/contracts/creative-truth.js';
import { LocalCreativeComposer } from '../src/providers/local/local-creative-composer.js';

const standard: CreativeStandard = {
  standardId: 'SUNSET_FEED_V1',
  version: '1.0',
  brandScope: 'TOCA_DO_MORCEGO',
  operation: 'SUNSET',
  channel: 'INSTAGRAM',
  format: 'SINGLE_IMAGE',
  parentPolicyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
  canonicalDriveId: 'drive-standard',
  repoMirrorPath: 'control/creative-standards/sunset-feed-standard.v1.json',
  status: 'ACTIVE_CANONICAL',
  realAssetRequired: true,
  deterministicBrandInsertion: true,
  venueFidelityGateRequired: true,
};

const masterBytes = Uint8Array.from([1, 2, 3, 4]);
const masterSha256 = createHash('sha256').update(masterBytes).digest('hex');
const enhancedBytes = Uint8Array.from([8, 7, 6, 5]);
const enhancedSha256 = createHash('sha256').update(enhancedBytes).digest('hex');

const venue: VenueAsset = {
  venueAssetId: 'VENUE-SUN-0244',
  sourceAssetId: 'SUN-0244',
  sourceDriveFileId: 'source-drive',
  masterAssetId: 'MM-SUN-0244-V1',
  masterDriveFileId: 'master-drive',
  sourceSha256: 'a'.repeat(64),
  masterSha256,
  operation: 'SUNSET',
  locationSignature: 'ambiente_toca',
  dominantSubject: 'lifestyle',
  venueVerified: true,
  marketingReady: true,
  generativeReferenceAllowed: true,
  protectedElements: ['DECK', 'HORIZONTE'],
  status: 'ACTIVE_APPROVED',
};

const cleanFidelityEvidence: FidelityEvidence = {
  verifier: 'POST_EDIT_VENUE_FIDELITY_V1',
  verificationMethod: 'MULTIMODAL_REVIEW',
  candidateSha256: enhancedSha256,
  sourceSha256: masterSha256,
  sourceIdentityPreserved: true,
  architectureDriftDetected: false,
  sceneInventionDetected: false,
  logoReconstructionDetected: false,
  referenceAssetIds: [],
  notes: ['faithful enhancement only'],
};

const enhancementProvenance: CreativeEnhancementProvenance = {
  policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
  creativeMode: 'REAL_PLUS_ENHANCEMENT',
  editorProvider: 'OPENAI_IMAGE_EDIT',
  sourceAssetId: venue.masterAssetId!,
  sourceDriveFileId: venue.masterDriveFileId!,
  sourceSha256: masterSha256,
  outputSha256: enhancedSha256,
  sourceImageBound: true,
  creativeTruthBound: true,
  requiresVenueFidelityGate: true,
};

function brand(brandAssetId: string, name: string, driveFileId: string): BrandAsset {
  return {
    brandAssetId,
    brand: name,
    variant: 'WHITE',
    driveFileId,
    fileName: `${name}.png`,
    contentType: 'image/png',
    integrityMode: 'DRIVE_FILE_ID_PINNED',
    status: 'ACTIVE_APPROVED',
    aiReconstructionAllowed: false,
  };
}

function successfulRunner() {
  return vi.fn(async (_command: string, args: readonly string[]) => {
    const outputPath = args.at(-1);
    if (!outputPath) throw new Error('missing output path');
    await writeFile(outputPath, Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
  });
}

function tocaBrandInput() {
  const toca = brand('BRAND-TOCA-WHITE-V1', 'TOCA_DO_MORCEGO', 'drive-toca');
  return {
    registry: toca,
    bytes: Uint8Array.from([10, 11, 12]),
    contentType: 'image/png' as const,
    driveFileId: toca.driveFileId,
  };
}

describe('LocalCreativeComposer', () => {
  it('uses real venue lineage and official logo files in the deterministic render', async () => {
    const runner = successfulRunner();
    const composer = new LocalCreativeComposer(runner);
    const toca = brand('BRAND-TOCA-WHITE-V1', 'TOCA_DO_MORCEGO', 'drive-toca');
    const morro = brand('BRAND-MORRO-WHITE-V1', 'MORRO_DIGITAL', 'drive-morro');

    const result = await composer.compose({
      contentItemId: 'CONTENT-001',
      creativeId: 'CREATIVE-001',
      standard,
      creativeMode: 'REAL_COMPOSITE',
      venueAsset: venue,
      sourceImageBytes: masterBytes,
      sourceContentType: 'image/jpeg',
      canvas: '1080x1350',
      headline: 'Pôr do sol na Toca',
      supportCopy: 'Viva o fim de tarde mais desejado da ilha.',
      cta: 'Garanta seu ingresso',
      functionalInfo: '16:30H ÀS 22H',
      requiredBrands: ['TOCA_DO_MORCEGO', 'MORRO_DIGITAL'],
      brandAssets: [
        {
          registry: toca,
          bytes: Uint8Array.from([10, 11, 12]),
          contentType: 'image/png',
          driveFileId: toca.driveFileId,
        },
        {
          registry: morro,
          bytes: Uint8Array.from([20, 21, 22]),
          contentType: 'image/png',
          driveFileId: morro.driveFileId,
        },
      ],
      createdAt: '2026-08-17T22:00:00-03:00',
    });

    expect(result.readyForReview).toBe(true);
    expect(result.manifest.sourceAssetIds).toEqual(['SUN-0244']);
    expect(result.manifest.masterAssetIds).toEqual(['MM-SUN-0244-V1']);
    expect(result.manifest.brandAssetIds).toEqual([
      'BRAND-TOCA-WHITE-V1',
      'BRAND-MORRO-WHITE-V1',
    ]);
    expect(result.manifest.enhancementProvenance).toBeUndefined();
    expect(result.manifest.gates.map((gate) => gate.status)).toEqual([
      'PASSED',
      'PASSED',
      'PASSED',
    ]);
    const commandArgs = runner.mock.calls[0]?.[1] ?? [];
    expect(commandArgs.some((arg) => arg.includes('brand-0'))).toBe(true);
    expect(commandArgs.some((arg) => arg.includes('brand-1'))).toBe(true);
    expect(commandArgs.join(' ')).not.toContain('MORRO DIGITAL LOGO');
  });

  it('accepts a faithful enhanced image only when provenance and fidelity evidence bind it to the exact real master and candidate bytes', async () => {
    const runner = successfulRunner();
    const composer = new LocalCreativeComposer(runner);

    const result = await composer.compose({
      contentItemId: 'CONTENT-ENHANCED',
      creativeId: 'CREATIVE-ENHANCED',
      standard,
      creativeMode: 'REAL_PLUS_ENHANCEMENT',
      venueAsset: venue,
      sourceImageBytes: enhancedBytes,
      sourceContentType: 'image/jpeg',
      enhancementProvenance,
      fidelityEvidence: cleanFidelityEvidence,
      canvas: '1080x1350',
      headline: 'Sunset real, tratamento fiel',
      requiredBrands: ['TOCA_DO_MORCEGO'],
      brandAssets: [tocaBrandInput()],
      createdAt: '2026-08-17T22:05:00-03:00',
    });

    expect(result.readyForReview).toBe(true);
    expect(result.manifest.creativeMode).toBe('REAL_PLUS_ENHANCEMENT');
    expect(result.manifest.sourceAssetIds).toEqual(['SUN-0244']);
    expect(result.manifest.masterAssetIds).toEqual(['MM-SUN-0244-V1']);
    expect(result.manifest.enhancementProvenance).toEqual(enhancementProvenance);
    expect(result.manifest.gates.every((gate) => gate.status === 'PASSED')).toBe(true);
  });

  it('rejects fidelity evidence from another enhanced output before rendering', async () => {
    const runner = vi.fn();
    const composer = new LocalCreativeComposer(runner);

    await expect(
      composer.compose({
        contentItemId: 'CONTENT-ENHANCED-EVIDENCE-SUBSTITUTED',
        creativeId: 'CREATIVE-ENHANCED-EVIDENCE-SUBSTITUTED',
        standard,
        creativeMode: 'REAL_PLUS_ENHANCEMENT',
        venueAsset: venue,
        sourceImageBytes: enhancedBytes,
        sourceContentType: 'image/jpeg',
        enhancementProvenance,
        fidelityEvidence: { ...cleanFidelityEvidence, candidateSha256: 'f'.repeat(64) },
        canvas: '1080x1350',
        requiredBrands: ['TOCA_DO_MORCEGO'],
        brandAssets: [tocaBrandInput()],
      }),
    ).rejects.toThrow('FAILED_FIDELITY_EVIDENCE_BINDING');
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects REAL_PLUS_ENHANCEMENT without exact source/output provenance before rendering', async () => {
    const runner = vi.fn();
    const composer = new LocalCreativeComposer(runner);

    await expect(
      composer.compose({
        contentItemId: 'CONTENT-ENHANCED-NO-PROVENANCE',
        creativeId: 'CREATIVE-ENHANCED-NO-PROVENANCE',
        standard,
        creativeMode: 'REAL_PLUS_ENHANCEMENT',
        venueAsset: venue,
        sourceImageBytes: enhancedBytes,
        sourceContentType: 'image/jpeg',
        fidelityEvidence: cleanFidelityEvidence,
        canvas: '1080x1350',
        requiredBrands: ['TOCA_DO_MORCEGO'],
        brandAssets: [tocaBrandInput()],
      }),
    ).rejects.toThrow('FAILED_ENHANCEMENT_PROVENANCE');
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects enhanced bytes when the provenance output hash does not match the actual image', async () => {
    const runner = vi.fn();
    const composer = new LocalCreativeComposer(runner);

    await expect(
      composer.compose({
        contentItemId: 'CONTENT-ENHANCED-SUBSTITUTED',
        creativeId: 'CREATIVE-ENHANCED-SUBSTITUTED',
        standard,
        creativeMode: 'REAL_PLUS_ENHANCEMENT',
        venueAsset: venue,
        sourceImageBytes: Uint8Array.from([99, 98, 97]),
        sourceContentType: 'image/jpeg',
        enhancementProvenance,
        fidelityEvidence: cleanFidelityEvidence,
        canvas: '1080x1350',
        requiredBrands: ['TOCA_DO_MORCEGO'],
        brandAssets: [tocaBrandInput()],
      }),
    ).rejects.toThrow('FAILED_ENHANCEMENT_PROVENANCE');
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects enhancement provenance from another mode or master', async () => {
    const runner = vi.fn();
    const composer = new LocalCreativeComposer(runner);

    const invalidMode = {
      ...enhancementProvenance,
      creativeMode: 'REAL_COMPOSITE',
    } as unknown as CreativeEnhancementProvenance;
    await expect(
      composer.compose({
        contentItemId: 'CONTENT-ENHANCED-WRONG-MODE',
        creativeId: 'CREATIVE-ENHANCED-WRONG-MODE',
        standard,
        creativeMode: 'REAL_PLUS_ENHANCEMENT',
        venueAsset: venue,
        sourceImageBytes: enhancedBytes,
        sourceContentType: 'image/jpeg',
        enhancementProvenance: invalidMode,
        fidelityEvidence: cleanFidelityEvidence,
        canvas: '1080x1350',
        requiredBrands: ['TOCA_DO_MORCEGO'],
        brandAssets: [tocaBrandInput()],
      }),
    ).rejects.toThrow('FAILED_ENHANCEMENT_PROVENANCE');

    await expect(
      composer.compose({
        contentItemId: 'CONTENT-ENHANCED-WRONG-MASTER',
        creativeId: 'CREATIVE-ENHANCED-WRONG-MASTER',
        standard,
        creativeMode: 'REAL_PLUS_ENHANCEMENT',
        venueAsset: venue,
        sourceImageBytes: enhancedBytes,
        sourceContentType: 'image/jpeg',
        enhancementProvenance: {
          ...enhancementProvenance,
          sourceDriveFileId: 'different-master-drive',
        },
        fidelityEvidence: cleanFidelityEvidence,
        canvas: '1080x1350',
        requiredBrands: ['TOCA_DO_MORCEGO'],
        brandAssets: [tocaBrandInput()],
      }),
    ).rejects.toThrow('FAILED_ENHANCEMENT_PROVENANCE');
    expect(runner).not.toHaveBeenCalled();
  });

  it('fails before rendering when the supplied bytes are not the registered master', async () => {
    const runner = vi.fn();
    const composer = new LocalCreativeComposer(runner);
    const toca = brand('BRAND-TOCA-WHITE-V1', 'TOCA_DO_MORCEGO', 'drive-toca');

    await expect(
      composer.compose({
        contentItemId: 'CONTENT-HASH-MISMATCH',
        creativeId: 'CREATIVE-HASH-MISMATCH',
        standard,
        creativeMode: 'REAL_COMPOSITE',
        venueAsset: venue,
        sourceImageBytes: Uint8Array.from([9, 9, 9]),
        sourceContentType: 'image/jpeg',
        canvas: '1080x1350',
        headline: 'Sunset',
        requiredBrands: ['TOCA_DO_MORCEGO'],
        brandAssets: [
          {
            registry: toca,
            bytes: Uint8Array.from([10, 11, 12]),
            contentType: 'image/png',
            driveFileId: toca.driveFileId,
          },
        ],
      }),
    ).rejects.toThrow('CREATIVE_MASTER_HASH_MISMATCH');
    expect(runner).not.toHaveBeenCalled();
  });

  it('fails before rendering when a logo is AI-generated', async () => {
    const runner = vi.fn();
    const composer = new LocalCreativeComposer(runner);
    const morro = brand('BRAND-MORRO-WHITE-V1', 'MORRO_DIGITAL', 'drive-morro');

    await expect(
      composer.compose({
        contentItemId: 'CONTENT-002',
        creativeId: 'CREATIVE-002',
        standard,
        creativeMode: 'REAL_COMPOSITE',
        venueAsset: venue,
        sourceImageBytes: masterBytes,
        sourceContentType: 'image/jpeg',
        canvas: '1080x1350',
        headline: 'Sunset',
        requiredBrands: ['MORRO_DIGITAL'],
        brandAssets: [
          {
            registry: morro,
            bytes: Uint8Array.from([20, 21, 22]),
            contentType: 'image/png',
            driveFileId: morro.driveFileId,
            aiGenerated: true,
          },
        ],
      }),
    ).rejects.toThrow('FAILED_AI_LOGO_RECONSTRUCTION');
    expect(runner).not.toHaveBeenCalled();
  });
});
