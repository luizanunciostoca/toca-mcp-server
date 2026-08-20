import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export type PublicationAssetContentType = 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4';

export interface PublicationAssetStageRequest {
  readonly assetId: string;
  readonly correlationId: string;
  readonly sourcePath: string;
  readonly contentType: PublicationAssetContentType;
}

export interface PublicationAssetStageResult {
  readonly objectName: string;
  readonly publicUrl: string;
  readonly contentType: PublicationAssetContentType;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface GcsPublicationAssetStagerOptions {
  readonly projectId: string;
  readonly bucketName: string;
  readonly signedUrlTtlSeconds?: number;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

interface RuntimeIdentity {
  readonly accessToken: string;
  readonly serviceAccountEmail: string;
}

export class GcsPublicationAssetStager {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly signedUrlTtlSeconds: number;

  constructor(private readonly options: GcsPublicationAssetStagerOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.signedUrlTtlSeconds = options.signedUrlTtlSeconds ?? 6 * 60 * 60;
    if (
      !Number.isInteger(this.signedUrlTtlSeconds) ||
      this.signedUrlTtlSeconds < 60 ||
      this.signedUrlTtlSeconds > 12 * 60 * 60
    ) {
      throw new Error('PUBLICATION_ASSET_SIGNED_URL_TTL_INVALID');
    }
  }

  async stage(request: PublicationAssetStageRequest): Promise<PublicationAssetStageResult> {
    const bytes = await readFile(request.sourcePath);
    if (bytes.byteLength === 0) throw new Error('PUBLICATION_ASSET_EMPTY');

    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const objectName = buildPublicationAssetObjectName(request, sha256);
    const identity = await this.fetchRuntimeIdentity();
    const deliveryUrl = await this.createSignedDownloadUrl(objectName, identity);

    const existingContentType = await tryValidateExternalMediaUrl(
      deliveryUrl,
      request.contentType,
      this.fetchImpl,
    );
    if (existingContentType) {
      return {
        objectName,
        publicUrl: deliveryUrl,
        contentType: existingContentType,
        sizeBytes: bytes.byteLength,
        sha256,
      };
    }

    const uploadUrl = new URL(
      `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.options.bucketName)}/o`,
    );
    uploadUrl.searchParams.set('uploadType', 'media');
    uploadUrl.searchParams.set('name', objectName);

    const uploadResponse = await this.fetchImpl(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${identity.accessToken}`,
        'Content-Type': request.contentType,
      },
      body: bytes,
    });
    if (!uploadResponse.ok) {
      throw new Error(`PUBLICATION_ASSET_UPLOAD_FAILED:${uploadResponse.status}`);
    }

    const validatedContentType = await validatePublicMediaUrl(
      deliveryUrl,
      request.contentType,
      this.fetchImpl,
    );

    return {
      objectName,
      publicUrl: deliveryUrl,
      contentType: validatedContentType,
      sizeBytes: bytes.byteLength,
      sha256,
    };
  }

  private async fetchRuntimeIdentity(): Promise<RuntimeIdentity> {
    const [tokenResponse, emailResponse] = await Promise.all([
      this.fetchImpl(
        'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
        { headers: { 'Metadata-Flavor': 'Google' } },
      ),
      this.fetchImpl(
        'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email',
        { headers: { 'Metadata-Flavor': 'Google' } },
      ),
    ]);

    if (!tokenResponse.ok) throw new Error(`GCP_METADATA_TOKEN_FAILED:${tokenResponse.status}`);
    if (!emailResponse.ok) throw new Error(`GCP_METADATA_EMAIL_FAILED:${emailResponse.status}`);

    const tokenPayload = (await tokenResponse.json()) as { access_token?: unknown };
    if (typeof tokenPayload.access_token !== 'string' || !tokenPayload.access_token.trim()) {
      throw new Error('GCP_METADATA_TOKEN_INVALID');
    }

    const serviceAccountEmail = (await emailResponse.text()).trim();
    if (!/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(serviceAccountEmail)) {
      throw new Error('GCP_METADATA_EMAIL_INVALID');
    }

    return { accessToken: tokenPayload.access_token, serviceAccountEmail };
  }

  private async createSignedDownloadUrl(
    objectName: string,
    identity: RuntimeIdentity,
  ): Promise<string> {
    const timestamp = formatV4Timestamp(this.now());
    const datestamp = timestamp.slice(0, 8);
    const credentialScope = `${datestamp}/auto/storage/goog4_request`;
    const canonicalUri = buildCanonicalObjectPath(this.options.bucketName, objectName);
    const query: Record<string, string> = {
      'X-Goog-Algorithm': 'GOOG4-RSA-SHA256',
      'X-Goog-Credential': `${identity.serviceAccountEmail}/${credentialScope}`,
      'X-Goog-Date': timestamp,
      'X-Goog-Expires': String(this.signedUrlTtlSeconds),
      'X-Goog-SignedHeaders': 'host',
    };
    const canonicalQuery = canonicalizeQuery(query);
    const canonicalRequest = [
      'GET',
      canonicalUri,
      canonicalQuery,
      'host:storage.googleapis.com\n',
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const canonicalRequestHash = createHash('sha256').update(canonicalRequest).digest('hex');
    const stringToSign = [
      'GOOG4-RSA-SHA256',
      timestamp,
      credentialScope,
      canonicalRequestHash,
    ].join('\n');

    const signResponse = await this.fetchImpl(
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(identity.serviceAccountEmail)}:signBlob`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${identity.accessToken}`,
          'Content-Type': 'application/json',
          'X-Goog-User-Project': this.options.projectId,
        },
        body: JSON.stringify({ payload: Buffer.from(stringToSign).toString('base64') }),
      },
    );
    if (!signResponse.ok) {
      throw new Error(`PUBLICATION_ASSET_SIGN_BLOB_FAILED:${signResponse.status}`);
    }
    const signPayload = (await signResponse.json()) as { signedBlob?: unknown };
    if (typeof signPayload.signedBlob !== 'string' || !signPayload.signedBlob.trim()) {
      throw new Error('PUBLICATION_ASSET_SIGN_BLOB_INVALID');
    }
    const signature = Buffer.from(signPayload.signedBlob, 'base64').toString('hex');
    return `https://storage.googleapis.com${canonicalUri}?${canonicalQuery}&X-Goog-Signature=${signature}`;
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
  return `https://storage.googleapis.com${buildCanonicalObjectPath(bucketName, objectName)}`;
}

export async function validatePublicMediaUrl(
  url: string,
  expectedContentType?: PublicationAssetContentType,
  fetchImpl: typeof fetch = fetch,
): Promise<PublicationAssetContentType> {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Range: 'bytes=0-0' },
    redirect: 'follow',
  });
  if (!(response.status === 200 || response.status === 206)) {
    throw new Error(`PUBLICATION_ASSET_PUBLIC_FETCH_FAILED:${response.status}`);
  }
  const contentType = normalizePublicationContentType(response.headers.get('content-type'));
  if (!contentType) {
    const raw = response.headers.get('content-type')?.split(';', 1)[0]?.trim() ?? 'missing';
    throw new Error(`PUBLICATION_ASSET_PUBLIC_CONTENT_TYPE_INVALID:${raw}`);
  }
  if (expectedContentType && contentType !== expectedContentType) {
    throw new Error(
      `PUBLICATION_ASSET_PUBLIC_CONTENT_TYPE_MISMATCH:${expectedContentType}:${contentType}`,
    );
  }
  return contentType;
}

/** @deprecated Prefer validatePublicMediaUrl. Kept for image-only callers. */
export async function validatePublicImageUrl(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const contentType = await validatePublicMediaUrl(url, undefined, fetchImpl);
  if (!contentType.startsWith('image/')) {
    throw new Error(`PUBLICATION_ASSET_PUBLIC_CONTENT_TYPE_INVALID:${contentType}`);
  }
  return contentType;
}

async function tryValidateExternalMediaUrl(
  url: string,
  expectedContentType: PublicationAssetContentType,
  fetchImpl: typeof fetch,
): Promise<PublicationAssetContentType | undefined> {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Range: 'bytes=0-0' },
    redirect: 'follow',
  });
  if (response.status === 404) return undefined;
  if (!(response.status === 200 || response.status === 206)) {
    throw new Error(`PUBLICATION_ASSET_EXISTING_FETCH_FAILED:${response.status}`);
  }
  const contentType = normalizePublicationContentType(response.headers.get('content-type'));
  if (!contentType) {
    const raw = response.headers.get('content-type')?.split(';', 1)[0]?.trim() ?? 'missing';
    throw new Error(`PUBLICATION_ASSET_EXISTING_CONTENT_TYPE_INVALID:${raw}`);
  }
  if (contentType !== expectedContentType) {
    throw new Error(
      `PUBLICATION_ASSET_EXISTING_CONTENT_TYPE_MISMATCH:${expectedContentType}:${contentType}`,
    );
  }
  return contentType;
}

function normalizePublicationContentType(
  value: string | null,
): PublicationAssetContentType | undefined {
  const normalized = value?.split(';', 1)[0]?.trim().toLowerCase();
  if (
    normalized === 'image/jpeg' ||
    normalized === 'image/png' ||
    normalized === 'image/webp' ||
    normalized === 'video/mp4'
  ) {
    return normalized;
  }
  return undefined;
}

function buildCanonicalObjectPath(bucketName: string, objectName: string): string {
  const encodedBucket = encodeRfc3986(bucketName);
  const encodedObject = objectName
    .split('/')
    .map((segment) => encodeRfc3986(segment))
    .join('/');
  return `/${encodedBucket}/${encodedObject}`;
}

function canonicalizeQuery(query: Record<string, string>): string {
  return Object.entries(query)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join('&');
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function formatV4Timestamp(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new Error('PUBLICATION_ASSET_SIGNING_TIME_INVALID');
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
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
    case 'video/mp4':
      return 'mp4';
  }
}
