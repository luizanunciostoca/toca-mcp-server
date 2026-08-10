import type {
  MediaAssetFormat,
  MediaAssetSelectionRequest,
  RankedMediaAsset,
} from '../../contracts/media-assets.js';

export interface MediaRankingPolicy {
  readonly version: string;
  readonly requiredAssetStatus: string;
  readonly weightFormat: number;
  readonly weightBrandAlignment: number;
  readonly weightTechnicalQuality: number;
  readonly weightTextSpace: number;
  readonly weightCropFlexibility: number;
  readonly weightNovelty: number;
  readonly weightTheme: number;
  readonly themeScoreEmpty: number;
  readonly themeScoreMatch: number;
  readonly themeScoreMiss: number;
  readonly useCountPenaltyPerUse: number;
  readonly antiRepeatFloor: number;
  readonly similarityPenaltyFactor: number;
  readonly recencyDays1: number;
  readonly recencyFactor1: number;
  readonly recencyDays2: number;
  readonly recencyFactor2: number;
  readonly recencyDays3: number;
  readonly recencyFactor3: number;
  readonly recencyFactorDefault: number;
  readonly maxResultLimit: number;
}

function valueToString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value).trim();
  }
  throw new Error(`Unsupported spreadsheet value type: ${typeof value}`);
}

function valueToNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  const number = Number(valueToString(value).replace(',', '.'));
  if (!Number.isFinite(number)) {
    throw new Error(`Invalid numeric spreadsheet value type: ${typeof value}`);
  }
  return number;
}

function policyNumber(values: ReadonlyMap<string, unknown>, key: string): number {
  if (!values.has(key)) throw new Error(`Missing ranking policy key: ${key}`);
  return valueToNumber(values.get(key));
}

function policyString(values: ReadonlyMap<string, unknown>, key: string): string {
  if (!values.has(key)) throw new Error(`Missing ranking policy key: ${key}`);
  const value = valueToString(values.get(key));
  if (!value) throw new Error(`Empty ranking policy key: ${key}`);
  return value;
}

export function parseMediaRankingPolicy(
  rows: readonly (readonly unknown[])[],
): MediaRankingPolicy {
  const values = new Map<string, unknown>();
  for (const row of rows) {
    const key = valueToString(row[0]);
    if (key) values.set(key, row[1]);
  }

  const policy: MediaRankingPolicy = {
    version: policyString(values, 'POLICY_VERSION'),
    requiredAssetStatus: policyString(values, 'REQUIRED_ASSET_STATUS'),
    weightFormat: policyNumber(values, 'WEIGHT_FORMAT'),
    weightBrandAlignment: policyNumber(values, 'WEIGHT_BRAND_ALIGNMENT'),
    weightTechnicalQuality: policyNumber(values, 'WEIGHT_TECHNICAL_QUALITY'),
    weightTextSpace: policyNumber(values, 'WEIGHT_TEXT_SPACE'),
    weightCropFlexibility: policyNumber(values, 'WEIGHT_CROP_FLEXIBILITY'),
    weightNovelty: policyNumber(values, 'WEIGHT_NOVELTY'),
    weightTheme: policyNumber(values, 'WEIGHT_THEME'),
    themeScoreEmpty: policyNumber(values, 'THEME_SCORE_EMPTY'),
    themeScoreMatch: policyNumber(values, 'THEME_SCORE_MATCH'),
    themeScoreMiss: policyNumber(values, 'THEME_SCORE_MISS'),
    useCountPenaltyPerUse: policyNumber(values, 'USE_COUNT_PENALTY_PER_USE'),
    antiRepeatFloor: policyNumber(values, 'ANTI_REPEAT_FLOOR'),
    similarityPenaltyFactor: policyNumber(values, 'SIMILARITY_PENALTY_FACTOR'),
    recencyDays1: policyNumber(values, 'RECENCY_DAYS_1'),
    recencyFactor1: policyNumber(values, 'RECENCY_FACTOR_1'),
    recencyDays2: policyNumber(values, 'RECENCY_DAYS_2'),
    recencyFactor2: policyNumber(values, 'RECENCY_FACTOR_2'),
    recencyDays3: policyNumber(values, 'RECENCY_DAYS_3'),
    recencyFactor3: policyNumber(values, 'RECENCY_FACTOR_3'),
    recencyFactorDefault: policyNumber(values, 'RECENCY_FACTOR_DEFAULT'),
    maxResultLimit: policyNumber(values, 'MAX_RESULT_LIMIT'),
  };

  const weightSum =
    policy.weightFormat +
    policy.weightBrandAlignment +
    policy.weightTechnicalQuality +
    policy.weightTextSpace +
    policy.weightCropFlexibility +
    policy.weightNovelty +
    policy.weightTheme;
  if (Math.abs(weightSum - 1) > 0.000001) {
    throw new Error(`Ranking policy weights must sum to 1; received ${weightSum}`);
  }
  if (!Number.isInteger(policy.maxResultLimit) || policy.maxResultLimit < 1) {
    throw new Error('MAX_RESULT_LIMIT must be a positive integer');
  }

  return policy;
}

function formatScore(row: readonly unknown[], format: MediaAssetFormat): number {
  const columnByFormat: Record<MediaAssetFormat, number> = {
    FEED: 10,
    STORIES: 11,
    REEL_COVER: 12,
    AD: 13,
  };
  return valueToNumber(row[columnByFormat[format]] ?? 0);
}

function themeScore(
  row: readonly unknown[],
  theme: string | undefined,
  policy: MediaRankingPolicy,
): number {
  const normalizedTheme = (theme ?? '').trim().toLocaleLowerCase('pt-BR');
  if (!normalizedTheme) return policy.themeScoreEmpty;

  const haystack = [row[5], row[6], row[7], row[27]]
    .map((value) => valueToString(value).toLocaleLowerCase('pt-BR'))
    .join(' ');
  return haystack.includes(normalizedTheme) ? policy.themeScoreMatch : policy.themeScoreMiss;
}

function parseLastUsed(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (value <= 0) return null;
    const googleSheetsEpoch = Date.UTC(1899, 11, 30);
    return new Date(googleSheetsEpoch + value * 86_400_000);
  }
  const text = valueToString(value);
  if (!text) return null;
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid LAST_USED_AT value: ${text}`);
  return new Date(timestamp);
}

function recencyFactor(lastUsed: Date | null, now: Date, policy: MediaRankingPolicy): number {
  if (!lastUsed) return policy.recencyFactorDefault;
  const days = Math.floor((now.getTime() - lastUsed.getTime()) / 86_400_000);
  if (days < policy.recencyDays1) return policy.recencyFactor1;
  if (days < policy.recencyDays2) return policy.recencyFactor2;
  if (days < policy.recencyDays3) return policy.recencyFactor3;
  return policy.recencyFactorDefault;
}

function antiRepeatScore(
  row: readonly unknown[],
  now: Date,
  policy: MediaRankingPolicy,
): number {
  const useCount = Math.max(0, valueToNumber(row[23] ?? 0));
  const usageScore = Math.max(
    policy.antiRepeatFloor,
    100 - useCount * policy.useCountPenaltyPerUse,
  );
  const similarity = Math.min(1, Math.max(0, valueToNumber(row[29] ?? 0)));
  const similarityFactor = 1 - similarity * policy.similarityPenaltyFactor;
  const lastUsed = parseLastUsed(row[22]);
  return usageScore * similarityFactor * recencyFactor(lastUsed, now, policy);
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

export function rankMediaAssets(
  request: MediaAssetSelectionRequest,
  rows: readonly (readonly unknown[])[],
  policy: MediaRankingPolicy,
  now: Date,
): RankedMediaAsset[] {
  const candidates = rows.flatMap((row) => {
    const assetId = valueToString(row[0]);
    const driveFileId = valueToString(row[1]);
    const cluster = valueToString(row[2]);
    const status = valueToString(row[26]);
    if (
      !/^SUN-\d{4}$/.test(assetId) ||
      !driveFileId ||
      !cluster ||
      status !== policy.requiredAssetStatus
    ) {
      return [];
    }

    const baseScore =
      formatScore(row, request.format) * policy.weightFormat +
      valueToNumber(row[19] ?? 0) * policy.weightBrandAlignment +
      valueToNumber(row[20] ?? 0) * policy.weightTechnicalQuality +
      valueToNumber(row[17] ?? 0) * policy.weightTextSpace +
      valueToNumber(row[18] ?? 0) * policy.weightCropFlexibility +
      valueToNumber(row[21] ?? 0) * policy.weightNovelty +
      themeScore(row, request.theme, policy) * policy.weightTheme;
    const score = roundScore((baseScore * antiRepeatScore(row, now, policy)) / 100);

    return [{ assetId, driveFileId, cluster, score }];
  });

  candidates.sort((left, right) => right.score - left.score || left.assetId.localeCompare(right.assetId));
  const limit = Math.min(request.limit, policy.maxResultLimit);
  return candidates.slice(0, limit).map((asset, index) => ({ ...asset, rank: index + 1 }));
}
