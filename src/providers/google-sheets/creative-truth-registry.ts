import {
  CREATIVE_TRUTH_REGISTRY_DRIVE_ID,
  TOCA_CREATIVE_TRUTH_POLICY_ID,
  brandAssetSchema,
  creativeStandardSchema,
  generativeExceptionApprovalSchema,
  videoShotSchema,
  venueAssetSchema,
  venueReferenceSchema,
  type BrandAsset,
  type CreativeStandard,
  type GenerativeExceptionApproval,
  type VideoShot,
  type VenueAsset,
  type VenueReference,
  type CreativeTruthGateResult,
} from '../../contracts/creative-truth.js';
import type { SpreadsheetValuesClient } from './media-assets.js';

const CREATIVE_TRUTH_PLAN_DRIVE_ID = '1UR_LD8Gw4rlQkGsYh-VGW1ns8AzEx_m4fazpcCW-2wM';
const CANONICAL_DEFAULT_MODES = ['REAL_COMPOSITE', 'REAL_PLUS_ENHANCEMENT'] as const;
const MINIMUM_CREATIVE_TRUTH_POLICY_VERSION = '1.3' as const;

export interface CreativeTruthRegistryConfig {
  readonly spreadsheetId?: string;
}

export interface CreativeTruthGateLogRecord {
  readonly gateEventId: string;
  readonly contentItemId: string;
  readonly creativeId: string;
  readonly gate: CreativeTruthGateResult;
  readonly standardId: string;
  readonly creativeMode: string;
  readonly sourceAssetIds: readonly string[];
  readonly brandAssetIds: readonly string[];
  readonly outputSha256?: string;
  readonly createdAt: string;
}

export class GoogleSheetsCreativeTruthRegistry {
  private readonly spreadsheetId: string;

  constructor(
    private readonly client: SpreadsheetValuesClient,
    config: CreativeTruthRegistryConfig = {},
  ) {
    this.spreadsheetId = config.spreadsheetId ?? CREATIVE_TRUTH_REGISTRY_DRIVE_ID;
  }

  async assertCanonicalPolicy(): Promise<void> {
    const rows = await this.client.readRange(this.spreadsheetId, 'POLICY!A2:AK20');
    const matches = rows.filter((row) => cell(row[0]) === TOCA_CREATIVE_TRUTH_POLICY_ID);
    if (matches.length !== 1) throw new Error('TOCA_CREATIVE_TRUTH_POLICY_NOT_ACTIVE');
    const policy = matches[0]!;
    const defaultModes = list(policy[4]);
    const defaultModesCanonical =
      defaultModes.length === CANONICAL_DEFAULT_MODES.length &&
      CANONICAL_DEFAULT_MODES.every((mode) => defaultModes.includes(mode));

    if (
      !policyVersionAtLeast(cell(policy[1]), MINIMUM_CREATIVE_TRUTH_POLICY_VERSION) ||
      cell(policy[2]) !== 'ACTIVE_CANONICAL' ||
      cell(policy[3]) !== 'TOCA_DO_MORCEGO' ||
      !defaultModesCanonical ||
      cell(policy[5]) !== 'GENERATIVE_EXCEPTION' ||
      !bool(policy[6]) ||
      !bool(policy[7]) ||
      !bool(policy[8]) ||
      !bool(policy[9]) ||
      !bool(policy[10]) ||
      !bool(policy[11]) ||
      cell(policy[12]) !== CREATIVE_TRUTH_PLAN_DRIVE_ID ||
      !bool(policy[14]) ||
      cell(policy[29]) !== 'DENY' ||
      cell(policy[30]) !== 'NON_FINAL_BACKGROUND_CANDIDATE_ONLY' ||
      !bool(policy[31]) ||
      cell(policy[32]) !== 'DENY' ||
      cell(policy[33]) !== 'DENY' ||
      cell(policy[34]) !== 'FAIL_CLOSED_NO_FINAL_ASSET' ||
      cell(policy[35]) !== 'ENFORCED' ||
      cell(policy[36]) !== 'FAILED_DIRECT_GENERATIVE_FINALIZATION'
    ) {
      throw new Error('TOCA_CREATIVE_TRUTH_POLICY_NOT_ACTIVE');
    }
  }

  async getBrandAsset(brand: string, variant: string): Promise<BrandAsset | undefined> {
    const rows = await this.client.readRange(this.spreadsheetId, 'BRAND_ASSETS!A2:N1000');
    const matches = rows.filter(
      (candidate) => cell(candidate[1]) === brand && cell(candidate[2]) === variant,
    );
    if (matches.length !== 1) return undefined;
    const row = matches[0]!;
    const sha256 = cell(row[7]);
    return brandAssetSchema.parse({
      brandAssetId: cell(row[0]),
      brand: cell(row[1]),
      variant: cell(row[2]),
      driveFileId: cell(row[3]),
      fileName: cell(row[4]),
      contentType: cell(row[5]),
      integrityMode: cell(row[6]),
      ...(sha256 ? { sha256 } : {}),
      status: cell(row[9]),
      aiReconstructionAllowed: bool(row[12]),
    });
  }

  async listVenueAssets(operation?: string): Promise<readonly VenueAsset[]> {
    const rows = await this.client.readRange(this.spreadsheetId, 'VENUE_VISUALS!A2:P2000');
    return rows
      .filter((row) => !operation || cell(row[7]) === operation)
      .filter((row) => cell(row[14]) !== 'REVOKED')
      .map(parseVenueAsset);
  }

  async getVenueAsset(venueAssetId: string): Promise<VenueAsset | undefined> {
    const rows = await this.client.readRange(this.spreadsheetId, 'VENUE_VISUALS!A2:P2000');
    const matches = rows.filter((candidate) => cell(candidate[0]) === venueAssetId);
    if (matches.length !== 1) return undefined;
    return parseVenueAsset(matches[0]!);
  }

  async getVenueAssetBySourceAssetId(sourceAssetId: string): Promise<VenueAsset | undefined> {
    const normalizedSourceAssetId = sourceAssetId.trim();
    if (!normalizedSourceAssetId) return undefined;
    const rows = await this.client.readRange(this.spreadsheetId, 'VENUE_VISUALS!A2:P2000');
    const matches = rows.filter((candidate) => cell(candidate[1]) === normalizedSourceAssetId);
    if (matches.length !== 1) return undefined;
    return parseVenueAsset(matches[0]!);
  }

  async listVideoShots(operation?: string): Promise<readonly VideoShot[]> {
    const rows = await this.client.readRange(this.spreadsheetId, 'VIDEO_SHOTS!A2:Q2000');
    return rows
      .filter((row) => !operation || cell(row[7]) === operation)
      .filter((row) => cell(row[15]) !== 'REVOKED')
      .map(parseVideoShot);
  }

  async getVideoShot(shotId: string): Promise<VideoShot | undefined> {
    const rows = await this.client.readRange(this.spreadsheetId, 'VIDEO_SHOTS!A2:Q2000');
    const matches = rows.filter((candidate) => cell(candidate[0]) === shotId);
    if (matches.length !== 1) return undefined;
    return parseVideoShot(matches[0]!);
  }

  async getReferenceSet(referenceSetId: string): Promise<readonly VenueReference[]> {
    const rows = await this.client.readRange(this.spreadsheetId, 'VENUE_REFERENCE_SET!A2:J1000');
    return rows
      .filter((row) => cell(row[0]) === referenceSetId && cell(row[9]) === 'ACTIVE')
      .map((row) =>
        venueReferenceSchema.parse({
          referenceSetId: cell(row[0]),
          referenceId: cell(row[1]),
          assetId: cell(row[2]),
          driveFileId: cell(row[3]),
          referenceClass: cell(row[4]),
          purpose: cell(row[5]),
          requiredForGenerativeException: bool(row[6]),
          venueVerified: bool(row[7]),
          protectedElements: list(row[8]),
          status: cell(row[9]),
        }),
      );
  }

  async getCreativeStandard(standardId: string): Promise<CreativeStandard | undefined> {
    const rows = await this.client.readRange(this.spreadsheetId, 'CREATIVE_STANDARDS!A2:N1000');
    const matches = rows.filter((candidate) => cell(candidate[0]) === standardId);
    if (matches.length !== 1) return undefined;
    const row = matches[0]!;
    return creativeStandardSchema.parse({
      standardId: cell(row[0]),
      version: cell(row[1]),
      brandScope: cell(row[2]),
      operation: cell(row[3]),
      channel: cell(row[4]),
      format: cell(row[5]),
      parentPolicyId: cell(row[6]),
      canonicalDriveId: cell(row[7]),
      repoMirrorPath: cell(row[8]),
      status: cell(row[9]),
      realAssetRequired: bool(row[10]),
      deterministicBrandInsertion: bool(row[11]),
      venueFidelityGateRequired: bool(row[12]),
    });
  }

  async getApprovedGenerativeException(
    contentItemId: string,
  ): Promise<GenerativeExceptionApproval | undefined> {
    const rows = await this.client.readRange(
      this.spreadsheetId,
      'GENERATIVE_EXCEPTIONS!A2:N1000',
    );
    const matches = rows.filter(
      (candidate) => cell(candidate[1]) === contentItemId && cell(candidate[11]) === 'APPROVED',
    );
    if (matches.length !== 1) return undefined;
    const row = matches[0]!;
    const expiresAt = cell(row[12]);
    return generativeExceptionApprovalSchema.parse({
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

  async appendGateLog(record: CreativeTruthGateLogRecord): Promise<void> {
    await this.client.appendRow(this.spreadsheetId, 'GATE_LOG!A:N', [
      record.gateEventId,
      record.contentItemId,
      record.creativeId,
      record.gate.gate,
      record.gate.status,
      record.gate.failureCodes.join('|'),
      TOCA_CREATIVE_TRUTH_POLICY_ID,
      record.standardId,
      record.creativeMode,
      record.sourceAssetIds.join('|'),
      record.brandAssetIds.join('|'),
      record.outputSha256 ?? '',
      JSON.stringify(record.gate.evidence),
      record.createdAt,
    ]);
  }
}

function parseVenueAsset(row: readonly unknown[]): VenueAsset {
  const masterAssetId = cell(row[3]);
  const masterDriveFileId = cell(row[4]);
  const sourceSha256 = cell(row[5]);
  const masterSha256 = cell(row[6]);
  return venueAssetSchema.parse({
    venueAssetId: cell(row[0]),
    sourceAssetId: cell(row[1]),
    sourceDriveFileId: cell(row[2]),
    ...(masterAssetId ? { masterAssetId } : {}),
    ...(masterDriveFileId ? { masterDriveFileId } : {}),
    ...(sourceSha256 ? { sourceSha256 } : {}),
    ...(masterSha256 ? { masterSha256 } : {}),
    operation: cell(row[7]),
    locationSignature: cell(row[8]),
    dominantSubject: cell(row[9]),
    venueVerified: bool(row[10]),
    marketingReady: bool(row[11]),
    generativeReferenceAllowed: bool(row[12]),
    protectedElements: list(row[13]),
    status: cell(row[14]),
  });
}

function parseVideoShot(row: readonly unknown[]): VideoShot {
  const masterAssetId = cell(row[3]);
  const masterDriveFileId = cell(row[4]);
  const sourceSha256 = cell(row[5]);
  const masterSha256 = cell(row[6]);
  const duration = cell(row[10]);
  return videoShotSchema.parse({
    shotId: cell(row[0]),
    sourceAssetId: cell(row[1]),
    sourceDriveFileId: cell(row[2]),
    ...(masterAssetId ? { masterAssetId } : {}),
    ...(masterDriveFileId ? { masterDriveFileId } : {}),
    ...(sourceSha256 ? { sourceSha256 } : {}),
    ...(masterSha256 ? { masterSha256 } : {}),
    operation: cell(row[7]),
    locationSignature: cell(row[8]),
    dominantSubject: cell(row[9]),
    ...(duration ? { durationMs: integer(row[10], 0) } : {}),
    orientation: cell(row[11]),
    venueVerified: bool(row[12]),
    marketingReady: bool(row[13]),
    rightsStatus: cell(row[14]),
    status: cell(row[15]),
    notes: cell(row[16]),
  });
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

function list(value: unknown): string[] {
  return cell(value)
    .split('|')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function policyVersionAtLeast(actual: string, minimum: string): boolean {
  const actualParts = actual.split('.').map((part) => Number.parseInt(part, 10));
  const minimumParts = minimum.split('.').map((part) => Number.parseInt(part, 10));
  if (
    actualParts.some((part) => !Number.isFinite(part)) ||
    minimumParts.some((part) => !Number.isFinite(part))
  ) {
    return false;
  }
  const width = Math.max(actualParts.length, minimumParts.length);
  for (let index = 0; index < width; index += 1) {
    const left = actualParts[index] ?? 0;
    const right = minimumParts[index] ?? 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return true;
}
