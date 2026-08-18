import { describe, expect, it } from 'vitest';
import { creativeEnhancementProvenanceSchema } from '../src/contracts/creative-truth.js';

const valid = {
  editorProvider: 'OPENAI_IMAGE_EDIT',
  sourceAssetId: 'MM-SUN-0244-V1',
  sourceDriveFileId: 'master-drive',
  sourceSha256: 'a'.repeat(64),
  outputSha256: 'b'.repeat(64),
  sourceImageBound: true,
  creativeTruthBound: true,
  requiresVenueFidelityGate: true,
} as const;

describe('Creative enhancement provenance contract', () => {
  it('accepts a provenance record that binds an enhancement to one exact real master and output', () => {
    expect(creativeEnhancementProvenanceSchema.parse(valid)).toEqual(valid);
  });

  it('rejects an enhancement that is not Creative Truth bound', () => {
    expect(() =>
      creativeEnhancementProvenanceSchema.parse({ ...valid, creativeTruthBound: false }),
    ).toThrow();
  });

  it('rejects an enhancement that tries to bypass the post-edit Venue Fidelity gate', () => {
    expect(() =>
      creativeEnhancementProvenanceSchema.parse({ ...valid, requiresVenueFidelityGate: false }),
    ).toThrow();
  });

  it('rejects malformed source or output digests', () => {
    expect(() =>
      creativeEnhancementProvenanceSchema.parse({ ...valid, sourceSha256: 'not-a-sha' }),
    ).toThrow();
    expect(() =>
      creativeEnhancementProvenanceSchema.parse({ ...valid, outputSha256: 'not-a-sha' }),
    ).toThrow();
  });
});
