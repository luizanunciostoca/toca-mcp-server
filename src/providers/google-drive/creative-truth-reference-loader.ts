import type { VenueReference } from '../../contracts/creative-truth.js';
import { ExecutionError } from '../../core/errors.js';
import type { SecretReference, SecretResolver } from '../../core/secrets.js';

const DEFAULT_GOOGLE_DRIVE_BASE_URL = 'https://www.googleapis.com/drive/v3';
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type CreativeTruthReferenceContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface LoadedCreativeTruthVenueReference {
  readonly registry: VenueReference;
  readonly imageBytes: Uint8Array;
  readonly contentType: CreativeTruthReferenceContentType;
}

export interface CreativeTruthVenueReferenceLoader {
  load(reference: VenueReference): Promise<LoadedCreativeTruthVenueReference>;
}

export interface GoogleDriveCreativeTruthReferenceLoaderOptions {
  readonly secretResolver: SecretResolver;
  readonly accessTokenReference: SecretReference;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

interface GoogleDriveFileMetadata {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly mimeType?: unknown;
  readonly size?: unknown;
  readonly capabilities?: {
    readonly canDownload?: unknown;
  };
}

export class GoogleDriveCreativeTruthReferenceLoader
  implements CreativeTruthVenueReferenceLoader
{
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GoogleDriveCreativeTruthReferenceLoaderOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_GOOGLE_DRIVE_BASE_URL).replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async load(reference: VenueReference): Promise<LoadedCreativeTruthVenueReference> {
    validateReferenceIdentity(reference);
    const token = await this.options.secretResolver.resolve(this.options.accessTokenReference);
    const metadata = await this.fetchMetadata(reference.driveFileId, token);

    if (
      metadata.id !== reference.driveFileId ||
      typeof metadata.mimeType !== 'string' ||
      !SUPPORTED_IMAGE_TYPES.has(metadata.mimeType) ||
      metadata.capabilities?.canDownload !== true
    ) {
      throw new ExecutionError(
        'SOURCE_IMAGE_FETCH_BLOCK',
        'GENERATIVE_REFERENCE_DRIVE_METADATA_REJECTED',
        false,
      );
    }

    const bytes = await this.fetchBytes(reference.driveFileId, token);
    const contentType = metadata.mimeType as CreativeTruthReferenceContentType;
    if (!hasExpectedImageSignature(contentType, bytes)) {
      throw new ExecutionError(
        'SOURCE_IMAGE_BINDING_FAILURE',
        'GENERATIVE_REFERENCE_DRIVE_BYTES_INVALID',
        false,
      );
    }

    return {
      registry: reference,
      imageBytes: bytes,
      contentType,
    };
  }

  private async fetchMetadata(fileId: string, token: string): Promise<GoogleDriveFileMetadata> {
    const url = new URL(`${this.baseUrl}/files/${encodeURIComponent(fileId)}`);
    url.searchParams.set('fields', 'id,name,mimeType,size,capabilities(canDownload)');
    url.searchParams.set('supportsAllDrives', 'true');

    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    await assertDriveResponse(response, 'metadata');
    return (await response.json()) as GoogleDriveFileMetadata;
  }

  private async fetchBytes(fileId: string, token: string): Promise<Uint8Array> {
    const url = new URL(`${this.baseUrl}/files/${encodeURIComponent(fileId)}`);
    url.searchParams.set('alt', 'media');
    url.searchParams.set('supportsAllDrives', 'true');

    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    await assertDriveResponse(response, 'download');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new ExecutionError(
        'SOURCE_IMAGE_FETCH_BLOCK',
        'GENERATIVE_REFERENCE_DRIVE_DOWNLOAD_EMPTY',
        false,
      );
    }
    return bytes;
  }
}

function validateReferenceIdentity(reference: VenueReference): void {
  if (
    !reference.referenceSetId.trim() ||
    !reference.referenceId.trim() ||
    !reference.assetId.trim() ||
    !reference.driveFileId.trim() ||
    reference.status !== 'ACTIVE' ||
    !reference.venueVerified ||
    !reference.requiredForGenerativeException
  ) {
    throw new ExecutionError(
      'SOURCE_IMAGE_FETCH_BLOCK',
      'GENERATIVE_REFERENCE_DRIVE_IDENTITY_INVALID',
      false,
    );
  }
}

async function assertDriveResponse(response: Response, operation: string): Promise<void> {
  if (response.ok) return;
  const detail = (await safeResponseText(response)).slice(0, 400);
  const suffix = detail ? `:${detail}` : '';
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new ExecutionError(
      'SOURCE_IMAGE_FETCH_BLOCK',
      `GENERATIVE_REFERENCE_DRIVE_${operation.toUpperCase()}_BLOCKED:${response.status}${suffix}`,
      false,
    );
  }
  throw new ExecutionError(
    response.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_UNAVAILABLE',
    `GENERATIVE_REFERENCE_DRIVE_${operation.toUpperCase()}_FAILED:${response.status}${suffix}`,
    response.status === 429 || response.status >= 500,
  );
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function hasExpectedImageSignature(
  contentType: CreativeTruthReferenceContentType,
  bytes: Uint8Array,
): boolean {
  if (bytes.byteLength < 4) return false;
  if (contentType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (contentType === 'image/png') {
    return (
      bytes.byteLength >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  return (
    bytes.byteLength >= 12 &&
    ascii(bytes, 0, 4) === 'RIFF' &&
    ascii(bytes, 8, 12) === 'WEBP'
  );
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}
