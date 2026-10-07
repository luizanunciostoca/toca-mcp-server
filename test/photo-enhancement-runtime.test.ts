import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { PhotoEnhancementRuntimeService } from '../src/creative/photo-enhancement-runtime.js';

const sourceBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0xff, 0xd9]);
const outputBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
const outputSha256 = createHash('sha256').update(outputBytes).digest('hex');

function createRuntime() {
  const sourceLoader = {
    load: vi.fn(() =>
      Promise.resolve({
        bytes: sourceBytes,
        contentType: 'image/jpeg' as const,
        driveFileId: 'drive-source-1',
        sha256: sourceSha256,
      }),
    ),
  };
  const enhancer = {
    enhance: vi.fn(() =>
      Promise.resolve({
        sourceAssetId: 'SUN-0268',
        sourceDriveFileId: 'drive-source-1',
        sourceSha256,
        outputSha256,
        sourceImageBound: true as const,
        editMode: 'ENHANCE_EXISTING_IMAGE' as const,
        editorProvider: 'LOCAL_IMAGEMAGICK' as const,
        pipelineVersion: 'local-photo-enhancer-v1' as const,
        requestedScale: '200%' as const,
        outputContentType: 'image/jpeg' as const,
        outputBytes,
      }),
    ),
  };
  const artifactStore = {
    store: vi.fn(() =>
      Promise.resolve({
        artifactRef: 'gcs://bucket/instagram/CORR-1/photo.jpg',
        objectName: 'instagram/CORR-1/photo.jpg',
        sha256: outputSha256,
        sizeBytes: outputBytes.byteLength,
        contentType: 'image/jpeg' as const,
      }),
    ),
    loadExact: vi.fn(),
  };
  return {
    runtime: new PhotoEnhancementRuntimeService({ sourceLoader, enhancer, artifactStore }),
    sourceLoader,
    enhancer,
    artifactStore,
  };
}

describe('PhotoEnhancementRuntimeService', () => {
  it('preserves exact lineage and returns a scheduler-compatible private publication asset', async () => {
    const { runtime, sourceLoader, enhancer, artifactStore } = createRuntime();

    const result = await runtime.enhance({
      contentItemId: 'MKT-20260903-SUNSET-FEED-0900',
      sourceAssetId: 'SUN-0268',
      sourceDriveFileId: 'drive-source-1',
      correlationId: 'CORR-1',
    });

    expect(sourceLoader.load).toHaveBeenCalledWith({ driveFileId: 'drive-source-1' });
    expect(enhancer.enhance).toHaveBeenCalledWith({
      sourceAssetId: 'SUN-0268',
      sourceDriveFileId: 'drive-source-1',
      imageBytes: sourceBytes,
      contentType: 'image/jpeg',
    });
    expect(artifactStore.store).toHaveBeenCalledWith({
      contentItemId: 'MKT-20260903-SUNSET-FEED-0900',
      sourceAssetId: 'SUN-0268',
      correlationId: 'CORR-1',
      bytes: outputBytes,
      expectedSha256: outputSha256,
    });
    expect(result.publicationAsset).toEqual({
      assetId: 'SUN-0268-enhanced',
      objectName: 'instagram/CORR-1/photo.jpg',
      sha256: outputSha256,
      contentType: 'image/jpeg',
    });
    expect(result).toMatchObject({
      sourceSha256,
      outputSha256,
      sourceImageBound: true,
      editMode: 'ENHANCE_EXISTING_IMAGE',
      editorProvider: 'LOCAL_IMAGEMAGICK',
      promotionEligible: false,
      reviewRequired: true,
    });
  });

  it('fails closed before persistence when the enhancer lineage does not match the loaded source', async () => {
    const { runtime, enhancer, artifactStore } = createRuntime();
    enhancer.enhance.mockResolvedValueOnce({
      sourceAssetId: 'SUN-WRONG',
      sourceDriveFileId: 'drive-source-1',
      sourceSha256,
      outputSha256,
      sourceImageBound: true,
      editMode: 'ENHANCE_EXISTING_IMAGE',
      editorProvider: 'LOCAL_IMAGEMAGICK',
      pipelineVersion: 'local-photo-enhancer-v1',
      requestedScale: '200%',
      outputContentType: 'image/jpeg',
      outputBytes,
    });

    await expect(
      runtime.enhance({
        contentItemId: 'MKT-20260903-SUNSET-FEED-0900',
        sourceAssetId: 'SUN-0268',
        sourceDriveFileId: 'drive-source-1',
        correlationId: 'CORR-1',
      }),
    ).rejects.toThrow('PHOTO_ENHANCEMENT_LINEAGE_MISMATCH');
    expect(artifactStore.store).not.toHaveBeenCalled();
  });

  it('rejects correlation ids that cannot be used as stable GCS path segments', async () => {
    const { runtime } = createRuntime();

    await expect(
      runtime.enhance({
        contentItemId: 'MKT-20260903-SUNSET-FEED-0900',
        sourceAssetId: 'SUN-0268',
        sourceDriveFileId: 'drive-source-1',
        correlationId: 'CORR:INVALID',
      }),
    ).rejects.toThrow('PHOTO_ENHANCEMENT_CORRELATION_ID_INVALID');
  });
});
