import type { SecretReference, SecretResolver } from '../../core/secrets.js';

const DRIVE_BASE_URL = 'https://www.googleapis.com/drive/v3';

interface DriveFileMetadata {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly mimeType?: unknown;
  readonly modifiedTime?: unknown;
}

export interface GoogleDriveTextDocument {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly modifiedTime?: string;
  readonly text: string;
}

export class GoogleDriveReadOnlyTextClient {
  constructor(
    private readonly resolver: SecretResolver,
    private readonly tokenReference: SecretReference,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async readText(fileId: string): Promise<GoogleDriveTextDocument> {
    const id = fileId.trim();
    if (!id) throw new Error('GOOGLE_DRIVE_FILE_ID_REQUIRED');
    const token = await this.resolver.resolve(this.tokenReference);
    const metadataResponse = await this.fetchImpl(
      `${DRIVE_BASE_URL}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,modifiedTime&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!metadataResponse.ok) {
      throw new Error(`GOOGLE_DRIVE_METADATA_FAILED:${metadataResponse.status}`);
    }
    const metadata = (await metadataResponse.json()) as DriveFileMetadata;
    const mimeType = stringField(metadata.mimeType, 'GOOGLE_DRIVE_MIME_TYPE_MISSING');
    const name = stringField(metadata.name, 'GOOGLE_DRIVE_NAME_MISSING');
    const modifiedTime = optionalString(metadata.modifiedTime);
    const text = await this.exportText(id, mimeType, token);
    return { id, name, mimeType, ...(modifiedTime ? { modifiedTime } : {}), text };
  }

  private async exportText(fileId: string, mimeType: string, token: string): Promise<string> {
    const nativeExport = exportMimeType(mimeType);
    const endpoint = nativeExport
      ? `${DRIVE_BASE_URL}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(nativeExport)}`
      : `${DRIVE_BASE_URL}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
    const response = await this.fetchImpl(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`GOOGLE_DRIVE_EXPORT_FAILED:${response.status}`);
    const text = await response.text();
    if (!text.trim()) throw new Error('GOOGLE_DRIVE_EXPORT_EMPTY');
    if (text.length > 2_000_000) throw new Error('GOOGLE_DRIVE_EXPORT_TOO_LARGE');
    return text.replace(/^\uFEFF/, '');
  }
}

function exportMimeType(mimeType: string): string | undefined {
  if (mimeType === 'application/vnd.google-apps.document') return 'text/plain';
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return 'text/csv';
  if (mimeType === 'application/vnd.google-apps.presentation') return 'text/plain';
  return undefined;
}

function stringField(value: unknown, errorCode: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(errorCode);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
