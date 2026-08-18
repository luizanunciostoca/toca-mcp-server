import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CreativeTruthOpenAiImageEnhancer } from '../src/providers/openai/creative-truth-openai-image-enhancer.js';
import type { OpenAiImageEditProvider } from '../src/providers/openai/openai-image-edit-provider.js';

const sourceBytes = Uint8Array.from([1, 2, 3]);
const outputBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const sourceSha256 = sha256(sourceBytes);
const outputSha256 = sha256(outputBytes);

function providerStub(overrides: Record<string, unknown> = {}) {
  const edit = vi.fn(async () => ({
    sourceAssetId: 'MM-SUN-0244-V1',
    sourceDriveFileId: 'master-drive',
    sourceSha256,
    outputSha256,
    sourceImageBound: true as const,
    editMode: 'EDIT_EXISTING_IMAGE' as const,
    editorProvider: 'OPENAI_IMAGE_EDIT' as const,
    inputFidelity: 'high' as const,
    requestedQuality: 'high' as const,
    requestedSize: 'auto' as const,
    requestedOutputFormat: 'jpeg' as const,
    outputContentType: 'image/jpeg' as const,
    outputBytes,
    creativeTruthBound: true as const,
    requiresVenueFidelityGate: true as const,
    ...overrides,
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
      imageBytes: sourceBytes,
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
      sourceSha256,
      outputSha256,
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

  it('rejects provider provenance whose source identity or digests do not match the actual bytes', async () => {
    const wrongSource = providerStub({ sourceAssetId: 'OTHER-MASTER' });
    await expect(
      new CreativeTruthOpenAiImageEnhancer(wrongSource.provider).enhance({
        sourceAssetId: 'MM-SUN-0244-V1',
        sourceDriveFileId: 'master-drive',
        imageBytes: sourceBytes,
        contentType: 'image/jpeg',
      }),
    ).rejects.toThrow('FAILED_ENHANCEMENT_PROVENANCE');

    const wrongSourceDigest = providerStub({ sourceSha256: 'c'.repeat(64) });
    await expect(
      new CreativeTruthOpenAiImageEnhancer(wrongSourceDigest.provider).enhance({
        sourceAssetId: 'MM-SUN-0244-V1',
        sourceDriveFileId: 'master-drive',
        imageBytes: sourceBytes,
        contentType: 'image/jpeg',
      }),
    ).rejects.toThrow('FAILED_ENHANCEMENT_PROVENANCE');

    const wrongOutputDigest = providerStub({ outputSha256: 'd'.repeat(64) });
    await expect(
      new CreativeTruthOpenAiImageEnhancer(wrongOutputDigest.provider).enhance({
        sourceAssetId: 'MM-SUN-0244-V1',
        sourceDriveFileId: 'master-drive',
        imageBytes: sourceBytes,
        contentType: 'image/jpeg',
      }),
    ).rejects.toThrow('FAILED_ENHANCEMENT_PROVENANCE');
  });
});

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
