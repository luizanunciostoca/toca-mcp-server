import { describe, expect, it } from 'vitest';
import { IntelligentVideoAssetSelectorService } from '../src/creative/intelligent-video-asset-selector.js';
import type {
  SpreadsheetRangeUpdate,
  SpreadsheetValuesBatchWriter,
  SpreadsheetValuesClient,
} from '../src/providers/google-sheets/media-assets.js';

const shotHeaders = [
  'SHOT_ID',
  'SOURCE_ASSET_ID',
  'SOURCE_DRIVE_FILE_ID',
  'MASTER_ASSET_ID',
  'MASTER_DRIVE_FILE_ID',
  'SOURCE_SHA256',
  'MASTER_SHA256',
  'OPERATION',
  'LOCATION_SIGNATURE',
  'SHOT_CLASS',
  'DURATION_MS',
  'ORIENTATION',
  'VENUE_VERIFIED',
  'MARKETING_READY',
  'RIGHTS_STATUS',
  'STATUS',
  'NOTES',
  'SOURCE_FILE_NAME',
  'SOURCE_MIME_TYPE',
  'WIDTH',
  'HEIGHT',
  'FPS',
  'AUDIO_STATUS',
  'PEOPLE_IDENTIFIABLE',
  'ENERGY',
  'DENSIDADE_PUBLICO',
  'STORY_FUNCTIONS',
  'QUALITY_TIER',
  'TECHNICAL_SCORE',
  'EVENT_EDITION',
  'TAGS',
  'USAGE_COUNT',
  'LAST_USED_AT',
  'VISUAL_CLUSTER_ID',
  'RIGHTS_ELIGIBILITY',
  'GENERATIVE_ELIGIBILITY',
  'SOURCE_LIBRARY_ID',
  'SOURCE_TYPE',
  'SOURCE_PATH',
  'DRIVE_URL',
  'DISCOVERABLE',
  'CREATIVE_ELIGIBLE',
  'LAST_USED_IN_REEL',
  'LAST_USED_CAMPAIGN',
  'LAST_OUTPUT_ID',
  'USAGE_PURPOSE',
  'BRIEF_FIT_SCORE',
  'ENERGY_SCORE',
];

const policyRows = [
  ['POLICY_KEY', 'POLICY_VALUE', 'VALUE_TYPE', 'DESCRIPTION', 'STATUS'],
  ['POLICY_VERSION', 'VIDEO-RANK-1.0', 'STRING', '', 'ACTIVE_CANONICAL'],
  ['WEIGHT_STORY_FUNCTION', 0.25, 'NUMBER', '', 'ACTIVE_CANONICAL'],
  ['WEIGHT_TECHNICAL_QUALITY', 0.2, 'NUMBER', '', 'ACTIVE_CANONICAL'],
  ['WEIGHT_BRIEF_FIT', 0.2, 'NUMBER', '', 'ACTIVE_CANONICAL'],
  ['WEIGHT_ENERGY', 0.1, 'NUMBER', '', 'ACTIVE_CANONICAL'],
  ['WEIGHT_PRODUCT_EVENT', 0.1, 'NUMBER', '', 'ACTIVE_CANONICAL'],
  ['WEIGHT_FRESHNESS', 0.05, 'NUMBER', '', 'ACTIVE_CANONICAL'],
  ['WEIGHT_ANTI_REPEAT', 0.1, 'NUMBER', '', 'ACTIVE_CANONICAL'],
  ['USE_COUNT_PENALTY_PER_USE', 18, 'NUMBER', '', 'ACTIVE_CANONICAL'],
  ['ANTI_REPEAT_FLOOR', 20, 'NUMBER', '', 'ACTIVE_CANONICAL'],
  ['SIMILARITY_PENALTY_FACTOR', 0.35, 'NUMBER', '', 'ACTIVE_CANONICAL'],
  ['RECENCY_DAYS_1', 7, 'NUMBER', '', 'ACTIVE_CANONICAL'],
  ['RECENCY_FACTOR_1', 0.35, 'NUMBER', '', 'ACTIVE_CANONICAL'],
  ['RECENCY_DAYS_2', 14, 'NUMBER', '', 'ACTIVE_CANONICAL'],
  ['RECENCY_FACTOR_2', 0.6, 'NUMBER', '', 'ACTIVE_CANONICAL'],
  ['RECENCY_DAYS_3', 30, 'NUMBER', '', 'ACTIVE_CANONICAL'],
  ['RECENCY_FACTOR_3', 0.8, 'NUMBER', '', 'ACTIVE_CANONICAL'],
  ['RECENCY_FACTOR_DEFAULT', 1, 'NUMBER', '', 'ACTIVE_CANONICAL'],
  ['STATUS_TOP_PICK_MIN', 85, 'NUMBER', '', 'ACTIVE_CANONICAL'],
  ['STATUS_STRONG_MIN', 75, 'NUMBER', '', 'ACTIVE_CANONICAL'],
  ['STATUS_VALID_MIN', 65, 'NUMBER', '', 'ACTIVE_CANONICAL'],
  ['MAX_RESULT_LIMIT', 10, 'NUMBER', '', 'ACTIVE_CANONICAL'],
];

function shot(overrides: Record<string, unknown>) {
  const values: Record<string, unknown> = {
    SHOT_ID: 'SHOT-1',
    SOURCE_DRIVE_FILE_ID: 'drive-1',
    OPERATION: 'THE_PARTY',
    LOCATION_SIGNATURE: 'toca',
    SHOT_CLASS: 'crowd dancing',
    VENUE_VERIFIED: 'TRUE',
    MARKETING_READY: 'TRUE',
    RIGHTS_STATUS: 'CLEARED',
    STATUS: 'ACTIVE_APPROVED',
    NOTES: 'pista cheia dj crowd energia',
    ENERGY: 'ALTA_ENERGIA',
    STORY_FUNCTIONS: 'HOOK|CROWD',
    TECHNICAL_SCORE: 90,
    EVENT_EDITION: 'TP-20260904',
    TAGS: 'crowd|pista|dança',
    USAGE_COUNT: 0,
    LAST_USED_AT: '',
    VISUAL_CLUSTER_ID: 'cluster-1',
    RIGHTS_ELIGIBILITY: 'CLEARED',
    GENERATIVE_ELIGIBILITY: 'ELIGIBLE',
    SOURCE_LIBRARY_ID: 'LIB-001',
    SOURCE_TYPE: 'CAMERA',
    SOURCE_PATH: 'Vídeos/Camera',
    DRIVE_URL: 'https://drive.google.com/file/d/drive-1/view',
    DISCOVERABLE: 'TRUE',
    CREATIVE_ELIGIBLE: 'TRUE',
    ...overrides,
  };
  return shotHeaders.map((header) => values[header] ?? '');
}

class FakeSheets implements SpreadsheetValuesClient, SpreadsheetValuesBatchWriter {
  readonly appended: { range: string; values: readonly unknown[] }[] = [];
  readonly updates: SpreadsheetRangeUpdate[][] = [];

  constructor(
    readonly shots: readonly (readonly unknown[])[],
    readonly usage: readonly (readonly unknown[])[] = [
      [
        'USAGE_ID',
        'SHOT_ID',
        'DRIVE_FILE_ID',
        'OUTPUT_ID',
        'CONTENT_ITEM_ID',
        'CAMPAIGN_ID',
        'OPERATION',
        'USAGE_PURPOSE',
        'STORY_FUNCTION_USED',
        'USED_AT',
        'USAGE_COUNT_AFTER',
        'LAST_USED_IN_REEL',
        'LAST_USED_CAMPAIGN',
        'NOTES',
      ],
    ],
  ) {}

  async readRange(_spreadsheetId: string, range: string) {
    if (range.startsWith('VIDEO_SHOTS!')) return this.shots;
    if (range.startsWith('VIDEO_RANKING_POLICY!')) return policyRows;
    if (range.startsWith('VIDEO_USAGE_LOG!')) return this.usage;
    throw new Error(`unexpected range ${range}`);
  }

  async appendRow(_spreadsheetId: string, range: string, values: readonly unknown[]) {
    this.appended.push({ range, values });
  }

  async updateRanges(_spreadsheetId: string, updates: readonly SpreadsheetRangeUpdate[]) {
    this.updates.push([...updates]);
  }
}

describe('IntelligentVideoAssetSelectorService', () => {
  it('covers required story functions with exact promoted Drive IDs and never selects intake', async () => {
    const sheets = new FakeSheets([
      shotHeaders,
      shot({ SHOT_ID: 'HOOK-1', SOURCE_DRIVE_FILE_ID: 'drive-hook', STORY_FUNCTIONS: 'HOOK' }),
      shot({
        SHOT_ID: 'DJ-1',
        SOURCE_DRIVE_FILE_ID: 'drive-dj',
        STORY_FUNCTIONS: 'DJ',
        TAGS: 'dj|gear|pista',
      }),
      shot({
        SHOT_ID: 'BLOCKED-1',
        SOURCE_DRIVE_FILE_ID: 'drive-blocked',
        STORY_FUNCTIONS: 'CLIMAX',
        CREATIVE_ELIGIBLE: 'FALSE',
        RIGHTS_STATUS: 'UNVERIFIED',
      }),
    ]);
    const service = new IntelligentVideoAssetSelectorService(
      sheets,
      'sheet',
      () => new Date('2026-09-05T00:00:00.000Z'),
    );

    const result = await service.select({
      operation: 'THE_PARTY',
      eventEdition: 'TP-20260904',
      format: 'REEL',
      objective: 'DJ e pista',
      requiredStoryFunctions: ['HOOK', 'DJ'],
      optionalStoryFunctions: [],
      requiredSourceTypes: [],
      preferredEnergy: ['ALTA_ENERGIA'],
      briefTags: ['dj', 'pista'],
      maxResults: 10,
      allowGenerative: true,
      marketingIntent: true,
    });

    expect(result.coverageStatus).toBe('COMPLETE');
    expect(new Set(result.exactDriveFileIds)).toEqual(new Set(['drive-hook', 'drive-dj']));
    expect(result.sourceLibraryScanUsed).toBe(false);
    expect(result.intakeAssetsSelected).toBe(false);
    expect(result.publicationAuthorized).toBe(false);
    expect(result.exactDriveFileIds).not.toContain('drive-blocked');
  });

  it('returns VIDEO_COVERAGE_GAP instead of substituting an ineligible shot', async () => {
    const sheets = new FakeSheets([
      shotHeaders,
      shot({ SHOT_ID: 'HOOK-1', SOURCE_DRIVE_FILE_ID: 'drive-hook', STORY_FUNCTIONS: 'HOOK' }),
      shot({
        SHOT_ID: 'CLIMAX-BLOCKED',
        SOURCE_DRIVE_FILE_ID: 'drive-climax',
        STORY_FUNCTIONS: 'CLIMAX',
        MARKETING_READY: 'FALSE',
        RIGHTS_STATUS: 'UNVERIFIED',
      }),
    ]);
    const service = new IntelligentVideoAssetSelectorService(sheets, 'sheet');
    const result = await service.select({
      operation: 'THE_PARTY',
      format: 'REEL',
      objective: 'climax',
      requiredStoryFunctions: ['HOOK', 'CLIMAX'],
      optionalStoryFunctions: [],
      requiredSourceTypes: [],
      preferredEnergy: [],
      briefTags: [],
      maxResults: 10,
      allowGenerative: true,
      marketingIntent: true,
    });
    expect(result.coverageStatus).toBe('VIDEO_COVERAGE_GAP');
    expect(result.missingStoryFunctions).toContain('CLIMAX');
    expect(result.exactDriveFileIds).toEqual(['drive-hook']);
  });

  it('penalizes recent repeated footage so a fresh equivalent take ranks first', async () => {
    const sheets = new FakeSheets([
      shotHeaders,
      shot({
        SHOT_ID: 'REPEATED',
        SOURCE_DRIVE_FILE_ID: 'drive-repeated',
        STORY_FUNCTIONS: 'CROWD',
        USAGE_COUNT: 3,
        LAST_USED_AT: '2026-09-04T20:00:00.000Z',
        VISUAL_CLUSTER_ID: 'cluster-r',
      }),
      shot({
        SHOT_ID: 'FRESH',
        SOURCE_DRIVE_FILE_ID: 'drive-fresh',
        STORY_FUNCTIONS: 'CROWD',
        USAGE_COUNT: 0,
        LAST_USED_AT: '',
        VISUAL_CLUSTER_ID: 'cluster-f',
      }),
    ]);
    const service = new IntelligentVideoAssetSelectorService(
      sheets,
      'sheet',
      () => new Date('2026-09-05T00:00:00.000Z'),
    );
    const result = await service.select({
      operation: 'THE_PARTY',
      format: 'REEL',
      objective: 'crowd pista',
      requiredStoryFunctions: ['CROWD'],
      optionalStoryFunctions: [],
      requiredSourceTypes: [],
      preferredEnergy: ['ALTA_ENERGIA'],
      briefTags: ['crowd', 'pista'],
      maxResults: 2,
      allowGenerative: true,
      marketingIntent: true,
    });
    expect(result.selectedAssets[0]?.shotId).toBe('FRESH');
    expect(result.selectedAssets[0]?.score).toBeGreaterThan(result.selectedAssets[1]?.score ?? 0);
  });

  it('records exact usage idempotently and updates anti-repeat fields on VIDEO_SHOTS', async () => {
    const sheets = new FakeSheets([
      shotHeaders,
      shot({ SHOT_ID: 'SHOT-U', SOURCE_DRIVE_FILE_ID: 'drive-u', USAGE_COUNT: 2 }),
    ]);
    const service = new IntelligentVideoAssetSelectorService(
      sheets,
      'sheet',
      () => new Date('2026-09-05T01:00:00.000Z'),
    );
    const result = await service.recordUsage({
      usageId: 'USE-1',
      shotId: 'SHOT-U',
      driveFileId: 'drive-u',
      outputId: 'OUT-1',
      campaignId: 'CAMP-1',
      operation: 'THE_PARTY',
      usagePurpose: 'REEL_MASTER',
      storyFunctionUsed: 'HOOK',
    });
    expect(result.usageCountAfter).toBe(3);
    expect(sheets.appended.some((entry) => entry.range === 'VIDEO_USAGE_LOG!A:N')).toBe(true);
    expect(sheets.updates[0]?.map((entry) => entry.range)).toEqual(
      expect.arrayContaining([
        'VIDEO_SHOTS!AF2',
        'VIDEO_SHOTS!AG2',
        'VIDEO_SHOTS!AQ2',
        'VIDEO_SHOTS!AR2',
        'VIDEO_SHOTS!AS2',
        'VIDEO_SHOTS!AT2',
      ]),
    );
  });
});
