import { ExecutionError } from '../core/errors.js';
import type { LocalPhotoEnhancer } from '../providers/local/local-photo-enhancer.js';
import type { PhotoEnhancementArtifactStore } from '../providers/gcp/gcs-photo-enhancement-artifact-store.js';
import type { PhotoSourceLoader } from '../providers/google-drive/photo-source-loader.js';

export interface PhotoEnhancementRuntimeInput {
  readonly contentItemId: string;
  readonly sourceAssetId: string;
  readonly sourceDriveFileId: string;
  readonly correlationId: string;
}

export interface PhotoEnhancementRuntimeResult {
  readonly contentItemId: string;
  readonly sourceAssetId: string;
  readonly sourceDriveFileId: string;
  readonly sourceSha256: string;
  readonly outputSha256: string;
  readonly sourceImageBound: true;
  readonly editMode: 'ENHANCE_EXISTING_IMAGE';
  readonly editorProvider: 'LOCAL_IMAGEMAGICK';
  readonly pipelineVersion: string;
  readonly artifactRef: string;
  readonly publicationAsset: {
    readonly assetId: string;
    readonly objectName: string;
    readonly sha256: string;
    readonly contentType: 'image/jpeg';
  };
  readonly promotionEligible: false;
  readonly reviewRequired: true;
}

export interface PhotoEnhancementRuntimeDependencies {
  readonly sourceLoader: PhotoSourceLoader;
  readonly enhancer: Pick<LocalPhotoEnhancer, 'enhance'>;
  readonly artifactStore: PhotoEnhancementArtifactStore;
}

export class PhotoEnhancementRuntimeService {
  constructor(private readonly dependencies: PhotoEnhancementRuntimeDependencies) {}

  async enhance(input: PhotoEnhancementRuntimeInput): Promise<PhotoEnhancementRuntimeResult> {
    validateIdentity(input);
    const source = await this.dependencies.sourceLoader.load({
      driveFileId: input.sourceDriveFileId,
    });
    if (source.driveFileId !== input.sourceDriveFileId) {
      throw new ExecutionError(
        'SOURCE_IMAGE_BINDING_FAILURE',
        'PHOTO_ENHANCEMENT_SOURCE_FILE_MISMATCH',
        false,
      );
    }

    const enhanced = await this.dependencies.enhancer.enhance({
      sourceAssetId: input.sourceAssetId,
      sourceDriveFileId: input.sourceDriveFileId,
      imageBytes: source.bytes,
      contentType: source.contentType,
    });
    if (
      enhanced.sourceSha256 !== source.sha256 ||
      enhanced.sourceAssetId !== input.sourceAssetId ||
      enhanced.sourceDriveFileId !== input.sourceDriveFileId ||
      enhanced.sourceImageBound !== true ||
      enhanced.editMode !== 'ENHANCE_EXISTING_IMAGE' ||
      enhanced.editorProvider !== 'LOCAL_IMAGEMAGICK'
    ) {
      throw new ExecutionError(
        'SOURCE_IMAGE_BINDING_FAILURE',
        'PHOTO_ENHANCEMENT_LINEAGE_MISMATCH',
        false,
      );
    }

    const stored = await this.dependencies.artifactStore.store({
      contentItemId: input.contentItemId,
      sourceAssetId: input.sourceAssetId,
      correlationId: input.correlationId,
      bytes: enhanced.outputBytes,
      expectedSha256: enhanced.outputSha256,
    });
    if (stored.sha256 !== enhanced.outputSha256 || stored.contentType !== 'image/jpeg') {
      throw new ExecutionError(
        'SOURCE_IMAGE_BINDING_FAILURE',
        'PHOTO_ENHANCEMENT_PERSISTED_OUTPUT_MISMATCH',
        false,
      );
    }

    return {
      contentItemId: input.contentItemId,
      sourceAssetId: input.sourceAssetId,
      sourceDriveFileId: input.sourceDriveFileId,
      sourceSha256: source.sha256,
      outputSha256: enhanced.outputSha256,
      sourceImageBound: true,
      editMode: 'ENHANCE_EXISTING_IMAGE',
      editorProvider: 'LOCAL_IMAGEMAGICK',
      pipelineVersion: enhanced.pipelineVersion,
      artifactRef: stored.artifactRef,
      publicationAsset: {
        assetId: `${input.sourceAssetId}-enhanced`,
        objectName: stored.objectName,
        sha256: stored.sha256,
        contentType: 'image/jpeg',
      },
      promotionEligible: false,
      reviewRequired: true,
    };
  }
}

function validateIdentity(input: PhotoEnhancementRuntimeInput): void {
  for (const [name, value] of Object.entries(input)) {
    if (!value.trim()) throw new Error(`PHOTO_ENHANCEMENT_${name.toUpperCase()}_REQUIRED`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.correlationId)) {
    throw new Error('PHOTO_ENHANCEMENT_CORRELATION_ID_INVALID');
  }
}
