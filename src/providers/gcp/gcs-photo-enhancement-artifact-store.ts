import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionError } from '../../core/errors.js';
import { GcsPublicationAssetDelivery } from './gcs-publication-asset-delivery.js';
import { GcsPublicationAssetStager } from './gcs-publication-asset-stager.js';

export interface PhotoEnhancementArtifactStoreRequest {
  readonly contentItemId: string;
  readonly sourceAssetId: string;
  readonly correlationId: string;
  readonly bytes: Uint8Array;
  readonly expectedSha256: string;
}

export interface StoredPhotoEnhancementArtifact {
  readonly artifactRef: string;
  readonly objectName: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly contentType: 'image/jpeg';
}

export interface PhotoEnhancementArtifactStore {
  store(request: PhotoEnhancementArtifactStoreRequest): Promise<StoredPhotoEnhancementArtifact>;
  loadExact(artifactRef: string, expectedSha256: string): Promise<Uint8Array>;
}

export interface GcsPhotoEnhancementArtifactStoreOptions {
  readonly projectId: string;
  readonly bucketName: string;
  readonly fetchImpl?: typeof fetch;
}

export class GcsPhotoEnhancementArtifactStore implements PhotoEnhancementArtifactStore {
  private readonly fetchImpl: typeof fetch;
  private readonly stager: GcsPublicationAssetStager;
  private readonly delivery: GcsPublicationAssetDelivery;

  constructor(private readonly options: GcsPhotoEnhancementArtifactStoreOptions) {
    if (!options.projectId.trim() || !options.bucketName.trim()) {
      throw new Error('PHOTO_ENHANCEMENT_ARTIFACT_STORE_CONFIG_REQUIRED');
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.stager = new GcsPublicationAssetStager({
      projectId: options.projectId,
      bucketName: options.bucketName,
      signedUrlTtlSeconds: 60 * 60,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    this.delivery = new GcsPublicationAssetDelivery({
      projectId: options.projectId,
      bucketName: options.bucketName,
      signedUrlTtlSeconds: 15 * 60,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
  }

  async store(
    request: PhotoEnhancementArtifactStoreRequest,
  ): Promise<StoredPhotoEnhancementArtifact> {
    const observedSha256 = sha256(request.bytes);
    if (
      request.bytes.byteLength === 0 ||
      !isJpeg(request.bytes) ||
      !/^[a-f0-9]{64}$/i.test(request.expectedSha256) ||
      observedSha256 !== request.expectedSha256.toLowerCase()
    ) {
      throw new ExecutionError(
        'SOURCE_IMAGE_BINDING_FAILURE',
        'PHOTO_ENHANCEMENT_ARTIFACT_INPUT_HASH_MISMATCH',
        false,
      );
    }

    const workspace = await mkdtemp(join(tmpdir(), 'toca-photo-enhancement-artifact-'));
    const sourcePath = join(workspace, 'enhanced.jpg');
    try {
      await writeFile(sourcePath, request.bytes);
      const stage = await this.stager.stage({
        assetId: artifactAssetId(request.contentItemId, request.sourceAssetId),
        correlationId: request.correlationId,
        sourcePath,
        contentType: 'image/jpeg',
      });
      if (stage.sha256 !== observedSha256 || stage.sizeBytes !== request.bytes.byteLength) {
        throw new ExecutionError(
          'SOURCE_IMAGE_BINDING_FAILURE',
          'PHOTO_ENHANCEMENT_ARTIFACT_STAGE_HASH_MISMATCH',
          false,
        );
      }
      const artifactRef = `gcs://${this.options.bucketName}/${stage.objectName}`;
      await this.loadExact(artifactRef, observedSha256);
      return {
        artifactRef,
        objectName: stage.objectName,
        sha256: observedSha256,
        sizeBytes: request.bytes.byteLength,
        contentType: 'image/jpeg',
      };
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }

  async loadExact(artifactRef: string, expectedSha256: string): Promise<Uint8Array> {
    if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) {
      throw new ExecutionError(
        'SOURCE_IMAGE_BINDING_FAILURE',
        'PHOTO_ENHANCEMENT_ARTIFACT_EXPECTED_SHA_INVALID',
        false,
      );
    }
    const objectName = parseArtifactRef(artifactRef, this.options.bucketName);
    const url = await this.delivery.createVerifiedDeliveryUrl(
      objectName,
      expectedSha256.toLowerCase(),
      'image/jpeg',
    );
    const response = await this.fetchImpl(url, { method: 'GET', redirect: 'follow' });
    if (!response.ok) {
      throw new ExecutionError(
        'PROVIDER_UNAVAILABLE',
        `PHOTO_ENHANCEMENT_ARTIFACT_FETCH_FAILED:${response.status}`,
        response.status >= 500,
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!isJpeg(bytes) || sha256(bytes) !== expectedSha256.toLowerCase()) {
      throw new ExecutionError(
        'SOURCE_IMAGE_BINDING_FAILURE',
        'PHOTO_ENHANCEMENT_ARTIFACT_READBACK_HASH_MISMATCH',
        false,
      );
    }
    return bytes;
  }
}

function artifactAssetId(contentItemId: string, sourceAssetId: string): string {
  const raw = `${contentItemId.trim()}:${sourceAssetId.trim()}`;
  if (!contentItemId.trim() || !sourceAssetId.trim()) {
    throw new Error('PHOTO_ENHANCEMENT_ARTIFACT_IDENTITY_REQUIRED');
  }
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 24);
  return `photo-enhance-${digest}`;
}

function parseArtifactRef(artifactRef: string, expectedBucket: string): string {
  const prefix = `gcs://${expectedBucket}/`;
  if (!artifactRef.startsWith(prefix)) {
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'PHOTO_ENHANCEMENT_ARTIFACT_REF_BUCKET_MISMATCH',
      false,
    );
  }
  const objectName = artifactRef.slice(prefix.length);
  if (
    !/^instagram\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(
      objectName,
    ) ||
    objectName.includes('..')
  ) {
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'PHOTO_ENHANCEMENT_ARTIFACT_REF_INVALID',
      false,
    );
  }
  return objectName;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}
