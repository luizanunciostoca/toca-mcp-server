import { createHash } from 'node:crypto';
import {
  VIDEO_ASSET_SELECTION_POLICY_VERSION,
  videoAssetSelectionRequestSchema,
  videoAssetSelectionResultSchema,
  videoAssetUsageRecordSchema,
  type SelectedVideoAsset,
  type VideoAssetSelectionRequest,
  type VideoAssetSelectionResult,
  type VideoAssetUsageRecord,
  type VideoSourceType,
  type VideoStoryFunction,
} from '../contracts/video-asset-selection.js';
import { ExecutionError } from '../core/errors.js';
import type {
  SpreadsheetValuesBatchWriter,
  SpreadsheetValuesClient,
} from '../providers/google-sheets/media-assets.js';

const CREATIVE_TRUTH_SPREADSHEET_ID = '1bqF5zN5Lhesy_uls6gHMkOT-KLFRGo81OJMB_LPwXaU';
const VIDEO_SHOTS_RANGE = 'VIDEO_SHOTS!A1:AV5000';
const VIDEO_POLICY_RANGE = 'VIDEO_RANKING_POLICY!A1:E100';
const VIDEO_USAGE_RANGE = 'VIDEO_USAGE_LOG!A1:N5000';
const VIDEO_REQUEST_APPEND_RANGE = 'VIDEO_SELECTION_REQUESTS!A:R';
const VIDEO_SELECTOR_APPEND_RANGE = 'VIDEO_ASSET_SELECTOR!A:AB';
const VIDEO_USAGE_APPEND_RANGE = 'VIDEO_USAGE_LOG!A:N';
const APPROVED_RIGHTS = new Set(['OWNED', 'LICENSED', 'CLEARED', 'RIGHTS_CLEARED']);
const SELECTION_STATUSES = new Set(['ACTIVE_APPROVED', 'VENUE_VERIFIED_MARKETING_READY']);

interface CanonicalShot {
  readonly rowNumber: number;
  readonly shotId: string;
  readonly driveFileId: string;
  readonly driveUrl: string;
  readonly sourceLibraryId: string;
  readonly sourceType: VideoSourceType;
  readonly operation: string;
  readonly eventEdition: string;
  readonly storyFunctions: readonly VideoStoryFunction[];
  readonly energy: string;
  readonly technicalScore: number;
  readonly tags: readonly string[];
  readonly textContext: string;
  readonly usageCount: number;
  readonly lastUsedAt: string;
  readonly visualClusterId: string;
  readonly rightsStatus: string;
  readonly rightsEligibility: string;
  readonly generativeEligibility: string;
  readonly discoverable: boolean;
  readonly creativeEligible: boolean;
  readonly marketingReady: boolean;
  readonly venueVerified: boolean;
  readonly status: string;
}

interface RankingPolicy {
  readonly storyFunction: number;
  readonly technicalQuality: number;
  readonly briefFit: number;
  readonly energy: number;
  readonly productEvent: number;
  readonly freshness: number;
  readonly antiRepeat: number;
  readonly useCountPenalty: number;
  readonly antiRepeatFloor: number;
  readonly similarityPenaltyFactor: number;
  readonly recency: readonly { days: number; factor: number }[];
  readonly recencyDefault: number;
  readonly topPickMin: number;
  readonly strongMin: number;
  readonly validMin: number;
  readonly maxResultLimit: number;
}

interface ScoredShot {
  readonly shot: CanonicalShot;
  readonly matchedRequiredFunctions: readonly VideoStoryFunction[];
  readonly storyFunctionScore: number;
  readonly technicalScore: number;
  readonly briefFitScore: number;
  readonly energyScore: number;
  readonly productEventScore: number;
  readonly freshnessScore: number;
  readonly antiRepeatScore: number;
  readonly finalScore: number;
  readonly selectionStatus: 'TOP_PICK' | 'STRONG' | 'VALID' | 'REJECT';
}

export class IntelligentVideoAssetSelectorService {
  constructor(
    private readonly client: SpreadsheetValuesClient & SpreadsheetValuesBatchWriter,
    private readonly spreadsheetId = CREATIVE_TRUTH_SPREADSHEET_ID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async select(input: VideoAssetSelectionRequest): Promise<VideoAssetSelectionResult> {
    const request = videoAssetSelectionRequestSchema.parse(input);
    const generatedAt = trustedNow(this.now).toISOString();
    const requestId = request.requestId ?? createRequestId(request, generatedAt);
    const [shotRows, policyRows] = await Promise.all([
      this.client.readRange(this.spreadsheetId, VIDEO_SHOTS_RANGE),
      this.client.readRange(this.spreadsheetId, VIDEO_POLICY_RANGE),
    ]);
    const shots = parseShots(shotRows);
    const policy = parsePolicy(policyRows);
    const maxResults = Math.min(request.maxResults, policy.maxResultLimit);

    const eligible = shots.filter((shot) => isEligible(shot, request));
    const scored = eligible
      .map((shot) => scoreShot(shot, request, policy, generatedAt, eligible))
      .filter((candidate) => candidate.selectionStatus !== 'REJECT')
      .sort(compareScoredShots);

    const missingStoryFunctions = request.requiredStoryFunctions.filter(
      (storyFunction) =>
        !scored.some((candidate) => candidate.shot.storyFunctions.includes(storyFunction)),
    );
    const chosen = chooseCoverageFirst(scored, request.requiredStoryFunctions, maxResults);
    const selectedAssets = chosen.map((candidate, index) => toSelectedAsset(candidate, index + 1));
    const coverageStatus =
      missingStoryFunctions.length === 0 ? 'COMPLETE' : 'VIDEO_COVERAGE_GAP';

    await this.recordSelectionAudit({
      requestId,
      request,
      generatedAt,
      coverageStatus,
      missingStoryFunctions,
      chosen,
    });

    return videoAssetSelectionResultSchema.parse({
      requestId,
      policyVersion: VIDEO_ASSET_SELECTION_POLICY_VERSION,
      coverageStatus,
      missingStoryFunctions,
      selectedAssets,
      exactDriveFileIds: selectedAssets.map((asset) => asset.driveFileId),
      sourceLibraryScanUsed: false,
      intakeAssetsSelected: false,
      publicationAuthorized: false,
      generatedAt,
    });
  }

  async recordUsage(input: VideoAssetUsageRecord): Promise<{
    readonly usageId: string;
    readonly shotId: string;
    readonly usageCountAfter: number;
    readonly recordedAt: string;
    readonly idempotentReplay: boolean;
  }> {
    const request = videoAssetUsageRecordSchema.parse(input);
    const recordedAt = request.usedAt ?? trustedNow(this.now).toISOString();
    const [usageRows, shotRows] = await Promise.all([
      this.client.readRange(this.spreadsheetId, VIDEO_USAGE_RANGE),
      this.client.readRange(this.spreadsheetId, VIDEO_SHOTS_RANGE),
    ]);
    const existing = findUsageRecord(usageRows, request.usageId);
    if (existing) {
      if (
        existing.shotId !== request.shotId ||
        existing.driveFileId !== request.driveFileId ||
        existing.outputId !== request.outputId
      ) {
        throw new ExecutionError('STATE_CONFLICT', 'VIDEO_USAGE_ID_CONFLICT', false);
      }
      return {
        usageId: request.usageId,
        shotId: request.shotId,
        usageCountAfter: existing.usageCountAfter,
        recordedAt: existing.usedAt,
        idempotentReplay: true,
      };
    }

    const headers = headersFor(shotRows, 'VIDEO_SHOTS_SCHEMA_INVALID');
    const shotIdIndex = requireHeader(headers, 'shot_id', 'VIDEO_SHOTS_SCHEMA_INVALID');
    const driveFileIndex = requireHeader(
      headers,
      'source_drive_file_id',
      'VIDEO_SHOTS_SCHEMA_INVALID',
    );
    const matches = shotRows
      .slice(1)
      .map((row, index) => ({ row, rowNumber: index + 2 }))
      .filter(
        ({ row }) =>
          cell(row[shotIdIndex]) === request.shotId &&
          cell(row[driveFileIndex]) === request.driveFileId,
      );
    if (matches.length !== 1) {
      throw new ExecutionError('STATE_CONFLICT', 'VIDEO_USAGE_SHOT_BINDING_NOT_RESOLVED', false);
    }
    const match = matches[0]!;
    const usageCountIndex = requireHeader(headers, 'usage_count', 'VIDEO_SHOTS_SCHEMA_INVALID');
    const currentUsageCount = numberValue(match.row[usageCountIndex]);
    const usageCountAfter = Math.max(0, Math.trunc(currentUsageCount)) + 1;

    await this.client.appendRow(this.spreadsheetId, VIDEO_USAGE_APPEND_RANGE, [
      request.usageId,
      request.shotId,
      request.driveFileId,
      request.outputId,
      request.contentItemId ?? '',
      request.campaignId ?? '',
      request.operation,
      request.usagePurpose,
      request.storyFunctionUsed,
      recordedAt,
      usageCountAfter,
      request.outputId,
      request.campaignId ?? '',
      '',
    ]);

    const updates = [
      updateFor(headers, match.rowNumber, 'usage_count', usageCountAfter),
      updateFor(headers, match.rowNumber, 'last_used_at', recordedAt),
      updateFor(headers, match.rowNumber, 'last_used_in_reel', request.outputId),
      updateFor(headers, match.rowNumber, 'last_used_campaign', request.campaignId ?? ''),
      updateFor(headers, match.rowNumber, 'last_output_id', request.outputId),
      updateFor(headers, match.rowNumber, 'usage_purpose', request.usagePurpose),
    ];
    await this.client.updateRanges(this.spreadsheetId, updates);

    return {
      usageId: request.usageId,
      shotId: request.shotId,
      usageCountAfter,
      recordedAt,
      idempotentReplay: false,
    };
  }

  private async recordSelectionAudit(input: {
    readonly requestId: string;
    readonly request: VideoAssetSelectionRequest;
    readonly generatedAt: string;
    readonly coverageStatus: 'COMPLETE' | 'VIDEO_COVERAGE_GAP';
    readonly missingStoryFunctions: readonly VideoStoryFunction[];
    readonly chosen: readonly ScoredShot[];
  }): Promise<void> {
    await this.client.appendRow(this.spreadsheetId, VIDEO_REQUEST_APPEND_RANGE, [
      input.requestId,
      input.request.contentItemId ?? '',
      input.request.operation,
      input.request.eventEdition ?? '',
      input.request.format,
      input.request.objective,
      input.request.requiredStoryFunctions.join('|'),
      input.request.optionalStoryFunctions.join('|'),
      input.request.requiredSourceTypes.join('|'),
      input.request.preferredEnergy.join('|'),
      input.request.briefTags.join('|'),
      input.request.maxResults,
      input.request.allowGenerative ? 'TRUE' : 'FALSE',
      input.request.marketingIntent ? 'TRUE' : 'FALSE',
      input.coverageStatus,
      input.missingStoryFunctions.join('|'),
      input.generatedAt,
      input.generatedAt,
    ]);

    for (const [index, candidate] of input.chosen.entries()) {
      await this.client.appendRow(this.spreadsheetId, VIDEO_SELECTOR_APPEND_RANGE, [
        input.requestId,
        index + 1,
        candidate.shot.shotId,
        candidate.shot.driveFileId,
        candidate.shot.sourceLibraryId,
        candidate.shot.sourceType,
        candidate.matchedRequiredFunctions.join('|'),
        candidate.storyFunctionScore,
        candidate.technicalScore,
        candidate.briefFitScore,
        candidate.energyScore,
        candidate.productEventScore,
        candidate.freshnessScore,
        candidate.antiRepeatScore,
        roundScore(candidate.finalScore),
        1,
        roundScore(candidate.finalScore),
        candidate.selectionStatus,
        candidate.shot.rightsStatus,
        candidate.shot.marketingReady ? 'TRUE' : 'FALSE',
        candidate.shot.creativeEligible ? 'TRUE' : 'FALSE',
        isGenerativeEligible(candidate.shot) ? 'TRUE' : 'FALSE',
        candidate.shot.usageCount,
        candidate.shot.lastUsedAt,
        candidate.shot.visualClusterId,
        candidate.shot.driveUrl,
        selectionReason(candidate),
        input.generatedAt,
      ]);
    }
  }
}

function parseShots(rows: readonly (readonly unknown[])[]): CanonicalShot[] {
  const headers = headersFor(rows, 'VIDEO_SHOTS_SCHEMA_INVALID');
  const value = (row: readonly unknown[], name: string) => {
    const index = headers.get(name);
    return index === undefined ? '' : cell(row[index]);
  };
  return rows.slice(1).flatMap((row, index) => {
    const shotId = value(row, 'shot_id');
    const driveFileId = value(row, 'source_drive_file_id');
    if (!shotId || !driveFileId) return [];
    const sourceType = normalizeSourceType(value(row, 'source_type'));
    const storyFunctions = splitPipe(value(row, 'story_functions')).flatMap((entry) => {
      const normalized = entry.toUpperCase();
      return isStoryFunction(normalized) ? [normalized] : [];
    });
    return [
      {
        rowNumber: index + 2,
        shotId,
        driveFileId,
        driveUrl:
          value(row, 'drive_url') || `https://drive.google.com/file/d/${driveFileId}/view`,
        sourceLibraryId: value(row, 'source_library_id') || 'CANONICAL_INTERNAL',
        sourceType,
        operation: value(row, 'operation'),
        eventEdition: value(row, 'event_edition'),
        storyFunctions,
        energy: value(row, 'energy'),
        technicalScore: clampScore(numberValue(value(row, 'technical_score'))),
        tags: splitPipe(value(row, 'tags').replace(/,/g, '|')),
        textContext: [
          value(row, 'shot_class'),
          value(row, 'notes'),
          value(row, 'location_signature'),
          value(row, 'tags'),
          value(row, 'energy'),
        ]
          .join(' ')
          .toLowerCase(),
        usageCount: Math.max(0, Math.trunc(numberValue(value(row, 'usage_count')))),
        lastUsedAt: value(row, 'last_used_at'),
        visualClusterId: value(row, 'visual_cluster_id'),
        rightsStatus: value(row, 'rights_status').toUpperCase(),
        rightsEligibility: value(row, 'rights_eligibility').toUpperCase(),
        generativeEligibility: value(row, 'generative_eligibility').toUpperCase(),
        discoverable: bool(value(row, 'discoverable')),
        creativeEligible: bool(value(row, 'creative_eligible')),
        marketingReady: bool(value(row, 'marketing_ready')),
        venueVerified: bool(value(row, 'venue_verified')),
        status: value(row, 'status').toUpperCase(),
      },
    ];
  });
}

function parsePolicy(rows: readonly (readonly unknown[])[]): RankingPolicy {
  if (rows.length < 2) deny('VIDEO_RANKING_POLICY_NOT_RESOLVED');
  const headers = headersFor(rows, 'VIDEO_RANKING_POLICY_SCHEMA_INVALID');
  const keyIndex = requireHeader(headers, 'policy_key', 'VIDEO_RANKING_POLICY_SCHEMA_INVALID');
  const valueIndex = requireHeader(headers, 'policy_value', 'VIDEO_RANKING_POLICY_SCHEMA_INVALID');
  const statusIndex = requireHeader(headers, 'status', 'VIDEO_RANKING_POLICY_SCHEMA_INVALID');
  const values = new Map<string, string>();
  for (const row of rows.slice(1)) {
    if (cell(row[statusIndex]) !== 'ACTIVE_CANONICAL') continue;
    const key = cell(row[keyIndex]);
    if (key) values.set(key, cell(row[valueIndex]));
  }
  if (values.get('POLICY_VERSION') !== VIDEO_ASSET_SELECTION_POLICY_VERSION) {
    deny('VIDEO_RANKING_POLICY_VERSION_MISMATCH');
  }
  const numeric = (key: string) => {
    const parsed = Number.parseFloat((values.get(key) ?? '').replace(',', '.'));
    if (!Number.isFinite(parsed)) deny(`VIDEO_RANKING_POLICY_VALUE_INVALID:${key}`);
    return parsed;
  };
  const policy: RankingPolicy = {
    storyFunction: numeric('WEIGHT_STORY_FUNCTION'),
    technicalQuality: numeric('WEIGHT_TECHNICAL_QUALITY'),
    briefFit: numeric('WEIGHT_BRIEF_FIT'),
    energy: numeric('WEIGHT_ENERGY'),
    productEvent: numeric('WEIGHT_PRODUCT_EVENT'),
    freshness: numeric('WEIGHT_FRESHNESS'),
    antiRepeat: numeric('WEIGHT_ANTI_REPEAT'),
    useCountPenalty: numeric('USE_COUNT_PENALTY_PER_USE'),
    antiRepeatFloor: numeric('ANTI_REPEAT_FLOOR'),
    similarityPenaltyFactor: numeric('SIMILARITY_PENALTY_FACTOR'),
    recency: [
      { days: numeric('RECENCY_DAYS_1'), factor: numeric('RECENCY_FACTOR_1') },
      { days: numeric('RECENCY_DAYS_2'), factor: numeric('RECENCY_FACTOR_2') },
      { days: numeric('RECENCY_DAYS_3'), factor: numeric('RECENCY_FACTOR_3') },
    ],
    recencyDefault: numeric('RECENCY_FACTOR_DEFAULT'),
    topPickMin: numeric('STATUS_TOP_PICK_MIN'),
    strongMin: numeric('STATUS_STRONG_MIN'),
    validMin: numeric('STATUS_VALID_MIN'),
    maxResultLimit: Math.trunc(numeric('MAX_RESULT_LIMIT')),
  };
  const weightSum =
    policy.storyFunction +
    policy.technicalQuality +
    policy.briefFit +
    policy.energy +
    policy.productEvent +
    policy.freshness +
    policy.antiRepeat;
  if (Math.abs(weightSum - 1) > 0.0001) deny('VIDEO_RANKING_POLICY_WEIGHT_SUM_INVALID');
  return policy;
}

function isEligible(shot: CanonicalShot, request: VideoAssetSelectionRequest): boolean {
  if (!shot.discoverable || !shot.creativeEligible || !shot.venueVerified) return false;
  if (!SELECTION_STATUSES.has(shot.status)) return false;
  if (shot.operation !== request.operation) return false;
  if (
    request.requiredSourceTypes.length > 0 &&
    !request.requiredSourceTypes.includes(shot.sourceType)
  ) {
    return false;
  }
  if (request.marketingIntent) {
    if (!shot.marketingReady || !APPROVED_RIGHTS.has(shot.rightsStatus)) return false;
    if (!['TRUE', 'ELIGIBLE', 'CLEARED', 'RIGHTS_CLEARED'].includes(shot.rightsEligibility)) {
      return false;
    }
  }
  return true;
}

function scoreShot(
  shot: CanonicalShot,
  request: VideoAssetSelectionRequest,
  policy: RankingPolicy,
  generatedAt: string,
  eligiblePool: readonly CanonicalShot[],
): ScoredShot {
  const matchedRequiredFunctions = request.requiredStoryFunctions.filter((storyFunction) =>
    shot.storyFunctions.includes(storyFunction),
  );
  const optionalMatches = request.optionalStoryFunctions.filter((storyFunction) =>
    shot.storyFunctions.includes(storyFunction),
  );
  const storyFunctionScore =
    matchedRequiredFunctions.length > 0
      ? 100
      : optionalMatches.length > 0
        ? 75
        : 35;
  const technicalScore = shot.technicalScore;
  const briefFitScore = semanticFitScore(shot, request);
  const energyScore = energyFitScore(shot, request);
  const productEventScore = productEventFitScore(shot, request);
  const freshnessScore = freshnessScoreFor(shot, generatedAt, policy);
  const antiRepeatScore = antiRepeatScoreFor(shot, generatedAt, policy, eligiblePool);
  const finalScore =
    storyFunctionScore * policy.storyFunction +
    technicalScore * policy.technicalQuality +
    briefFitScore * policy.briefFit +
    energyScore * policy.energy +
    productEventScore * policy.productEvent +
    freshnessScore * policy.freshness +
    antiRepeatScore * policy.antiRepeat;
  const selectionStatus =
    finalScore >= policy.topPickMin
      ? 'TOP_PICK'
      : finalScore >= policy.strongMin
        ? 'STRONG'
        : finalScore >= policy.validMin
          ? 'VALID'
          : 'REJECT';
  return {
    shot,
    matchedRequiredFunctions,
    storyFunctionScore,
    technicalScore,
    briefFitScore,
    energyScore,
    productEventScore,
    freshnessScore,
    antiRepeatScore,
    finalScore,
    selectionStatus,
  };
}

function chooseCoverageFirst(
  scored: readonly ScoredShot[],
  requiredFunctions: readonly VideoStoryFunction[],
  maxResults: number,
): ScoredShot[] {
  const chosen: ScoredShot[] = [];
  const seen = new Set<string>();
  for (const storyFunction of requiredFunctions) {
    const candidate = scored.find(
      (item) => !seen.has(item.shot.shotId) && item.shot.storyFunctions.includes(storyFunction),
    );
    if (!candidate) continue;
    chosen.push(candidate);
    seen.add(candidate.shot.shotId);
    if (chosen.length >= maxResults) return chosen;
  }
  for (const candidate of scored) {
    if (seen.has(candidate.shot.shotId)) continue;
    chosen.push(candidate);
    seen.add(candidate.shot.shotId);
    if (chosen.length >= maxResults) break;
  }
  return chosen;
}

function toSelectedAsset(candidate: ScoredShot, rank: number): SelectedVideoAsset {
  return {
    rank,
    shotId: candidate.shot.shotId,
    driveFileId: candidate.shot.driveFileId,
    driveUrl: candidate.shot.driveUrl,
    sourceLibraryId: candidate.shot.sourceLibraryId,
    sourceType: candidate.shot.sourceType,
    storyFunctions: [...candidate.shot.storyFunctions],
    matchedRequiredFunctions: [...candidate.matchedRequiredFunctions],
    ...(candidate.shot.visualClusterId
      ? { visualClusterId: candidate.shot.visualClusterId }
      : {}),
    score: roundScore(candidate.finalScore),
    selectionStatus: candidate.selectionStatus as 'TOP_PICK' | 'STRONG' | 'VALID',
    generativeEligible: isGenerativeEligible(candidate.shot),
    reason: selectionReason(candidate),
  };
}

function semanticFitScore(shot: CanonicalShot, request: VideoAssetSelectionRequest): number {
  const terms = [...request.briefTags, request.objective]
    .flatMap((value) => normalizeTerms(value))
    .filter((value, index, array) => array.indexOf(value) === index);
  if (terms.length === 0) return 100;
  const haystack = `${shot.textContext} ${shot.tags.join(' ')}`.toLowerCase();
  const matched = terms.filter((term) => haystack.includes(term)).length;
  return clampScore(40 + (60 * matched) / terms.length);
}

function energyFitScore(shot: CanonicalShot, request: VideoAssetSelectionRequest): number {
  if (request.preferredEnergy.length === 0) return 100;
  const energy = normalizeToken(shot.energy);
  return request.preferredEnergy.some((value) => energy.includes(normalizeToken(value))) ? 100 : 45;
}

function productEventFitScore(shot: CanonicalShot, request: VideoAssetSelectionRequest): number {
  if (!request.eventEdition) return 100;
  if (shot.eventEdition === request.eventEdition) return 100;
  if (!shot.eventEdition) return 80;
  return 50;
}

function freshnessScoreFor(
  shot: CanonicalShot,
  generatedAt: string,
  policy: RankingPolicy,
): number {
  if (!shot.lastUsedAt) return 100;
  const days = ageDays(shot.lastUsedAt, generatedAt);
  if (!Number.isFinite(days)) return 50;
  if (days <= 7) return 35;
  if (days <= 14) return 60;
  if (days <= 30) return 80;
  return 100;
}

function antiRepeatScoreFor(
  shot: CanonicalShot,
  generatedAt: string,
  policy: RankingPolicy,
  eligiblePool: readonly CanonicalShot[],
): number {
  const usageBase = Math.max(policy.antiRepeatFloor, 100 - shot.usageCount * policy.useCountPenalty);
  const days = shot.lastUsedAt ? ageDays(shot.lastUsedAt, generatedAt) : Number.POSITIVE_INFINITY;
  const recencyFactor =
    policy.recency.find((window) => days <= window.days)?.factor ?? policy.recencyDefault;
  let score = usageBase * recencyFactor;
  if (shot.visualClusterId) {
    const clusterRecentlyUsed = eligiblePool.some(
      (other) =>
        other.shotId !== shot.shotId &&
        other.visualClusterId === shot.visualClusterId &&
        other.lastUsedAt &&
        ageDays(other.lastUsedAt, generatedAt) <= 30,
    );
    if (clusterRecentlyUsed) score *= 1 - policy.similarityPenaltyFactor;
  }
  return clampScore(score);
}

function selectionReason(candidate: ScoredShot): string {
  return [
    `story=${candidate.storyFunctionScore}`,
    `technical=${candidate.technicalScore}`,
    `brief=${candidate.briefFitScore}`,
    `energy=${candidate.energyScore}`,
    `product_event=${candidate.productEventScore}`,
    `freshness=${candidate.freshnessScore}`,
    `anti_repeat=${candidate.antiRepeatScore}`,
    `final=${roundScore(candidate.finalScore)}`,
  ].join(';');
}

function compareScoredShots(left: ScoredShot, right: ScoredShot): number {
  if (right.finalScore !== left.finalScore) return right.finalScore - left.finalScore;
  if (right.antiRepeatScore !== left.antiRepeatScore) return right.antiRepeatScore - left.antiRepeatScore;
  if (right.technicalScore !== left.technicalScore) return right.technicalScore - left.technicalScore;
  return left.shot.shotId.localeCompare(right.shot.shotId);
}

function isGenerativeEligible(shot: CanonicalShot): boolean {
  return ['TRUE', 'ELIGIBLE', 'CLEARED', 'APPROVED'].includes(shot.generativeEligibility);
}

function findUsageRecord(
  rows: readonly (readonly unknown[])[],
  usageId: string,
):
  | {
      readonly shotId: string;
      readonly driveFileId: string;
      readonly outputId: string;
      readonly usedAt: string;
      readonly usageCountAfter: number;
    }
  | undefined {
  if (rows.length === 0) return undefined;
  const headers = headersFor(rows, 'VIDEO_USAGE_LOG_SCHEMA_INVALID');
  const usageIdIndex = requireHeader(headers, 'usage_id', 'VIDEO_USAGE_LOG_SCHEMA_INVALID');
  const matches = rows.slice(1).filter((row) => cell(row[usageIdIndex]) === usageId);
  if (matches.length > 1) deny('VIDEO_USAGE_LOG_DUPLICATE_USAGE_ID');
  const row = matches[0];
  if (!row) return undefined;
  const read = (name: string) => cell(row[requireHeader(headers, name, 'VIDEO_USAGE_LOG_SCHEMA_INVALID')]);
  return {
    shotId: read('shot_id'),
    driveFileId: read('drive_file_id'),
    outputId: read('output_id'),
    usedAt: read('used_at'),
    usageCountAfter: Math.max(0, Math.trunc(numberValue(read('usage_count_after')))),
  };
}

function updateFor(
  headers: ReadonlyMap<string, number>,
  rowNumber: number,
  header: string,
  value: unknown,
): { readonly range: string; readonly values: readonly (readonly unknown[])[] } {
  const index = requireHeader(headers, header, 'VIDEO_SHOTS_SCHEMA_INVALID');
  return {
    range: `VIDEO_SHOTS!${columnName(index + 1)}${rowNumber}`,
    values: [[value]],
  };
}

function headersFor(
  rows: readonly (readonly unknown[])[],
  error: string,
): ReadonlyMap<string, number> {
  if (rows.length === 0) deny(error);
  const headers = new Map<string, number>();
  for (const [index, value] of (rows[0] ?? []).entries()) {
    const key = cell(value).toLowerCase();
    if (!key) continue;
    if (headers.has(key)) deny(error);
    headers.set(key, index);
  }
  return headers;
}

function requireHeader(headers: ReadonlyMap<string, number>, name: string, error: string): number {
  const index = headers.get(name);
  if (index === undefined) deny(`${error}:${name}`);
  return index;
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
  return ['true', '1', 'yes', 'sim'].includes(cell(value).toLowerCase());
}

function numberValue(value: unknown): number {
  const parsed = Number.parseFloat(cell(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitPipe(value: string): string[] {
  return value
    .split('|')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeSourceType(value: string): VideoSourceType {
  const normalized = value.trim().toUpperCase();
  if (normalized === 'CAMERA' || normalized === 'DRONE' || normalized === 'MIXED') return normalized;
  return 'UNKNOWN';
}

function isStoryFunction(value: string): value is VideoStoryFunction {
  return [
    'HOOK',
    'PLACE_PROOF',
    'HUMAN',
    'DJ',
    'DETAIL',
    'CROWD',
    'CLIMAX',
    'TRACK_NATIONAL',
    'TRACK_INTERNATIONAL',
    'CIRCULATION',
    'HERO',
    'CTA_BACKGROUND',
    'BROLL',
  ].includes(value);
}

function normalizeTerms(value: string): string[] {
  return normalizeToken(value)
    .split(/[^a-z0-9_]+/)
    .filter((term) => term.length >= 3);
}

function normalizeToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function ageDays(earlier: string, later: string): number {
  const start = Date.parse(earlier);
  const end = Date.parse(later);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return Number.NaN;
  return (end - start) / 86_400_000;
}

function createRequestId(request: VideoAssetSelectionRequest, generatedAt: string): string {
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        operation: request.operation,
        edition: request.eventEdition ?? '',
        format: request.format,
        objective: request.objective,
        required: request.requiredStoryFunctions,
        generatedAt,
      }),
    )
    .digest('hex')
    .slice(0, 16);
  return `VIDSEL-${hash}`;
}

function columnName(index: number): string {
  let value = index;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function roundScore(value: number): number {
  return Math.round(clampScore(value) * 100) / 100;
}

function trustedNow(now: () => Date): Date {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new ExecutionError('POLICY_DENIED', 'VIDEO_ASSET_SELECTOR_TRUSTED_CLOCK_INVALID', false);
  }
  return value;
}

function deny(message: string): never {
  throw new ExecutionError('POLICY_DENIED', message, false);
}
