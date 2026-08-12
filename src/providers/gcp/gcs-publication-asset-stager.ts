import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export interface PublicationAssetStageRequest {
  readonly assetId: string;
  readonly correlationId: string;
  readonly sourcePath: string;
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface PublicationAssetStageResult {
  readonly objectName: string;
  readonly publicUrl: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface GcsPublicationAssetStagerOptions {
  readonly projectId: string;
  readonly bucketName: string;
  readonly fetchImpl?: typeof fetch;
}

export class GcsPublicationAssetStager {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GcsPublicationAssetStagerOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async stage(request: PublicationAssetStageRequest): Promise<PublicationAssetStageResult> {
    const bytes = await readFile(request.sourcePath);
    if (bytes.byteLength === 0) throw new Error('PUBLICATION_ASSET_EMPTY');

    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const objectName = buildPublicationAssetObjectName(request, sha256);
    const publicUrl = buildPublicGcsObjectUrl(this.options.bucketName, objectName);

    const existingContentType = await tryValidatePublicImageUrl(publicUrl, this.fetchImpl);
    if (existingContentType) {
      return {
        objectName,
        publicUrl,
        contentType: existingContentType,
        sizeBytes: bytes.byteLength,
        sha256,
      };
    }

    const accessToken = await this.fetchAccessToken();
    const uploadUrl = new URL(
      `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.options.bucketName)}/o`,
    );
    uploadUrl.searchParams.set('uploadType', 'media');
    uploadUrl.searchParams.set('name', objectName);

    const uploadResponse = await this.fetchImpl(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': request.contentType,
        'X-Goog-User-Project': this.options.projectId,
      },
      body: bytes,
    });
    if (!uploadResponse.ok) {
      throw new Error(`PUBLICATION_ASSET_UPLOAD_FAILED:${uploadResponse.status}`);
    }

    const validatedContentType = await validatePublicImageUrl(publicUrl, this.fetchImpl);

    return {
      objectName,
      publicUrl,
      contentType: validatedContentType,
      sizeBytes: bytes.byteLength,
      sha256,
    };
  }

  private async fetchAccessToken(): Promise<string> {
    const response = await this.fetchImpl(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' } },
    );
    if (!response.ok) throw new Error(`GCP_METADATA_TOKEN_FAILED:${response.status}`);
    const payload = (await response.json()) as { access_token?: unknown };
    if (typeof payload.access_token !== 'string' || !payload.access_token.trim()) {
      throw new Error('GCP_METADATA_TOKEN_INVALID');
    }
    return payload.access_token;
  }
}

export function buildPublicationAssetObjectName(
  request: Pick<PublicationAssetStageRequest, 'assetId' | 'correlationId' | 'contentType'>,
  sha256: string,
): string {
  const assetId = sanitizeSegment(request.assetId, 'assetId');
  const correlationId = sanitizeSegment(request.correlationId, 'correlationId');
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('PUBLICATION_ASSET_SHA256_INVALID');
  const extension = extensionFor(request.contentType);
  return `instagram/${correlationId}/${assetId}-${sha256.slice(0, 16)}.${extension}`;
}

export function buildPublicGcsObjectUrl(bucketName: string, objectName: string): string {
  const encodedObject = objectName
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `https://storage.googleapis.com/${encodeURIComponent(bucketName)}/${encodedObject}`;
}

export async function validatePublicImageUrl(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Range: 'bytes=0-0' },
    redirect: 'follow',
  });
  if (!(response.status === 200 || response.status === 206)) {
    throw new Error(`PUBLICATION_ASSET_PUBLIC_FETCH_FAILED:${response.status}`);
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
  if (!contentType?.startsWith('image/')) {
    throw new Error(`PUBLICATION_ASSET_PUBLIC_CONTENT_TYPE_INVALID:${contentType ?? 'missing'}`);
  }
  return contentType;
}

async function tryValidatePublicImageUrl(
  url: string,
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Range: 'bytes=0-0' },
    redirect: 'follow',
  });
  if (response.status === 404) return undefined;
  if (!(response.status === 200 || response.status === 206)) {
    throw new Error(`PUBLICATION_ASSET_EXISTING_FETCH_FAILED:${response.status}`);
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
  if (!contentType?.startsWith('image/')) {
    throw new Error(`PUBLICATION_ASSET_EXISTING_CONTENT_TYPE_INVALID:${contentType ?? 'missing'}`);
  }
  return contentType;
}

function sanitizeSegment(value: string, field: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(normalized)) {
    throw new Error(`PUBLICATION_ASSET_${field.toUpperCase()}_INVALID`);
  }
  return normalized;
}

function extensionFor(contentType: PublicationAssetStageRequest['contentType']): string {
  switch (contentType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
  }
}
