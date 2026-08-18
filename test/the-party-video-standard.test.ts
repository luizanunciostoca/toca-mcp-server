import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { BrandAsset, CreativeStandard, VideoShot } from '../src/contracts/creative-truth.js';
import { LocalVideoComposer } from '../src/providers/local/local-video-composer.js';

const videoBytes = Uint8Array.from([9, 8, 7, 6]);
const videoSha256 = createHash('sha256').update(videoBytes).digest('hex');

const partyStandard: CreativeStandard = {
  standardId: 'THE_PARTY_HYBRID_NETWORKS_V1',
  version: '1.0',
  brandScope: 'TOCA_DO_MORCEGO',
  operation: 'THE_PARTY',
  channel: 'ALL',
  format: 'ALL',
  parentPolicyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
  canonicalDriveId: '1yFY-1NXjWs1bKvRP3smRuRKWT6OR3WK-FkDcoLqAmPk',
  repoMirrorPath: 'control/creative-standards/the-party-hybrid-networks-standard.v1.json',
  status: 'ACTIVE_CANONICAL',
  realAssetRequired: true,
  deterministicBrandInsertion: true,
  venueFidelityGateRequired: true,
};

const shot: VideoShot = {
  shotId: 'SHOT-PARTY-001',
  sourceAssetId: 'PARTY-VIDEO-001',
  sourceDriveFileId: 'party-source-drive',
  masterAssetId: 'MM-PARTY-VIDEO-001-V1',
  masterDriveFileId: 'party-master-drive',
  sourceSha256: 'a'.repeat(64),
  masterSha256: videoSha256,
  operation: 'THE_PARTY',
  locationSignature: 'party_real_venue',
  shotClass: 'crowd',
  durationMs: 5000,
  orientation: '9:16',
  venueVerified: true,
  marketingReady: true,
  rightsStatus: 'OWNED',
  status: 'ACTIVE_APPROVED',
  notes: '',
};

function bytes(name: string): Uint8Array {
  return Uint8Array.from(Buffer.from(`brand:${name}`, 'utf8'));
}

function asset(name: string, index: number): BrandAsset {
  const content = bytes(name);
  return {
    brandAssetId: `BRAND-${name}-${index}`,
    brand: name,
    variant: 'WHITE',
    driveFileId: `drive-${name}-${index}`,
    fileName: `${name}.png`,
    contentType: 'image/png',
    integrityMode: 'SHA256_PINNED',
    sha256: createHash('sha256').update(content).digest('hex'),
    status: 'ACTIVE_APPROVED',
    aiReconstructionAllowed: false,
  };
}

function runner() {
  return vi.fn(async (_command: string, args: readonly string[]) => {
    const outputPath = args.at(-1);
    if (!outputPath) throw new Error('missing output path');
    await writeFile(
      outputPath,
      Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]),
    );
  });
}

describe('The Party video identity', () => {
  it('requires an explicit Hybrid Networks environment', async () => {
    const hero = asset('THE_PARTY', 0);
    const composer = new LocalVideoComposer(vi.fn());

    await expect(
      composer.compose({
        contentItemId: 'CONTENT-PARTY-VIDEO-NO-ENV',
        creativeId: 'CREATIVE-PARTY-VIDEO-NO-ENV',
        standard: partyStandard,
        creativeMode: 'REAL_COMPOSITE',
        shots: [{ shotId: shot.shotId, registry: shot, videoBytes, contentType: 'video/mp4' }],
        requiredBrands: ['THE_PARTY'],
        brandAssets: [
          {
            registry: hero,
            bytes: bytes('THE_PARTY'),
            contentType: 'image/png',
            driveFileId: hero.driveFileId,
          },
        ],
      }),
    ).rejects.toThrow('THE_PARTY_ENVIRONMENT_REQUIRED');
  });

  it('places The Party as hero and institutional brands in canonical footer order', async () => {
    const commandRunner = runner();
    const composer = new LocalVideoComposer(commandRunner);
    const names = ['THE_PARTY', 'MORRO_DIGITAL', 'RED_BULL', 'CORONA', 'TOCA_DO_MORCEGO'];
    const assets = names.map((name, index) => asset(name, index));

    const result = await composer.compose({
      contentItemId: 'CONTENT-PARTY-VIDEO',
      creativeId: 'CREATIVE-PARTY-VIDEO',
      standard: partyStandard,
      creativeMode: 'REAL_COMPOSITE',
      shots: [{ shotId: shot.shotId, registry: shot, videoBytes, contentType: 'video/mp4' }],
      requiredBrands: names,
      brandAssets: assets.map((entry) => ({
        registry: entry,
        bytes: bytes(entry.brand),
        contentType: 'image/png' as const,
        driveFileId: entry.driveFileId,
      })),
      partyEnvironment: 'INTERNATIONAL',
      createdAt: '2026-08-18T01:10:00-03:00',
    });

    expect(result.readyForReview).toBe(true);
    expect(result.manifest.standardId).toBe('THE_PARTY_HYBRID_NETWORKS_V1');
    const args = commandRunner.mock.calls[0]?.[1] ?? [];
    const chain = args[args.indexOf('-filter_complex') + 1] ?? '';
    expect(chain).toContain('0x4C3553@0.82');
    expect(chain).toContain('[1:v]scale=420:-1[partyhero]');
    const toca = chain.indexOf('[5:v]');
    const corona = chain.indexOf('[4:v]');
    const redBull = chain.indexOf('[3:v]');
    const morro = chain.indexOf('[2:v]');
    expect(toca).toBeGreaterThan(-1);
    expect(toca).toBeLessThan(corona);
    expect(corona).toBeLessThan(redBull);
    expect(redBull).toBeLessThan(morro);
  });
});
