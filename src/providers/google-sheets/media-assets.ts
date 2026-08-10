import type {
  MediaAssetSelectionRequest,
  MediaAssetSelectionResult,
  MediaAssetUsageRecord,
  RankedMediaAsset,
} from '../../contracts/media-assets.js';

export interface SpreadsheetValuesClient {
  readRange(spreadsheetId: string, range: string): Promise<readonly (readonly unknown[])[]>;
  appendRow(spreadsheetId: string, range: string, values: readonly unknown[]): Promise<void>;
}

export interface MediaAssetSheetsConfig {
  readonly spreadsheetId: string;
  readonly selectorSheet?: string;
  readonly usageLogSheet?: string;
}

const DEFAULT_SELECTOR_SHEET = 'ASSET_SELECTOR';
const DEFAULT_USAGE_LOG_SHEET = 'ASSET_USAGE_LOG';

function asString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value).trim();
  }
  throw new Error(`Unsupported spreadsheet value type: ${typeof value}`);
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  const number = Number(asString(value).replace(',', '.'));
  if (!Number.isFinite(number)) {
    throw new Error(`Invalid numeric spreadsheet value type: ${typeof value}`);
  }
  return number;
}

function normalizeTheme(value: string | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase('pt-BR');
}

export class GoogleSheetsMediaAssetAdapter {
  private readonly selectorSheet: string;
  private readonly usageLogSheet: string;

  constructor(
    private readonly client: SpreadsheetValuesClient,
    private readonly config: MediaAssetSheetsConfig,
  ) {
    this.selectorSheet = config.selectorSheet ?? DEFAULT_SELECTOR_SHEET;
    this.usageLogSheet = config.usageLogSheet ?? DEFAULT_USAGE_LOG_SHEET;
  }

  async rank(request: MediaAssetSelectionRequest): Promise<MediaAssetSelectionResult> {
    const contextRows = await this.client.readRange(
      this.config.spreadsheetId,
      `${this.selectorSheet}!A2:B3`,
    );
    const snapshotFormat = asString(contextRows[0]?.[1]);
    const snapshotTheme = normalizeTheme(asString(contextRows[1]?.[1]));

    if (snapshotFormat !== request.format || snapshotTheme !== normalizeTheme(request.theme)) {
      throw new Error(
        `ASSET_SELECTOR context mismatch: requested ${request.format}/${request.theme ?? ''}, ` +
          `snapshot is ${snapshotFormat}/${snapshotTheme}`,
      );
    }

    const rows = await this.client.readRange(
      this.config.spreadsheetId,
      `${this.selectorSheet}!A12:V440`,
    );

    const assets: RankedMediaAsset[] = rows
      .map((row) => ({
        assetId: asString(row[0]),
        driveFileId: asString(row[1]),
        cluster: asString(row[2]),
        score: asNumber(row[18] ?? 0),
        rank: asNumber(row[21] ?? 0),
      }))
      .filter(
        (asset) =>
          /^SUN-\d{4}$/.test(asset.assetId) &&
          asset.driveFileId.length > 0 &&
          asset.cluster.length > 0 &&
          asset.score > 0 &&
          Number.isInteger(asset.rank) &&
          asset.rank > 0,
      )
      .sort((a, b) => a.rank - b.rank || b.score - a.score)
      .slice(0, request.limit);

    return {
      contentItemId: request.contentItemId,
      format: request.format,
      ...(request.theme ? { theme: request.theme } : {}),
      source: 'TOCA_OS_ASSET_SELECTOR',
      assets,
    };
  }

  async recordUsage(record: MediaAssetUsageRecord): Promise<void> {
    const idempotencyKey = `${record.contentItemId}:${record.assetId}:${record.action}`;
    const existingRows = await this.client.readRange(
      this.config.spreadsheetId,
      `${this.usageLogSheet}!A2:I2000`,
    );

    const alreadyRecorded = existingRows.some((row) => asString(row[0]) === idempotencyKey);
    if (alreadyRecorded) return;

    await this.client.appendRow(this.config.spreadsheetId, `${this.usageLogSheet}!A:I`, [
      idempotencyKey,
      record.contentItemId,
      record.assetId,
      record.usedAt,
      record.format,
      record.channel ?? '',
      record.action,
      record.source,
      record.notes ?? '',
    ]);
  }
}
