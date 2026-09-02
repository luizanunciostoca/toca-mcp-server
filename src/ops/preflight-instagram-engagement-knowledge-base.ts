import type { SecretReference, SecretResolver } from '../core/secrets.js';
import {
  parseCanonicalKnowledgeSourceRegistry,
  type CanonicalKnowledgeSourceRegistryRow,
} from '../instagram-engagement/knowledge-base-ingest.js';
import {
  INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID,
} from '../instagram-engagement/knowledge-snapshot-current.js';
import {
  GOOGLE_SHEETS_READONLY_SCOPE,
  GOOGLE_WORKSPACE_SCOPED_TOKEN_PROVIDER,
  GcpGoogleWorkspaceTokenResolver,
} from '../providers/gcp/google-workspace-token-resolver.js';
import { GoogleDriveReadOnlyTextClient } from '../providers/google-drive/read-only-text-client.js';
import { GoogleSheetsRestClient } from '../providers/google-sheets/client.js';

const GOOGLE_DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export const INSTAGRAM_ENGAGEMENT_KB_PREFLIGHT_SOURCE_IDS = [
  'SRC-OPS-001',
  'SRC-MENU-002',
  'SRC-LOC-001',
] as const;

interface SheetsReader {
  readRange(spreadsheetId: string, range: string): Promise<readonly (readonly unknown[])[]>;
}

interface DriveReader {
  readText(fileId: string): Promise<{
    readonly id: string;
    readonly name: string;
    readonly mimeType: string;
    readonly modifiedTime?: string;
    readonly text: string;
  }>;
}

export interface InstagramKnowledgePreflightResult {
  readonly validation: 'instagram-engagement-knowledge-base-readonly-preflight';
  readonly status: 'PASS';
  readonly canonicalSpreadsheetMatched: true;
  readonly sourceCount: number;
  readonly documents: readonly {
    readonly sourceId: string;
    readonly mimeType: string;
    readonly bytes: number;
    readonly nonEmpty: true;
  }[];
  readonly databaseTouched: false;
  readonly providerWritesUsed: false;
  readonly sourceContentPrinted: false;
}

export async function runInstagramKnowledgeReadOnlyPreflight(
  sheets: SheetsReader,
  drive: DriveReader,
  spreadsheetId = INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID,
  sourceIds: readonly string[] = INSTAGRAM_ENGAGEMENT_KB_PREFLIGHT_SOURCE_IDS,
): Promise<InstagramKnowledgePreflightResult> {
  if (spreadsheetId !== INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID) {
    throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SPREADSHEET_MISMATCH');
  }
  const requested = new Set(sourceIds.map((value) => value.trim()).filter(Boolean));
  if (requested.size !== sourceIds.length || requested.size === 0) {
    throw new Error('INSTAGRAM_ENGAGEMENT_KB_PREFLIGHT_SOURCE_IDS_INVALID');
  }

  const values = await sheets.readRange(spreadsheetId, 'FONTES_CANONICAS!A:H');
  const registry = parseCanonicalKnowledgeSourceRegistry(values).filter((source) =>
    requested.has(source.sourceId),
  );
  validateExactSourceSet(registry, requested);

  const documents: InstagramKnowledgePreflightResult['documents'][number][] = [];
  for (const source of registry) {
    const exported = await drive.readText(source.driveId);
    const bytes = Buffer.byteLength(exported.text, 'utf8');
    if (bytes === 0 || !exported.text.trim()) {
      throw new Error(`INSTAGRAM_ENGAGEMENT_KB_SOURCE_EMPTY:${source.sourceId}`);
    }
    documents.push({
      sourceId: source.sourceId,
      mimeType: exported.mimeType,
      bytes,
      nonEmpty: true,
    });
  }

  return {
    validation: 'instagram-engagement-knowledge-base-readonly-preflight',
    status: 'PASS',
    canonicalSpreadsheetMatched: true,
    sourceCount: requested.size,
    documents,
    databaseTouched: false,
    providerWritesUsed: false,
    sourceContentPrinted: false,
  };
}

export function sanitizeInstagramKnowledgePreflightError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const known = raw.match(
    /(GOOGLE_WORKSPACE_[A-Z0-9_]+(?::[0-9]{3})?|GOOGLE_DRIVE_[A-Z0-9_]+(?::[0-9]{3})?|INSTAGRAM_ENGAGEMENT_KB_[A-Z0-9_]+(?::[A-Za-z0-9._-]+)?|INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SPREADSHEET_MISMATCH)/,
  )?.[1];
  if (known) return known;
  const sheetsStatus = raw.match(/Google Sheets read range failed with HTTP ([0-9]{3})/i)?.[1];
  if (sheetsStatus) return `GOOGLE_SHEETS_READ_RANGE_FAILED:${sheetsStatus}`;
  return 'INSTAGRAM_ENGAGEMENT_KB_PREFLIGHT_UNCLASSIFIED_FAILURE';
}

function validateExactSourceSet(
  registry: readonly CanonicalKnowledgeSourceRegistryRow[],
  requested: ReadonlySet<string>,
): void {
  if (registry.length !== requested.size) {
    throw new Error('INSTAGRAM_ENGAGEMENT_KB_SOURCE_SET_MISMATCH');
  }
  for (const source of registry) {
    if (!requested.has(source.sourceId)) {
      throw new Error('INSTAGRAM_ENGAGEMENT_KB_SOURCE_SET_MISMATCH');
    }
  }
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key}_REQUIRED`);
  return value;
}

function createRuntimeClients(env: NodeJS.ProcessEnv): {
  readonly sheets: GoogleSheetsRestClient;
  readonly drive: GoogleDriveReadOnlyTextClient;
} {
  const serviceAccountEmail = requiredEnv(
    env,
    'INSTAGRAM_ENGAGEMENT_GOOGLE_SERVICE_ACCOUNT_EMAIL',
  );
  const resolver: SecretResolver = new GcpGoogleWorkspaceTokenResolver({
    serviceAccountEmail,
    scopes: [GOOGLE_SHEETS_READONLY_SCOPE, GOOGLE_DRIVE_READONLY_SCOPE],
  });
  const tokenReference: SecretReference = {
    provider: GOOGLE_WORKSPACE_SCOPED_TOKEN_PROVIDER,
    key: 'kb-readonly-preflight',
  };
  return {
    sheets: new GoogleSheetsRestClient(resolver, { tokenReference }),
    drive: new GoogleDriveReadOnlyTextClient(resolver, tokenReference),
  };
}

if (process.argv[1]?.endsWith('preflight-instagram-engagement-knowledge-base.js')) {
  const spreadsheetId =
    process.env.INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SPREADSHEET_ID?.trim() ||
    INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID;
  const sourceIds = (
    process.env.INSTAGRAM_ENGAGEMENT_KB_SOURCE_IDS?.trim() ||
    INSTAGRAM_ENGAGEMENT_KB_PREFLIGHT_SOURCE_IDS.join(',')
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  try {
    const { sheets, drive } = createRuntimeClients(process.env);
    const result = await runInstagramKnowledgeReadOnlyPreflight(
      sheets,
      drive,
      spreadsheetId,
      sourceIds,
    );
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(
      JSON.stringify({
        validation: 'instagram-engagement-knowledge-base-readonly-preflight',
        status: 'FAIL',
        safeErrorCode: sanitizeInstagramKnowledgePreflightError(error),
        databaseTouched: false,
        providerWritesUsed: false,
        sourceContentPrinted: false,
      }),
    );
    process.exitCode = 1;
  }
}
