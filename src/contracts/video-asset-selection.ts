import * as z from 'zod/v4';

export const VIDEO_ASSET_SELECTION_POLICY_VERSION = 'VIDEO-RANK-1.0' as const;

export const videoStoryFunctionSchema = z.enum([
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
]);
export type VideoStoryFunction = z.infer<typeof videoStoryFunctionSchema>;

export const videoSourceTypeSchema = z.enum(['CAMERA', 'DRONE', 'MIXED', 'UNKNOWN']);
export type VideoSourceType = z.infer<typeof videoSourceTypeSchema>;

export const videoAssetSelectionRequestSchema = z.object({
  requestId: z.string().trim().min(1).max(128).optional(),
  contentItemId: z.string().trim().min(1).max(256).optional(),
  campaignId: z.string().trim().min(1).max(256).optional(),
  operation: z.string().trim().min(1).max(128),
  eventEdition: z.string().trim().min(1).max(128).optional(),
  format: z.string().trim().min(1).max(64),
  objective: z.string().trim().min(1).max(2000),
  requiredStoryFunctions: z.array(videoStoryFunctionSchema).min(1).max(13),
  optionalStoryFunctions: z.array(videoStoryFunctionSchema).max(13).default([]),
  requiredSourceTypes: z.array(videoSourceTypeSchema).max(4).default([]),
  preferredEnergy: z.array(z.string().trim().min(1).max(64)).max(10).default([]),
  briefTags: z.array(z.string().trim().min(1).max(128)).max(50).default([]),
  maxResults: z.number().int().min(1).max(10).default(10),
  allowGenerative: z.boolean().default(true),
  marketingIntent: z.boolean().default(true),
});
export type VideoAssetSelectionRequest = z.infer<typeof videoAssetSelectionRequestSchema>;

export const selectedVideoAssetSchema = z.object({
  rank: z.number().int().positive(),
  shotId: z.string().trim().min(1),
  driveFileId: z.string().trim().min(1),
  driveUrl: z.string().trim().min(1),
  sourceLibraryId: z.string().trim().min(1),
  sourceType: videoSourceTypeSchema,
  storyFunctions: z.array(videoStoryFunctionSchema),
  matchedRequiredFunctions: z.array(videoStoryFunctionSchema),
  visualClusterId: z.string().trim().optional(),
  score: z.number().min(0).max(100),
  selectionStatus: z.enum(['TOP_PICK', 'STRONG', 'VALID']),
  generativeEligible: z.boolean(),
  reason: z.string().trim().min(1),
});
export type SelectedVideoAsset = z.infer<typeof selectedVideoAssetSchema>;

export const videoAssetSelectionResultSchema = z.object({
  requestId: z.string().trim().min(1),
  policyVersion: z.literal(VIDEO_ASSET_SELECTION_POLICY_VERSION),
  coverageStatus: z.enum(['COMPLETE', 'VIDEO_COVERAGE_GAP']),
  missingStoryFunctions: z.array(videoStoryFunctionSchema),
  selectedAssets: z.array(selectedVideoAssetSchema).max(10),
  exactDriveFileIds: z.array(z.string().trim().min(1)).max(10),
  sourceLibraryScanUsed: z.literal(false),
  intakeAssetsSelected: z.literal(false),
  publicationAuthorized: z.literal(false),
  generatedAt: z.string().trim().min(1),
});
export type VideoAssetSelectionResult = z.infer<typeof videoAssetSelectionResultSchema>;

export const videoAssetUsageRecordSchema = z.object({
  usageId: z.string().trim().min(1).max(160),
  shotId: z.string().trim().min(1).max(160),
  driveFileId: z.string().trim().min(1).max(256),
  outputId: z.string().trim().min(1).max(256),
  contentItemId: z.string().trim().min(1).max(256).optional(),
  campaignId: z.string().trim().min(1).max(256).optional(),
  operation: z.string().trim().min(1).max(128),
  usagePurpose: z.string().trim().min(1).max(256),
  storyFunctionUsed: videoStoryFunctionSchema,
  usedAt: z.string().trim().min(1).optional(),
});
export type VideoAssetUsageRecord = z.infer<typeof videoAssetUsageRecordSchema>;
