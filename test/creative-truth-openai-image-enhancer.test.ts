import { describe, expect, it, vi } from 'vitest';
import { CreativeTruthOpenAiImageEnhancer } from '../src/providers/openai/creative-truth-openai-image-enhancer.js';
import type { OpenAiImageEditProvider } from '../src/providers/openai/openai-image-edit-provider.js';

function providerStub() {
  const edit = vi.fn(async () => ({
    sourceAssetId: 'MM-SUN-0244-V1',
    sourceDriveFileId: 'master-drive',
    sourceSha256: 'a'.repeat(64),
    outputSha256: 'b'.repeat(64),
    sourceImageBound: true as const,
    editMode: 'ENHANCE_EXISTING_IMAGE' as const,
    editorProvider: 'OPENAI_IMAGE_EDIT' as const,
    inputFidelity: 'high' as const,
    requestedQuality: 'high' as const,
    requestedSize: 'auto' as const,
    requestedOutputFormat: 'jpeg' as const,
    outputContentType: 'image/jpeg' as const,
    outputBytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
    creativeTruthBound: true as const,
    requiresVenueFidelityGate: true as const,
  }));
  return {
    provider: { edit } as unknown as OpenAiImageEditProvider,
    edit,
  };
}

describe('CreativeTruthOpenAiImageEnhancer', () => {
  it('pins every OpenAI enhancement to the canonical policy and REAL_PLUS_ENHANCEMENT mode', async () => {
    const { provider, edit } = providerStub();
    const enhancer = new CreativeTruthOpenAiImageEnhancer(provider);

    const result = await enhancer.enhance({
      sourceAssetId: 'MM-SUN-0244-V1',
      sourceDriveFileId: 'master-drive',
      imageBytes: Uint8Array.from([1, 2, 3]),
      contentType: 'image/jpeg',
    });

    expect(edit).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAssetId: 'MM-SUN-0244-V1',
        sourceDriveFileId: 'master-drive',
        creativeTruth: {
          brandScope: 'TOCA_DO_MORCEGO',
          policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
          creativeMode: 'REAL_PLUS_ENHANCEMENT',
        },
      }),
    );
    expect(result).toMatchObject({
      policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
      creativeMode: 'REAL_PLUS_ENHANCEMENT',
      editorProvider: 'OPENAI_IMAGE_EDIT',
      sourceAssetId: 'MM-SUN-0244-V1',
      sourceDriveFileId: 'master-drive',
      sourceImageBound: true,
      creativeTruthBound: true,
      requiresVenueFidelityGate: true,
    });
  });

  it('fails before provider execution when source identity or bytes are missing', async () => {
    const { provider, edit } = providerStub();
    const enhancer = new CreativeTruthOpenAiImageEnhancer(provider);

    await expect(
      enhancer.enhance({
        sourceAssetId: '',
        sourceDriveFileId: 'master-drive',
        imageBytes: Uint8Array.from([1]),
        contentType: 'image/jpeg',
      }),
    ).rejects.toThrow('OPENAI_ENHANCEMENT_SOURCE_BINDING_REQUIRED');
    await expect(
      enhancer.enhance({
        sourceAssetId: 'MM-SUN-0244-V1',
        sourceDriveFileId: 'master-drive',
        imageBytes: new Uint8Array(),
        contentType: 'image/jpeg',
      }),
    ).rejects.toThrow('OPENAI_ENHANCEMENT_SOURCE_BINDING_REQUIRED');
    expect(edit).not.toHaveBeenCalled();
  });
});
