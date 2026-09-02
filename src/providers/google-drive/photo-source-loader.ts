import { createHash } from 'node:crypto';
import { ExecutionError } from '../../core/errors.js';
import type { SecretReference, SecretResolver } from '../../core/secrets.js';

const DEFAULT_GOOGLE_DRIVE_BASE_URL = 'https://www.googleapis.com/drive/v3';
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type PhotoSourceContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface PhotoSourceDescriptor {
  readonly driveFileId: string;
}

export interface LoadedPhotoSource {
  readonly bytes: Uint8Array;
  readonly contentType: PhotoSourceContentType;
  readonly driveFileId: string;
  readonly sha256: string;
}

export interface PhotoSourceLoader {
  load(descriptor: PhotoSourceDescriptor): Promise<LoadedPhotoSource>;
}

export interface GoogleDrivePhotoSourceLoaderOptions {
  readonly secretResolver: SecretResolver;
  readonly accessTokenReference: SecretReference;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

interface GoogleDriveFileMetadata {
  readonly id?: unknown;
  readonly mimeType?: unknown;
  readonly capabilities?: { readonly canDownload?: unknown };
}

export class GoogleDrivePhotoSourceLoader implements PhotoSourceLoader {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GoogleDrivePhotoSourceLoaderOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_GOOGLE_DRIVE_BASE_URL).replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async load(descriptor: PhotoSourceDescriptor): Promise<LoadedPhotoSource> {
    const driveFileId = descriptor.driveFileId.trim();
    if (!driveFileId) {
      throw new ExecutionError(
        'SOURCE_IMAGE_BINDING_FAILURE',
        'PHOTO_SOURCE_DRIVE_FILE_ID_REQUIRED',
        false,
      );
    }

    const token = await this.options.secretResolver.resolve(this.options.accessTokenReference);
    const metadata = await this.fetchMetadata(driveFileId, token);
    if (
      metadata.id !== driveFileId ||
      typeof metadata.mimeType !== 'string' ||
      !SUPPORTED_IMAGE_TYPES.has(metadata.mimeType) ||
      metadata.capabilities?.canDownload !== true
    ) {
      throw new ExecutionError(
        'SOURCE_IMAGE_FETCH_BLOCK',
        'PHOTO_SOURCE_DRIVE_METADATA_REJECTED',
        false,
      );
    }

    const bytes = await this.fetchBytes(driveFileId, token);
    const contentType = metadata.mimeType as PhotoSourceContentType;
    if (!hasExpectedImageSignature(contentType, bytes)) {
      throw new ExecutionError(
        'SOURCE_IMAGE_BINDING_FAILURE',
        'PHOTO_SOURCE_DRIVE_BYTES_INVALID',
        false,
      );
    }

    return {
      bytes,
      contentType,
      driveFileId,
      sha256: sha256(bytes),
    };
  }

  private async fetchMetadata(fileId: string, token: string): Promise<GoogleDriveFileMetadata> {
    const url = new URL(`${this.baseUrl}/files/${encodeURIComponent(fileId)}`);
    url.searchParams.set('fields', 'id,mimeType,capabilities(canDownload)');
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
        'PHOTO_SOURCE_DRIVE_DOWNLOAD_EMPTY',
        false,
      );
    }
    return bytes;
  }
}

async function assertDriveResponse(response: Response, operation: string): Promise<void> {
  if (response.ok) return;
  const detail = (await safeText(response)).slice(0, 400);
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new ExecutionError(
      'SOURCE_IMAGE_FETCH_BLOCK',
      `PHOTO_SOURCE_DRIVE_${operation.toUpperCase()}_BLOCKED:${response.status}:${detail}`,
      false,
    );
  }
  throw new ExecutionError(
    response.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_UNAVAILABLE',
    `PHOTO_SOURCE_DRIVE_${operation.toUpperCase()}_FAILED:${response.status}:${detail}`,
    response.status === 429 || response.status >= 500,
  );
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hasExpectedImageSignature(contentType: PhotoSourceContentType, bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false;
  if (contentType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (contentType === 'image/png') {
    return (
      bytes.byteLength >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    );
  }
  return bytes.byteLength >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP';
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}
