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
import { LocalStoryComposer } from '../src/providers/local/local-story-composer.js';

const masterBytes = Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]);
const masterSha256 = createHash('sha256').update(masterBytes).digest('hex');
const enhancedBytes = Buffer.from([0xff, 0xd8, 0x02, 0xff, 0xd9]);
const enhancedSha256 = createHash('sha256').update(enhancedBytes).digest('hex');

const standard: CreativeStandard = {
  standardId: 'SUNSET_STORY_V1',
  version: '1.1',
  brandScope: 'TOCA_DO_MORCEGO',
  operation: 'SUNSET',
  channel: 'INSTAGRAM',
  format: 'STORIES',
  parentPolicyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
  canonicalDriveId: 'drive-story-standard',
  repoMirrorPath: 'control/creative-standards/sunset-story-standard.v1.json',
  status: 'ACTIVE_CANONICAL',
  realAssetRequired: true,
  deterministicBrandInsertion: true,
  venueFidelityGateRequired: true,
};

const venue: VenueAsset = {
  venueAssetId: 'VENUE-SUN-STORY',
  sourceAssetId: 'SUN-STORY-SOURCE',
  sourceDriveFileId: 'drive-source',
  masterAssetId: 'MM-SUN-STORY-V1',
  masterDriveFileId: 'drive-master',
  sourceSha256: 'a'.repeat(64),
  masterSha256,
  operation: 'SUNSET',
  locationSignature: 'deck_ocean_view',
  dominantSubject: 'experience',
  venueVerified: true,
  marketingReady: true,
  generativeReferenceAllowed: true,
  protectedElements: ['DECK', 'HORIZONTE'],
  status: 'ACTIVE_APPROVED',
};

const toca: BrandAsset = {
  brandAssetId: 'BRAND-TOCA-WHITE-V1',
  brand: 'TOCA_DO_MORCEGO',
  variant: 'WHITE',
  driveFileId: 'drive-toca-logo',
  fileName: 'toca.png',
  contentType: 'image/png',
  integrityMode: 'DRIVE_FILE_ID_PINNED',
  status: 'ACTIVE_APPROVED',
  aiReconstructionAllowed: false,
};

const enhancementProvenance: CreativeEnhancementProvenance = {
  editorProvider: 'OPENAI_IMAGE_EDIT',
  sourceAssetId: venue.masterAssetId!,
  sourceDriveFileId: venue.masterDriveFileId!,
  sourceSha256: masterSha256,
  outputSha256: enhancedSha256,
  sourceImageBound: true,
  creativeTruthBound: true,
  requiresVenueFidelityGate: true,
};

const fidelityEvidence: FidelityEvidence = {
  verifier: 'POST_EDIT_VENUE_FIDELITY_V1',
  sourceIdentityPreserved: true,
  architectureDriftDetected: false,
  sceneInventionDetected: false,
  logoReconstructionDetected: false,
  referenceAssetIds: [],
  notes: [],
};

function brandInput() {
  return {
    registry: toca,
    bytes: Uint8Array.from([10, 11, 12]),
    contentType: 'image/png' as const,
    driveFileId: toca.driveFileId,
  };
}

function realBase() {
  return {
    storyCreativeId: 'SC-TEST-V1',
    contentItemId: 'MKT-TEST-STORY',
    masterAssetId: venue.masterAssetId!,
    masterDriveFileId: venue.masterDriveFileId!,
    imageBytes: masterBytes,
    contentType: 'image/jpeg' as const,
    standard,
    creativeMode: 'REAL_COMPOSITE' as const,
    venueAsset: venue,
    requiredBrands: ['TOCA_DO_MORCEGO'],
    brandAssets: [brandInput()],
  };
}

function successfulRunner() {
  return vi.fn(async (_command: string, args: readonly string[]) => {
    const outputPath = args.at(-1);
    if (!outputPath) throw new Error('output path missing');
    await writeFile(outputPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  });
}

describe('LocalStoryComposer', () => {
  it('fails closed when master bytes are missing', async () => {
    const composer = new LocalStoryComposer(() => Promise.resolve());

    await expect(
      composer.compose({
        ...realBase(),
        imageBytes: new Uint8Array(),
        templateId: 'PHOTO_ONLY',
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_IMAGE_BINDING_FAILURE' });
  });

  it('creates a 1080x1920 Story from the verified master and official logo asset', async () => {
    const runner = successfulRunner();
    const composer = new LocalStoryComposer(runner, 'convert');

    const result = await composer.compose({
      ...realBase(),
      templateId: 'PHOTO_ONLY',
    });

    const [, args] = runner.mock.calls[0] ?? [];
    expect(args).toEqual(
      expect.arrayContaining(['-resize', '1080x1920^', '-extent', '1080x1920', '-quality', '95']),
    );
    expect(args?.some((arg) => arg.includes('brand-0'))).toBe(true);
    expect(args?.some((arg) => arg.startsWith('caption:'))).toBe(false);
    expect(args?.join(' ')).not.toContain('TOCA DO MORCEGO');
    expect(result).toMatchObject({
      dimensions: '1080x1920',
      aspectRatio: '9:16',
      templateId: 'PHOTO_ONLY',
      sourceImageBound: true,
      editorProvider: 'LOCAL_IMAGEMAGICK',
      pipelineVersion: 'local-story-composer-v1',
      storyReady: true,
      outputContentType: 'image/jpeg',
      masterSha256,
    });
    expect(result.manifest.standardId).toBe('SUNSET_STORY_V1');
    expect(result.manifest.brandAssetIds).toEqual(['BRAND-TOCA-WHITE-V1']);
    expect(result.manifest.gates.every((gate) => gate.status === 'PASSED')).toBe(true);
  });

  it('keeps the original master SHA as Story lineage when the rendered source is a verified enhancement', async () => {
    const runner = successfulRunner();
    const composer = new LocalStoryComposer(runner, 'convert');

    const result = await composer.compose({
      ...realBase(),
      storyCreativeId: 'SC-TEST-ENHANCED-V1',
      contentItemId: 'MKT-TEST-STORY-ENHANCED',
      imageBytes: enhancedBytes,
      creativeMode: 'REAL_PLUS_ENHANCEMENT',
      enhancementProvenance,
      fidelityEvidence,
      templateId: 'EDITORIAL_TEXT',
      message: 'O mesmo lugar real, com tratamento fiel.',
    });

    expect(result.masterSha256).toBe(masterSha256);
    expect(result.masterSha256).not.toBe(enhancedSha256);
    expect(result.manifest.creativeMode).toBe('REAL_PLUS_ENHANCEMENT');
    expect(result.manifest.masterAssetIds).toEqual(['MM-SUN-STORY-V1']);
    expect(result.manifest.gates.every((gate) => gate.status === 'PASSED')).toBe(true);
  });

  it('renders message and CTA deterministically while brand identity comes only from official files', async () => {
    const runner = successfulRunner();
    const composer = new LocalStoryComposer(runner, 'convert');

    await composer.compose({
      ...realBase(),
      storyCreativeId: 'SC-TEST-TEXT-V1',
      contentItemId: 'MKT-TEST-STORY-TEXT',
      templateId: 'EDITORIAL_TEXT',
      message: 'A atmosfera da Toca começa antes do pôr do sol.',
      cta: 'Venha viver esse momento.',
    });

    const [, args] = runner.mock.calls[0] ?? [];
    expect(args).toEqual(
      expect.arrayContaining([
        'caption:A atmosfera da Toca começa antes do pôr do sol.',
        '-annotate',
        'Venha viver esse momento.',
      ]),
    );
    expect(args?.some((arg) => arg.includes('brand-0'))).toBe(true);
    expect(args?.join(' ')).not.toContain('TOCA DO MORCEGO');
  });

  it('rejects a Story whose declared master does not match the verified venue master', async () => {
    const runner = vi.fn();
    const composer = new LocalStoryComposer(runner);

    await expect(
      composer.compose({
        ...realBase(),
        masterDriveFileId: 'substituted-master',
        templateId: 'PHOTO_ONLY',
      }),
    ).rejects.toThrow('LOCAL_STORY_COMPOSER_MASTER_BINDING_MISMATCH');
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects graphic templates without a message and overlong copy', async () => {
    const composer = new LocalStoryComposer(() => Promise.resolve());

    await expect(
      composer.compose({ ...realBase(), templateId: 'EDITORIAL_TEXT' }),
    ).rejects.toMatchObject({ code: 'QUALITY_GATE_FAILED' });

    await expect(
      composer.compose({
        ...realBase(),
        templateId: 'EDITORIAL_TEXT',
        message: 'x'.repeat(91),
      }),
    ).rejects.toMatchObject({ code: 'QUALITY_GATE_FAILED' });
  });
});
