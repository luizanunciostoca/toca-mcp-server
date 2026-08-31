import { describe, expect, it } from 'vitest';
import type { ArtistAsset } from '../src/contracts/artist-integrity.js';
import { evaluateArtistIntegrity, sha256Artist } from '../src/creative/artist-integrity.js';

const bytes = Uint8Array.from([1, 2, 3, 4]);
const asset: ArtistAsset = {
  artistAssetId: 'ARTIST-ILLUSIONIZE-001',
  artist: 'ILLUSIONIZE',
  sourceAssetId: 'PRESSKIT-001',
  sourceDriveFileId: 'drive-artist',
  sourceSha256: sha256Artist(bytes),
  usageScope: ['THE_PARTY'],
  aiModificationAllowed: false,
  physicalModificationAllowed: false,
  conventionalTreatmentAllowed: true,
  cropAllowed: true,
  compositionAllowed: true,
  protectedElements: ['FACE', 'HAIR', 'SKIN', 'BODY', 'HANDS', 'CLOTHING'],
  status: 'ACTIVE_APPROVED',
};

describe('artist integrity', () => {
  it('passes deterministic composition with approved transforms', () => {
    const result = evaluateArtistIntegrity({
      asset,
      sourceBytes: bytes,
      evidence: {
        sourceSha256Observed: sha256Artist(bytes),
        aiOperationUsed: false,
        physicalGeometryChanged: false,
        unapprovedRetouchDetected: false,
        maskIntrusionDetected: false,
        allowedTransformsApplied: ['SCALE', 'POSITION'],
        verifier: 'test',
      },
    });
    expect(result.status).toBe('PASSED');
  });

  it('fails closed when AI touches the artist', () => {
    const result = evaluateArtistIntegrity({
      asset,
      sourceBytes: bytes,
      evidence: {
        sourceSha256Observed: sha256Artist(bytes),
        aiOperationUsed: true,
        physicalGeometryChanged: false,
        unapprovedRetouchDetected: false,
        maskIntrusionDetected: false,
        allowedTransformsApplied: [],
        verifier: 'test',
      },
    });
    expect(result.status).toBe('FAILED');
    expect(result.failureCodes).toContain('FAILED_ARTIST_AI_MODIFICATION');
  });
});
