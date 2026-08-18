import {
  operationScopedGenerativeExceptionApprovalSchema,
  type OperationScopedGenerativeExceptionApproval,
  type TocaGenerativeVenueReferenceSetId,
} from '../../contracts/creative-truth-generative-reference-sets.js';
import type { VenueAsset, VenueReference } from '../../contracts/creative-truth.js';
import type { SpreadsheetValuesClient } from './media-assets.js';
import { GoogleSheetsCreativeTruthRegistry } from './creative-truth-registry.js';

const CREATIVE_TRUTH_REGISTRY_DRIVE_ID =
  '1bqF5zN5Lhesy_uls6gHMkOT-KLFRGo81OJMB_LPwXaU' as const;

export interface OperationScopedGenerativeRegistry {
  assertCanonicalPolicy(): Promise<void>;
  getApprovedGenerativeException(
    contentItemId: string,
  ): Promise<OperationScopedGenerativeExceptionApproval | undefined>;
  getReferenceSet(referenceSetId: TocaGenerativeVenueReferenceSetId): Promise<readonly VenueReference[]>;
  getVenueAssetBySourceAssetId(sourceAssetId: string): Promise<VenueAsset | undefined>;
}

export class GoogleSheetsOperationScopedGenerativeRegistry
  implements OperationScopedGenerativeRegistry
{
  private readonly spreadsheetId: string;
  private readonly base: GoogleSheetsCreativeTruthRegistry;

  constructor(
    private readonly client: SpreadsheetValuesClient,
    config: { readonly spreadsheetId?: string } = {},
  ) {
    this.spreadsheetId = config.spreadsheetId ?? CREATIVE_TRUTH_REGISTRY_DRIVE_ID;
    this.base = new GoogleSheetsCreativeTruthRegistry(client, {
      spreadsheetId: this.spreadsheetId,
    });
  }

  assertCanonicalPolicy(): Promise<void> {
    return this.base.assertCanonicalPolicy();
  }

  async getApprovedGenerativeException(
    contentItemId: string,
  ): Promise<OperationScopedGenerativeExceptionApproval | undefined> {
    const normalizedContentItemId = contentItemId.trim();
    if (!normalizedContentItemId) return undefined;

    const rows = await this.client.readRange(
      this.spreadsheetId,
      'GENERATIVE_EXCEPTIONS!A2:N1000',
    );
    const matches = rows.filter(
      (row) => cell(row[1]) === normalizedContentItemId && cell(row[11]) === 'APPROVED',
    );
    if (matches.length !== 1) return undefined;

    const row = matches[0]!;
    const expiresAt = cell(row[12]);
    return operationScopedGenerativeExceptionApprovalSchema.parse({
      exceptionId: cell(row[0]),
      contentItemId: cell(row[1]),
      requestedBy: cell(row[2]),
      approvedBy: cell(row[3]),
      approvalRef: cell(row[4]),
      reason: cell(row[5]),
      referenceSetId: cell(row[6]),
      minReferenceCount: integer(row[7], 3),
      allowArchitecturalInvention: bool(row[8]),
      allowEnvironmentDrift: bool(row[9]),
      allowAiLogoGeneration: bool(row[10]),
      status: cell(row[11]),
      ...(expiresAt ? { expiresAt } : {}),
      createdAt: cell(row[13]),
    });
  }

  getReferenceSet(
    referenceSetId: TocaGenerativeVenueReferenceSetId,
  ): Promise<readonly VenueReference[]> {
    return this.base.getReferenceSet(referenceSetId);
  }

  getVenueAssetBySourceAssetId(sourceAssetId: string): Promise<VenueAsset | undefined> {
    return this.base.getVenueAssetBySourceAssetId(sourceAssetId);
  }
}

function cell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value).trim();
  }
  throw new Error(`Unsupported spreadsheet value type: ${typeof value}`);
}

function bool(value: unknown): boolean {
  const normalized = cell(value).toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'sim';
}

function integer(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(cell(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
