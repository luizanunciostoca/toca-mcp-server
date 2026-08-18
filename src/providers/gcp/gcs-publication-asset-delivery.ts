import { createHash } from 'node:crypto';
import {
  validatePublicMediaUrl,
  type PublicationAssetContentType,
} from './gcs-publication-asset-stager.js';

export interface GcsPublicationAssetDeliveryOptions {
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

export class GcsPublicationAssetDelivery {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly signedUrlTtlSeconds: number;

  constructor(private readonly options: GcsPublicationAssetDeliveryOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.signedUrlTtlSeconds = options.signedUrlTtlSeconds ?? 15 * 60;
    if (
      !Number.isInteger(this.signedUrlTtlSeconds) ||
      this.signedUrlTtlSeconds < 60 ||
      this.signedUrlTtlSeconds > 60 * 60
    ) {
      throw new Error('PUBLICATION_ASSET_DELIVERY_TTL_INVALID');
    }
  }

  async createDeliveryUrl(
    objectName: string,
    expectedContentType?: PublicationAssetContentType,
  ): Promise<string> {
    assertPublicationObjectName(objectName);
    const identity = await this.fetchRuntimeIdentity();
    const url = await this.createSignedDownloadUrl(objectName, identity);
    await validatePublicMediaUrl(url, expectedContentType, this.fetchImpl);
    return url;
  }

  async createVerifiedDeliveryUrl(
    objectName: string,
    expectedSha256: string,
    expectedContentType?: PublicationAssetContentType,
  ): Promise<string> {
    if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
      throw new Error('PUBLICATION_ASSET_EXPECTED_SHA256_INVALID');
    }
    const url = await this.createDeliveryUrl(objectName, expectedContentType);
    const response = await this.fetchImpl(url, { method: 'GET', redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`PUBLICATION_ASSET_VERIFICATION_FETCH_FAILED:${response.status}`);
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (!isAllowedPublicationContentType(contentType)) {
      throw new Error(
        `PUBLICATION_ASSET_VERIFICATION_CONTENT_TYPE_INVALID:${contentType ?? 'missing'}`,
      );
    }
    if (expectedContentType && contentType !== expectedContentType) {
      throw new Error(
        `PUBLICATION_ASSET_VERIFICATION_CONTENT_TYPE_MISMATCH:${expectedContentType}:${contentType}`,
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) throw new Error('PUBLICATION_ASSET_VERIFICATION_EMPTY');
    const observedSha256 = createHash('sha256').update(bytes).digest('hex');
    if (observedSha256 !== expectedSha256) {
      throw new Error('PUBLICATION_ASSET_SHA256_MISMATCH');
    }
    return url;
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

function assertPublicationObjectName(objectName: string): void {
  if (
    !/^instagram\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(
      objectName,
    ) ||
    objectName.includes('..')
  ) {
    throw new Error('PUBLICATION_ASSET_OBJECT_NAME_INVALID');
  }
}

function isAllowedPublicationContentType(
  value: string | undefined,
): value is PublicationAssetContentType {
  return (
    value === 'image/jpeg' ||
    value === 'image/png' ||
    value === 'image/webp' ||
    value === 'video/mp4'
  );
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
