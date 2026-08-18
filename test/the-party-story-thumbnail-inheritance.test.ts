import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { BrandAsset, CreativeStandard, VenueAsset } from '../src/contracts/creative-truth.js';
import { LocalStoryComposer } from '../src/providers/local/local-story-composer.js';
import { LocalThumbnailComposer } from '../src/providers/local/local-thumbnail-composer.js';

const imageBytes = Uint8Array.from([0xff, 0xd8, 0x01, 0xff, 0xd9]);
const imageSha256 = createHash('sha256').update(imageBytes).digest('hex');
const logoBytes = Uint8Array.from([8, 6, 7, 5, 3, 0, 9]);
const logoSha256 = createHash('sha256').update(logoBytes).digest('hex');

const venue: VenueAsset = {
  venueAssetId: 'VENUE-TP-0130',
  sourceAssetId: 'TP-0130',
  sourceDriveFileId: '1wRkNvKPwA9c8y39yQgD7-ioswR-ewGbQ',
  masterAssetId: 'MM-TP-0130-V1',
  masterDriveFileId: '1o0Y7K3e5VbPeCPzI35tq4St9w7J3Avnk',
  sourceSha256: imageSha256,
  masterSha256: imageSha256,
  operation: 'THE_PARTY',
  locationSignature: 'party_pista',
  dominantSubject: 'publico_pico_da_noite',
  venueVerified: true,
  marketingReady: true,
  generativeReferenceAllowed: false,
  protectedElements: ['PISTA', 'TETO', 'COLUNAS', 'DJ_BOOTH'],
  status: 'ACTIVE_APPROVED',
};

const thePartyBrand: BrandAsset = {
  brandAssetId: 'BRAND-THE-PARTY-WHITE-V1',
  brand: 'THE_PARTY',
  variant: 'WHITE',
  driveFileId: '1V09F8w1BcgwzONnZk1ROpOJACuDF2dPF',
  fileName: 'THE_PARTY_LOGO_OFICIAL.png',
  contentType: 'image/png',
  integrityMode: 'SHA256_PINNED',
  sha256: logoSha256,
  status: 'ACTIVE_APPROVED',
  aiReconstructionAllowed: false,
};

const networksStandard: CreativeStandard = {
  standardId: 'THE_PARTY_HYBRID_NETWORKS_V1',
  version: '1.0',
  brandScope: 'TOCA_DO_MORCEGO',
  operation: 'THE_PARTY',
  channel: 'ALL',
  format: 'ALL',
  parentPolicyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
  canonicalDriveId: '1QQRReW6dLwAh0BrJUiVpbXHGsbV-5ze81MOYkSx7WIU',
  repoMirrorPath: 'control/creative-standards/the-party-hybrid-networks-standard.v1.json',
  status: 'ACTIVE_CANONICAL',
  realAssetRequired: true,
  deterministicBrandInsertion: true,
  venueFidelityGateRequired: true,
};

const minimalistStandard: CreativeStandard = {
  ...networksStandard,
  standardId: 'THE_PARTY_HYBRID_MINIMALIST_V1',
  repoMirrorPath: 'control/creative-standards/the-party-hybrid-minimalist-standard.v1.json',
};

const thumbnailStandard: CreativeStandard = {
  standardId: 'TOCA_THUMBNAIL_V1',
  version: '1.0',
  brandScope: 'TOCA_DO_MORCEGO',
  operation: 'ALL',
  channel: 'ALL',
  format: 'THUMBNAIL',
  parentPolicyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
  canonicalDriveId: 'drive-thumbnail-standard',
  repoMirrorPath: 'control/creative-standards/toca-thumbnail-standard.v1.json',
  status: 'ACTIVE_CANONICAL',
  realAssetRequired: true,
  deterministicBrandInsertion: true,
  venueFidelityGateRequired: true,
};

function brandInput() {
  return {
    registry: thePartyBrand,
    bytes: logoBytes,
    contentType: 'image/png' as const,
    driveFileId: thePartyBrand.driveFileId,
  };
}

function runner() {
  return vi.fn(async (_command: string, args: readonly string[]) => {
    const outputPath = args.at(-1);
    if (!outputPath) throw new Error('missing output path');
    await writeFile(outputPath, Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
  });
}

function qualityEvidence(result: {
  manifest: { gates: readonly { gate: string; evidence: Record<string, unknown> }[] };
}) {
  return result.manifest.gates.find((gate) => gate.gate === 'QUALITY')?.evidence;
}

describe('The Party Story visual-family inheritance', () => {
  it('accepts the canonical ALL-format The Party visual standard for Story and preserves environment', async () => {
    const commandRunner = runner();
    const composer = new LocalStoryComposer(commandRunner, 'convert');

    const result = await composer.compose({
      storyCreativeId: 'TP-STORY-001',
      contentItemId: 'CONTENT-TP-STORY-001',
      masterAssetId: venue.masterAssetId!,
      masterDriveFileId: venue.masterDriveFileId!,
      imageBytes,
      contentType: 'image/jpeg',
      templateId: 'EVENT_CTA',
      message: 'A noite começa aqui.',
      cta: 'Viva The Party.',
      standard: networksStandard,
      creativeMode: 'REAL_COMPOSITE',
      venueAsset: venue,
      partyEnvironment: 'INTERNATIONAL',
      requiredBrands: ['THE_PARTY'],
      brandAssets: [brandInput()],
    });

    expect(result.manifest.standardId).toBe('THE_PARTY_HYBRID_NETWORKS_V1');
    expect(qualityEvidence(result)).toMatchObject({
      visualStandardApplied: 'THE_PARTY_HYBRID_NETWORKS_V1',
      thePartyEnvironment: 'INTERNATIONAL',
    });
    expect(commandRunner).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a Networks Story drops the approved environment before render', async () => {
    const commandRunner = vi.fn();
    const composer = new LocalStoryComposer(commandRunner);

    await expect(
      composer.compose({
        storyCreativeId: 'TP-STORY-NO-ENV',
        contentItemId: 'CONTENT-TP-STORY-NO-ENV',
        masterAssetId: venue.masterAssetId!,
        masterDriveFileId: venue.masterDriveFileId!,
        imageBytes,
        contentType: 'image/jpeg',
        templateId: 'PHOTO_ONLY',
        standard: networksStandard,
        creativeMode: 'REAL_COMPOSITE',
        venueAsset: venue,
        requiredBrands: ['THE_PARTY'],
        brandAssets: [brandInput()],
      }),
    ).rejects.toThrow('THE_PARTY_ENVIRONMENT_REQUIRED');
    expect(commandRunner).not.toHaveBeenCalled();
  });
});

describe('The Party thumbnail visual-family inheritance', () => {
  it('keeps TOCA_THUMBNAIL_V1 as the transversal final contract while rendering the selected The Party family', async () => {
    const commandRunner = runner();
    const composer = new LocalThumbnailComposer(commandRunner, 'convert');

    const result = await composer.compose({
      thumbnailCreativeId: 'TP-THUMB-001',
      contentItemId: 'CONTENT-TP-THUMB-001',
      standard: thumbnailStandard,
      visualStandard: minimalistStandard,
      creativeMode: 'REAL_COMPOSITE',
      venueAsset: venue,
      imageBytes,
      contentType: 'image/jpeg',
      canvas: '1080x1920',
      headline: 'The Party',
      requiredBrands: ['THE_PARTY'],
      brandAssets: [brandInput()],
    });

    expect(result.manifest.standardId).toBe('TOCA_THUMBNAIL_V1');
    expect(qualityEvidence(result)).toMatchObject({
      visualStandardApplied: 'THE_PARTY_HYBRID_MINIMALIST_V1',
      thePartyEnvironment: 'MINIMALIST_NEUTRAL',
    });
    expect(commandRunner).toHaveBeenCalledTimes(1);
  });

  it('fails closed instead of rendering a generic thumbnail when The Party family context is missing', async () => {
    const commandRunner = vi.fn();
    const composer = new LocalThumbnailComposer(commandRunner);

    await expect(
      composer.compose({
        thumbnailCreativeId: 'TP-THUMB-NO-VISUAL',
        contentItemId: 'CONTENT-TP-THUMB-NO-VISUAL',
        standard: thumbnailStandard,
        creativeMode: 'REAL_COMPOSITE',
        venueAsset: venue,
        imageBytes,
        contentType: 'image/jpeg',
        canvas: '1080x1920',
        requiredBrands: ['THE_PARTY'],
        brandAssets: [brandInput()],
      }),
    ).rejects.toThrow('THE_PARTY_THUMBNAIL_VISUAL_STANDARD_REQUIRED');
    expect(commandRunner).not.toHaveBeenCalled();
  });

  it('fails closed when a Networks thumbnail loses the approved environment', async () => {
    const commandRunner = vi.fn();
    const composer = new LocalThumbnailComposer(commandRunner);

    await expect(
      composer.compose({
        thumbnailCreativeId: 'TP-THUMB-NO-ENV',
        contentItemId: 'CONTENT-TP-THUMB-NO-ENV',
        standard: thumbnailStandard,
        visualStandard: networksStandard,
        creativeMode: 'REAL_COMPOSITE',
        venueAsset: venue,
        imageBytes,
        contentType: 'image/jpeg',
        canvas: '1080x1920',
        requiredBrands: ['THE_PARTY'],
        brandAssets: [brandInput()],
      }),
    ).rejects.toThrow('THE_PARTY_ENVIRONMENT_REQUIRED');
    expect(commandRunner).not.toHaveBeenCalled();
  });

  it('cannot omit the official hero brand when the venue and visual standard are The Party', async () => {
    const commandRunner = vi.fn();
    const composer = new LocalThumbnailComposer(commandRunner);

    await expect(
      composer.compose({
        thumbnailCreativeId: 'TP-THUMB-NO-HERO-BRAND',
        contentItemId: 'CONTENT-TP-THUMB-NO-HERO-BRAND',
        standard: thumbnailStandard,
        visualStandard: minimalistStandard,
        creativeMode: 'REAL_COMPOSITE',
        venueAsset: venue,
        imageBytes,
        contentType: 'image/jpeg',
        canvas: '1080x1920',
        requiredBrands: [],
        brandAssets: [],
      }),
    ).rejects.toThrow('FAILED_BRAND_ASSET_MISSING');
    expect(commandRunner).not.toHaveBeenCalled();
  });
});
