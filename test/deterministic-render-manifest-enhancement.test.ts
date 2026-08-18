import { describe, expect, it } from 'vitest';
import { deterministicRenderManifestSchema } from '../src/contracts/creative-truth.js';

const enhancementProvenance = {
  policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
  creativeMode: 'REAL_PLUS_ENHANCEMENT',
  editorProvider: 'OPENAI_IMAGE_EDIT',
  sourceAssetId: 'MM-SUN-0244-V1',
  sourceDriveFileId: 'master-drive',
  sourceSha256: 'a'.repeat(64),
  outputSha256: 'b'.repeat(64),
  sourceImageBound: true,
  creativeTruthBound: true,
  requiresVenueFidelityGate: true,
} as const;

function manifest() {
  return {
    contentItemId: 'CONTENT-ENHANCED',
    creativeId: 'CREATIVE-ENHANCED',
    policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
    standardId: 'SUNSET_FEED_V1',
    creativeMode: 'REAL_PLUS_ENHANCEMENT',
    sourceAssetIds: ['SUN-0244'],
    masterAssetIds: ['MM-SUN-0244-V1'],
    brandAssetIds: ['BRAND-TOCA-WHITE-V1'],
    enhancementProvenance,
    outputSha256: 'c'.repeat(64),
    outputDimensions: '1080x1350',
    exactAssetBinding: true,
    gates: [
      { gate: 'BRAND_INTEGRITY', status: 'PASSED', failureCodes: [], evidence: {} },
      { gate: 'VENUE_FIDELITY', status: 'PASSED', failureCodes: [], evidence: {} },
      { gate: 'QUALITY', status: 'PASSED', failureCodes: [], evidence: {} },
    ],
    createdAt: '2026-08-17T22:00:00-03:00',
  } as const;
}

describe('Deterministic render manifest enhancement lineage', () => {
  it('persists master -> enhancement -> final creative lineage', () => {
    const parsed = deterministicRenderManifestSchema.parse(manifest());
    expect(parsed.enhancementProvenance).toEqual(enhancementProvenance);
    expect(parsed.masterAssetIds).toEqual(['MM-SUN-0244-V1']);
    expect(parsed.outputSha256).toBe('c'.repeat(64));
  });

  it('rejects REAL_PLUS_ENHANCEMENT when provenance is missing', () => {
    const { enhancementProvenance: _removed, ...withoutProvenance } = manifest();
    expect(() => deterministicRenderManifestSchema.parse(withoutProvenance)).toThrow();
  });

  it('rejects an embedded enhancement record from another creative mode', () => {
    expect(() =>
      deterministicRenderManifestSchema.parse({
        ...manifest(),
        enhancementProvenance: {
          ...enhancementProvenance,
          creativeMode: 'REAL_COMPOSITE',
        },
      }),
    ).toThrow();
  });

  it('rejects enhancement provenance attached to a non-enhancement manifest', () => {
    expect(() =>
      deterministicRenderManifestSchema.parse({
        ...manifest(),
        creativeMode: 'REAL_COMPOSITE',
      }),
    ).toThrow();
  });
});
