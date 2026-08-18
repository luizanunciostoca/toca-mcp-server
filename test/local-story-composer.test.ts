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
import {
  SUNSET_STORY_REQUIRED_BRAND_ASSET_IDS,
  SUNSET_STORY_REQUIRED_BRANDS,
  type SunsetStoryTemplateClass,
} from '../src/providers/local/local-sunset-story-renderer.js';

const masterBytes = Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]);
const masterSha256 = createHash('sha256').update(masterBytes).digest('hex');
const enhancedBytes = Buffer.from([0xff, 0xd8, 0x02, 0xff, 0xd9]);
const enhancedSha256 = createHash('sha256').update(enhancedBytes).digest('hex');

const standard: CreativeStandard = {
  standardId: 'SUNSET_STORY_V1',
  version: '1.2',
  brandScope: 'TOCA_DO_MORCEGO',
  operation: 'SUNSET',
  channel: 'INSTAGRAM',
  format: 'STORIES',
  parentPolicyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
  canonicalDriveId: '1gTFxCLWnsZIy2vRKHGglXILMAexXoIUzd5WDZvpOtsM',
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

function makeBrand(
  brandAssetId: string,
  brand: string,
  driveFileId: string,
  byte: number,
): { asset: BrandAsset; bytes: Uint8Array } {
  const bytes = Uint8Array.from([byte, byte + 1, byte + 2]);
  return {
    asset: {
      brandAssetId,
      brand,
      variant: 'WHITE',
      driveFileId,
      fileName: `${brand.toLowerCase()}.png`,
      contentType: 'image/png',
      integrityMode: 'SHA256_PINNED',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      status: 'ACTIVE_APPROVED',
      aiReconstructionAllowed: false,
    },
    bytes,
  };
}

const brands = [
  makeBrand('BRAND-TOCA-WHITE-V1', 'TOCA_DO_MORCEGO', 'drive-toca-logo', 10),
  makeBrand('BRAND-CORONA-WHITE-V1', 'CORONA', 'drive-corona-logo', 20),
  makeBrand('BRAND-REDBULL-WHITE-V1', 'RED_BULL', 'drive-redbull-logo', 30),
  makeBrand('BRAND-MORRO-WHITE-V1', 'MORRO_DIGITAL', 'drive-morro-logo', 40),
] as const;

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

const fidelityEvidence: FidelityEvidence = {
  verifier: 'POST_EDIT_VENUE_FIDELITY_V1',
  verificationMethod: 'MULTIMODAL_REVIEW',
  candidateSha256: enhancedSha256,
  sourceSha256: masterSha256,
  sourceIdentityPreserved: true,
  architectureDriftDetected: false,
  sceneInventionDetected: false,
  logoReconstructionDetected: false,
  referenceAssetIds: [],
  notes: [],
};

function brandInputs() {
  return brands.map(({ asset, bytes }) => ({
    registry: asset,
    bytes,
    contentType: 'image/png' as const,
    driveFileId: asset.driveFileId,
  }));
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
    requiredBrands: [...SUNSET_STORY_REQUIRED_BRANDS],
    brandAssets: brandInputs(),
  };
}

function successfulRunner() {
  return vi.fn(async (_command: string, args: readonly string[]) => {
    const outputPath = args.at(-1);
    if (!outputPath) throw new Error('output path missing');
    await writeFile(outputPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  });
}

describe('LocalStoryComposer — SUNSET_STORY_V1 dedicated renderer', () => {
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

  it('routes SUNSET_STORY_V1 to the dedicated fixed-grid renderer with four official brands', async () => {
    const runner = successfulRunner();
    const composer = new LocalStoryComposer(runner, 'convert');

    const result = await composer.compose({
      ...realBase(),
      templateId: 'EVENT_CTA',
      sunsetTemplateClass: 'SUNSET_VIEW_SCENERY',
      message: 'Pôr do Sol\nna Toca',
      supportCopy: 'Hoje o fim de tarde te espera na melhor vista da ilha.',
      cta: 'Garanta seu ingresso',
      functionalInfo: '16:30H ÀS 22H',
    });

    const [, args] = runner.mock.calls[0] ?? [];
    const joined = args?.join(' ') ?? '';
    expect(args).toEqual(
      expect.arrayContaining([
        '-resize',
        '1080x1920^',
        '-extent',
        '1080x1920',
        'caption:Pôr do Sol\nna Toca',
        'caption:Hoje o fim de tarde te espera na melhor vista da ilha.',
        '16:30H ÀS 22H',
        'Garanta seu ingresso',
        '-quality',
        '95',
      ]),
    );
    expect(joined).toContain('rectangle 0,1600 1080,1920');
    expect(joined).toContain('+45+1700');
    expect(joined).toContain('+270+1700');
    expect(joined).toContain('+495+1700');
    expect(joined).toContain('+720+1700');
    for (let i = 0; i < 4; i += 1) expect(joined).toContain(`brand-${i}`);

    expect(result).toMatchObject({
      dimensions: '1080x1920',
      aspectRatio: '9:16',
      templateId: 'EVENT_CTA',
      sourceImageBound: true,
      editorProvider: 'LOCAL_IMAGEMAGICK',
      storyReady: true,
      outputContentType: 'image/jpeg',
      masterSha256,
    });
    expect(result.manifest.standardId).toBe('SUNSET_STORY_V1');
    expect(result.manifest.brandAssetIds).toEqual([...SUNSET_STORY_REQUIRED_BRAND_ASSET_IDS]);
    expect(result.manifest.gates.every((gate) => gate.status === 'PASSED')).toBe(true);
    const quality = result.manifest.gates.find((gate) => gate.gate === 'QUALITY');
    expect(quality?.evidence).toMatchObject({
      dedicatedRenderer: 'SUNSET_STORY_V1',
      standardVersion: '1.2',
      templateClass: 'SUNSET_VIEW_SCENERY',
    });
  });

  it('fails closed when any mandatory Sunset sponsor asset is absent', async () => {
    const runner = successfulRunner();
    const composer = new LocalStoryComposer(runner, 'convert');

    await expect(
      composer.compose({
        ...realBase(),
        brandAssets: brandInputs().filter((entry) => entry.registry.brand !== 'RED_BULL'),
        templateId: 'EDITORIAL_TEXT',
        message: 'Hoje tem um pôr do sol inesquecível',
      }),
    ).rejects.toThrow('FAILED_BRAND_ASSET_MISSING');
    expect(runner).not.toHaveBeenCalled();
  });

  it('fails closed when the caller omits a mandatory brand from requiredBrands', async () => {
    const runner = successfulRunner();
    const composer = new LocalStoryComposer(runner, 'convert');

    await expect(
      composer.compose({
        ...realBase(),
        requiredBrands: ['TOCA_DO_MORCEGO', 'CORONA', 'MORRO_DIGITAL'],
        templateId: 'EDITORIAL_TEXT',
        message: 'Hoje tem um pôr do sol inesquecível',
      }),
    ).rejects.toThrow('FAILED_BRAND_ASSET_MISSING');
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects stale Sunset Story standard versions instead of silently rendering them', async () => {
    const runner = successfulRunner();
    const composer = new LocalStoryComposer(runner, 'convert');

    await expect(
      composer.compose({
        ...realBase(),
        standard: { ...standard, version: '1.1' },
        templateId: 'EDITORIAL_TEXT',
        message: 'Hoje tem um pôr do sol inesquecível',
      }),
    ).rejects.toThrow('FAILED_STANDARD_NOT_RESOLVED');
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects unknown Sunset template classes before invoking the renderer', async () => {
    const runner = successfulRunner();
    const composer = new LocalStoryComposer(runner, 'convert');

    await expect(
      composer.compose({
        ...realBase(),
        templateId: 'EDITORIAL_TEXT',
        sunsetTemplateClass: 'SUNSET_UNKNOWN_TEMPLATE' as unknown as SunsetStoryTemplateClass,
        message: 'Hoje tem um pôr do sol inesquecível',
      }),
    ).rejects.toThrow('FAILED_STANDARD_NOT_RESOLVED');
    expect(runner).not.toHaveBeenCalled();
  });

  it('keeps the original master SHA and enhancement provenance in REAL_PLUS_ENHANCEMENT', async () => {
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
      sunsetTemplateClass: 'SUNSET_HERO_LIFESTYLE',
      message: 'O mesmo lugar real, com tratamento fiel.',
    });

    expect(result.masterSha256).toBe(masterSha256);
    expect(result.masterSha256).not.toBe(enhancedSha256);
    expect(result.manifest.creativeMode).toBe('REAL_PLUS_ENHANCEMENT');
    expect(result.manifest.masterAssetIds).toEqual(['MM-SUN-STORY-V1']);
    expect(result.manifest.enhancementProvenance).toEqual(enhancementProvenance);
    expect(result.manifest.gates.every((gate) => gate.status === 'PASSED')).toBe(true);
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
