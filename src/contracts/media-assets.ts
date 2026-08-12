import * as z from 'zod/v4';

export const mediaAssetFormatSchema = z.enum(['FEED', 'STORIES', 'REEL_COVER', 'AD']);

export const mediaAssetSelectionRequestSchema = z.object({
  contentItemId: z.string().min(1),
  format: mediaAssetFormatSchema,
  theme: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(10).default(5),
});

export const rankedMediaAssetSchema = z.object({
  assetId: z.string().regex(/^SUN-\d{4}$/),
  driveFileId: z.string().min(1),
  cluster: z.string().min(1),
  score: z.number().min(0).max(100),
  rank: z.number().int().positive(),
});

export const mediaAssetSelectionResultSchema = z.object({
  contentItemId: z.string().min(1),
  format: mediaAssetFormatSchema,
  theme: z.string().trim().min(1).optional(),
  source: z.literal('TOCA_OS_ASSET_SELECTOR'),
  assets: z.array(rankedMediaAssetSchema).max(10),
});

export const mediaAssetUsageActionSchema = z.enum(['PUBLISHED', 'REUSED']);

export const mediaAssetUsageRecordSchema = z.object({
  contentItemId: z.string().min(1),
  assetId: z.string().regex(/^SUN-\d{4}$/),
  usedAt: z.string().min(1),
  format: mediaAssetFormatSchema,
  channel: z.string().trim().min(1).optional(),
  action: mediaAssetUsageActionSchema,
  source: z.literal('TOCA_MCP_SERVER'),
  notes: z.string().trim().max(500).optional(),
});

export type MediaAssetFormat = z.infer<typeof mediaAssetFormatSchema>;
export type MediaAssetSelectionRequest = z.infer<typeof mediaAssetSelectionRequestSchema>;
export type RankedMediaAsset = z.infer<typeof rankedMediaAssetSchema>;
export type MediaAssetSelectionResult = z.infer<typeof mediaAssetSelectionResultSchema>;
export type MediaAssetUsageRecord = z.infer<typeof mediaAssetUsageRecordSchema>;
