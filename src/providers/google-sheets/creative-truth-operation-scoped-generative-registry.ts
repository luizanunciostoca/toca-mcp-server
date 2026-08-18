import {
  LEGACY_TOCA_VENUE_REFERENCE_SET_ID,
  TOCA_SUNSET_VENUE_REFERENCE_SET_ID,
  TOCA_THE_PARTY_VENUE_REFERENCE_SET_ID,
  operationScopedGenerativeExceptionApprovalSchema,
  referenceSetOperation,
  type OperationScopedGenerativeExceptionApproval,
  type TocaGenerativeOperation,
  type TocaGenerativeVenueReferenceSetId,
} from '../../contracts/creative-truth-generative-reference-sets.js';
import {
  TOCA_CREATIVE_TRUTH_POLICY_ID,
  type VenueAsset,
  type VenueReference,
} from '../../contracts/creative-truth.js';
import { ExecutionError } from '../../core/errors.js';
import type { SpreadsheetValuesClient } from './media-assets.js';
import { GoogleSheetsCreativeTruthRegistry } from './creative-truth-registry.js';

const CREATIVE_TRUTH_REGISTRY_DRIVE_ID =
  '1bqF5zN5Lhesy_uls6gHMkOT-KLFRGo81OJMB_LPwXaU' as const;
const MARKETING_CONTENT_REGISTRY_DRIVE_ID =
  '1r02HLhmnTijFNkmZv4o1yeZPxCEUMXZC_QreDFB6yTw' as const;
const POLICY_RANGE = 'POLICY!A2:Z20';
const REFERENCE_SET_RANGE = 'VENUE_REFERENCE_SET!A2:K1000';
const GENERATIVE_EXCEPTIONS_RANGE = 'GENERATIVE_EXCEPTIONS!A2:O1000';
const CONTENT_OPERATION_RANGE = 'CONTENT_ITEMS!A2:E2000';
const MIN_ACTIVE_OPERATION_REFERENCES = 3;

export interface OperationScopedGenerativeRegistry {
  assertCanonicalPolicy(): Promise<void>;
  getContentItemOperation(contentItemId: string): Promise<TocaGenerativeOperation | undefined>;
  getApprovedGenerativeException(
    contentItemId: string,
  ): Promise<OperationScopedGenerativeExceptionApproval | undefined>;
  getReferenceSet(
    referenceSetId: TocaGenerativeVenueReferenceSetId,
  ): Promise<readonly VenueReference[]>;
  getVenueAssetBySourceAssetId(sourceAssetId: string): Promise<VenueAsset | undefined>;
}

export interface OperationScopedGenerativeRegistryConfig {
  readonly spreadsheetId?: string;
  readonly contentSpreadsheetId?: string;
}

export class GoogleSheetsOperationScopedGenerativeRegistry
  implements OperationScopedGenerativeRegistry
{
  private readonly spreadsheetId: string;
  private readonly contentSpreadsheetId: string;
  private readonly base: GoogleSheetsCreativeTruthRegistry;

  constructor(
    private readonly client: SpreadsheetValuesClient,
    config: OperationScopedGenerativeRegistryConfig = {},
  ) {
    this.spreadsheetId = config.spreadsheetId ?? CREATIVE_TRUTH_REGISTRY_DRIVE_ID;
    this.contentSpreadsheetId =
      config.contentSpreadsheetId ?? MARKETING_CONTENT_REGISTRY_DRIVE_ID;
    this.base = new GoogleSheetsCreativeTruthRegistry(client, {
      spreadsheetId: this.spreadsheetId,
    });
  }

  async assertCanonicalPolicy(): Promise<void> {
    const [policyRows, referenceRows] = await Promise.all([
      this.client.readRange(this.spreadsheetId, POLICY_RANGE),
      this.client.readRange(this.spreadsheetId, REFERENCE_SET_RANGE),
    ]);
    await this.base.assertCanonicalPolicy();

    assertOperationScopedPolicy(policyRows);
    assertLegacyReferenceSetDeprecated(referenceRows);
    assertReferenceSetScope(TOCA_SUNSET_VENUE_REFERENCE_SET_ID, referenceRows);
    assertReferenceSetScope(TOCA_THE_PARTY_VENUE_REFERENCE_SET_ID, referenceRows);
  }

  async getContentItemOperation(
    contentItemId: string,
  ): Promise<TocaGenerativeOperation | undefined> {
    const normalizedContentItemId = contentItemId.trim();
    if (!normalizedContentItemId) return undefined;

    const rows = await this.client.readRange(
      this.contentSpreadsheetId,
      CONTENT_OPERATION_RANGE,
    );
    const matches = rows.filter((row) => cell(row[0]) === normalizedContentItemId);
    if (matches.length === 0) return undefined;
    if (matches.length !== 1) {
      deny('FAILED_GENERATIVE_CONTENT_OPERATION_AMBIGUOUS');
    }

    const operation = cell(matches[0]![4]);
    if (operation === 'SUNSET' || operation === 'THE_PARTY') return operation;
    deny('FAILED_GENERATIVE_CONTENT_OPERATION_UNSUPPORTED');
  }

  async getApprovedGenerativeException(
    contentItemId: string,
  ): Promise<OperationScopedGenerativeExceptionApproval | undefined> {
    const normalizedContentItemId = contentItemId.trim();
    if (!normalizedContentItemId) return undefined;

    const rows = await this.client.readRange(this.spreadsheetId, GENERATIVE_EXCEPTIONS_RANGE);
    const matches = rows.filter(
      (row) => cell(row[1]) === normalizedContentItemId && cell(row[11]) === 'APPROVED',
    );
    if (matches.length !== 1) return undefined;

    const row = matches[0]!;
    const expiresAt = cell(row[12]);
    const parsed = operationScopedGenerativeExceptionApprovalSchema.safeParse({
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
      operation: cell(row[14]),
    });
    if (!parsed.success) {
      const operationMismatch = parsed.error.issues.some(
        (issue) => issue.message === 'FAILED_GENERATIVE_REFERENCE_SET_OPERATION_MISMATCH',
      );
      throw new ExecutionError(
        'POLICY_DENIED',
        operationMismatch
          ? 'FAILED_GENERATIVE_REFERENCE_SET_OPERATION_MISMATCH'
          : 'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
        false,
      );
    }
    return parsed.data;
  }

  async getReferenceSet(
    referenceSetId: TocaGenerativeVenueReferenceSetId,
  ): Promise<readonly VenueReference[]> {
    const rows = await this.client.readRange(this.spreadsheetId, REFERENCE_SET_RANGE);
    assertReferenceSetScope(referenceSetId, rows);
    return this.base.getReferenceSet(referenceSetId);
  }

  getVenueAssetBySourceAssetId(sourceAssetId: string): Promise<VenueAsset | undefined> {
    return this.base.getVenueAssetBySourceAssetId(sourceAssetId);
  }
}

function assertOperationScopedPolicy(rows: readonly (readonly unknown[])[]): void {
  const matches = rows.filter((row) => cell(row[0]) === TOCA_CREATIVE_TRUTH_POLICY_ID);
  if (matches.length !== 1) deny('FAILED_GENERATIVE_REFERENCE_SET_POLICY_DRIFT');
  const row = matches[0]!;
  const expected: readonly [number, string][] = [
    [18, 'OPERATION_SCOPED_ONLY_V1'],
    [19, LEGACY_TOCA_VENUE_REFERENCE_SET_ID],
    [20, 'DEPRECATED'],
    [21, TOCA_SUNSET_VENUE_REFERENCE_SET_ID],
    [22, TOCA_THE_PARTY_VENUE_REFERENCE_SET_ID],
    [23, 'FORBIDDEN'],
    [24, 'REQUIRED'],
    [25, 'DENY'],
  ];
  for (const [index, value] of expected) {
    if (cell(row[index]) !== value) deny('FAILED_GENERATIVE_REFERENCE_SET_POLICY_DRIFT');
  }
}

function assertLegacyReferenceSetDeprecated(rows: readonly (readonly unknown[])[]): void {
  const legacyRows = rows.filter((row) => cell(row[1]) === LEGACY_TOCA_VENUE_REFERENCE_SET_ID);
  if (legacyRows.length === 0) deny('FAILED_GENERATIVE_REFERENCE_SET_DEPRECATED');
  if (
    legacyRows.some(
      (row) => cell(row[9]) !== 'DEPRECATED' || cell(row[10]) !== 'LEGACY_DEPRECATED',
    )
  ) {
    deny('FAILED_GENERATIVE_REFERENCE_SET_DEPRECATED');
  }
}

function assertReferenceSetScope(
  referenceSetId: TocaGenerativeVenueReferenceSetId,
  rows: readonly (readonly unknown[])[],
): void {
  const expectedOperation = referenceSetOperation(referenceSetId);
  const setRows = rows.filter((row) => cell(row[1]) === referenceSetId);
  if (setRows.length === 0) deny('FAILED_GENERATIVE_REFERENCE_MISSING');
  if (setRows.some((row) => cell(row[10]) !== expectedOperation)) {
    deny('FAILED_GENERATIVE_REFERENCE_SET_OPERATION_MISMATCH');
  }
  const activeCount = setRows.filter((row) => cell(row[9]) === 'ACTIVE').length;
  if (activeCount < MIN_ACTIVE_OPERATION_REFERENCES) {
    deny('FAILED_GENERATIVE_REFERENCE_MISSING');
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

function deny(message: string): never {
  throw new ExecutionError('POLICY_DENIED', message, false);
}
