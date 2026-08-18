import { describe, expect, it, vi } from 'vitest';
import type { CreativeStandard } from '../src/contracts/creative-truth.js';
import { LocalStoryComposer } from '../src/providers/local/local-story-composer.js';

const partyStandard: CreativeStandard = {
  standardId: 'THE_PARTY_HYBRID_MINIMALIST_V1',
  version: '1.0',
  brandScope: 'TOCA_DO_MORCEGO',
  operation: 'THE_PARTY',
  channel: 'INSTAGRAM',
  format: 'STORY',
  parentPolicyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
  canonicalDriveId: '1QQRReW6dLwAh0BrJUiVpbXHGsbV-5ze81MOYkSx7WIU',
  repoMirrorPath: 'control/creative-standards/the-party-hybrid-minimalist-standard.v1.json',
  status: 'ACTIVE_CANONICAL',
  realAssetRequired: true,
  deterministicBrandInsertion: true,
  venueFidelityGateRequired: true,
};

describe('LocalStoryComposer generative routing boundary', () => {
  it('rejects direct GENERATIVE_EXCEPTION before any local render', async () => {
    const runner = vi.fn(async () => undefined);
    const composer = new LocalStoryComposer(runner);

    await expect(
      composer.compose({
        storyCreativeId: 'SC-GEN-BYPASS',
        contentItemId: 'CONTENT-GEN-BYPASS',
        imageBytes: Uint8Array.from([1]),
        contentType: 'image/jpeg',
        templateId: 'PHOTO_ONLY',
        standard: partyStandard,
        creativeMode: 'GENERATIVE_EXCEPTION',
        requiredBrands: [],
        brandAssets: [],
      }),
    ).rejects.toThrow('GENERATIVE_EXCEPTION_REQUIRES_OPERATION_SCOPED_PIPELINE');

    expect(runner).not.toHaveBeenCalled();
  });
});
