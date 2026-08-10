import type {
  MediaAssetSelectionRequest,
  MediaAssetSelectionResult,
  MediaAssetUsageRecord,
} from '../../contracts/media-assets.js';
import { parseMediaRankingPolicy, rankMediaAssets } from './media-ranking.js';

export interface SpreadsheetValuesClient {
  readRange(spreadsheetId: string, range: string): Promise<readonly (readonly unknown[])[]>;
  appendRow(spreadsheetId: string, range: string, values: readonly unknown[]): Promise<void>;
}

export interface MediaAssetSheetsConfig {
  readonly spreadsheetId: string;
  readonly intelligenceSheet?: string;
  readonly rankingPolicySheet?: string;
  readonly usageLogSheet?: string;
}

const DEFAULT_INTELLIGENCE_SHEET = 'ASSET_INTELLIGENCE';
const DEFAULT_RANKING_POLICY_SHEET = 'ASSET_RANKING_POLICY';
const DEFAULT_USAGE_LOG_SHEET = 'ASSET_USAGE_LOG';

function asString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value).trim();
  }
  throw new Error(`Unsupported spreadsheet value type: ${typeof value}`);
}

export class GoogleSheetsMediaAssetAdapter {
  private readonly intelligenceSheet: string;
  private readonly rankingPolicySheet: string;
  private readonly usageLogSheet: string;

  constructor(
    private readonly client: SpreadsheetValuesClient,
    private readonly config: MediaAssetSheetsConfig,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.intelligenceSheet = config.intelligenceSheet ?? DEFAULT_INTELLIGENCE_SHEET;
    this.rankingPolicySheet = config.rankingPolicySheet ?? DEFAULT_RANKING_POLICY_SHEET;
    this.usageLogSheet = config.usageLogSheet ?? DEFAULT_USAGE_LOG_SHEET;
  }

  async rank(request: MediaAssetSelectionRequest): Promise<MediaAssetSelectionResult> {
    const [policyRows, assetRows] = await Promise.all([
      this.client.readRange(this.config.spreadsheetId, `${this.rankingPolicySheet}!A2:B100`),
      this.client.readRange(this.config.spreadsheetId, `${this.intelligenceSheet}!A2:AD1000`),
    ]);
    const policy = parseMediaRankingPolicy(policyRows);
    const assets = rankMediaAssets(request, assetRows, policy, this.now());

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
