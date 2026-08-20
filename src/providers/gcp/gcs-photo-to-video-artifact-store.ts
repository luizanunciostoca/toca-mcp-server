import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PhotoToVideoRouteType } from '../../contracts/photo-to-video.js';
import { ExecutionError } from '../../core/errors.js';
import { GcsPublicationAssetDelivery } from './gcs-publication-asset-delivery.js';
import { GcsPublicationAssetStager } from './gcs-publication-asset-stager.js';

export interface PhotoToVideoArtifactStoreRequest {
  readonly contentItemId: string;
  readonly routeType: PhotoToVideoRouteType;
  readonly bytes: Uint8Array;
  readonly expectedSha256: string;
}

export interface StoredPhotoToVideoArtifact {
  readonly artifactRef: string;
  readonly objectName: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly contentType: 'video/mp4';
}

export interface PhotoToVideoArtifactStore {
  store(request: PhotoToVideoArtifactStoreRequest): Promise<StoredPhotoToVideoArtifact>;
  loadExact(artifactRef: string, expectedSha256: string): Promise<Uint8Array>;
}

export interface GcsPhotoToVideoArtifactStoreOptions {
  readonly projectId: string;
  readonly bucketName: string;
  readonly fetchImpl?: typeof fetch;
}

export class GcsPhotoToVideoArtifactStore implements PhotoToVideoArtifactStore {
  private readonly fetchImpl: typeof fetch;
  private readonly stager: GcsPublicationAssetStager;
  private readonly delivery: GcsPublicationAssetDelivery;

  constructor(private readonly options: GcsPhotoToVideoArtifactStoreOptions) {
    if (!options.projectId.trim() || !options.bucketName.trim()) {
      throw new Error('PHOTO_TO_VIDEO_ARTIFACT_STORE_CONFIG_REQUIRED');
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

  async store(request: PhotoToVideoArtifactStoreRequest): Promise<StoredPhotoToVideoArtifact> {
    const observedSha256 = sha256(request.bytes);
    if (
      request.bytes.byteLength === 0 ||
      !isMp4(request.bytes) ||
      !/^[a-f0-9]{64}$/i.test(request.expectedSha256) ||
      observedSha256 !== request.expectedSha256.toLowerCase()
    ) {
      throw new ExecutionError(
        'SOURCE_IMAGE_BINDING_FAILURE',
        'PHOTO_TO_VIDEO_ARTIFACT_INPUT_HASH_MISMATCH',
        false,
      );
    }

    const workspace = await mkdtemp(join(tmpdir(), 'toca-video-artifact-'));
    const sourcePath = join(workspace, 'candidate.mp4');
    try {
      await writeFile(sourcePath, request.bytes);
      const stage = await this.stager.stage({
        assetId: artifactAssetId(request.contentItemId),
        correlationId: artifactCorrelationId(request.routeType),
        sourcePath,
        contentType: 'video/mp4',
      });
      if (stage.sha256 !== observedSha256 || stage.sizeBytes !== request.bytes.byteLength) {
        throw new ExecutionError(
          'SOURCE_IMAGE_BINDING_FAILURE',
          'PHOTO_TO_VIDEO_ARTIFACT_STAGE_HASH_MISMATCH',
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
        contentType: 'video/mp4',
      };
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }

  async loadExact(artifactRef: string, expectedSha256: string): Promise<Uint8Array> {
    if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) {
      throw new ExecutionError(
        'SOURCE_IMAGE_BINDING_FAILURE',
        'PHOTO_TO_VIDEO_ARTIFACT_EXPECTED_SHA_INVALID',
        false,
      );
    }
    const objectName = parseArtifactRef(artifactRef, this.options.bucketName);
    const url = await this.delivery.createVerifiedDeliveryUrl(
      objectName,
      expectedSha256.toLowerCase(),
      'video/mp4',
    );
    const response = await this.fetchImpl(url, { method: 'GET', redirect: 'follow' });
    if (!response.ok) {
      throw new ExecutionError(
        'PROVIDER_UNAVAILABLE',
        `PHOTO_TO_VIDEO_ARTIFACT_FETCH_FAILED:${response.status}`,
        response.status >= 500,
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!isMp4(bytes) || sha256(bytes) !== expectedSha256.toLowerCase()) {
      throw new ExecutionError(
        'SOURCE_IMAGE_BINDING_FAILURE',
        'PHOTO_TO_VIDEO_ARTIFACT_READBACK_HASH_MISMATCH',
        false,
      );
    }
    return bytes;
  }
}

function artifactAssetId(contentItemId: string): string {
  const normalized = contentItemId.trim();
  if (!normalized) throw new Error('PHOTO_TO_VIDEO_ARTIFACT_CONTENT_ITEM_REQUIRED');
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 24);
  return `photo-video-${digest}`;
}

function artifactCorrelationId(routeType: PhotoToVideoRouteType): string {
  return routeType === 'REAL_PHOTO_TO_MOTION_VIDEO'
    ? 'photo-motion-review-v1'
    : 'scene-continuation-review-v1';
}

function parseArtifactRef(artifactRef: string, expectedBucket: string): string {
  const prefix = `gcs://${expectedBucket}/`;
  if (!artifactRef.startsWith(prefix)) {
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'PHOTO_TO_VIDEO_ARTIFACT_REF_BUCKET_MISMATCH',
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
      'PHOTO_TO_VIDEO_ARTIFACT_REF_INVALID',
      false,
    );
  }
  return objectName;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isMp4(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp';
}
