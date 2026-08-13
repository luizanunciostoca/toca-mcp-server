import * as z from 'zod/v4';
import { loadConfig } from './config.js';
import { createInstagramPublicationApprovalManifest } from './worker/instagram-publication-approval-manifest.js';
import { GcsPublicationAssetStager } from './providers/gcp/gcs-publication-asset-stager.js';
import { createMetaPublicationApiClient } from './providers/meta/meta-publication-client.js';

const envSchema = z.object({
  GCP_PROJECT_ID: z.string().min(1),
  INSTAGRAM_BUSINESS_ACCOUNT_ID: z.string().min(1),
  INSTAGRAM_PUBLICATION_ASSET_BUCKET: z.string().min(1),
  INSTAGRAM_PUBLICATION_ASSET_ID: z.string().min(1),
  INSTAGRAM_PUBLICATION_CORRELATION_ID: z.string().min(1),
  INSTAGRAM_PUBLICATION_ASSET_SOURCE_PATH: z.string().min(1),
  INSTAGRAM_PUBLICATION_ASSET_CONTENT_TYPE: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  INSTAGRAM_FIRST_PUBLICATION_CAPTION_BASE64: z.string().min(1),
  INSTAGRAM_FIRST_PUBLICATION_IDEMPOTENCY_KEY: z.string().min(1),
});

const env = envSchema.parse(process.env);
const config = loadConfig(process.env);

if (!config.META_ENABLED) throw new Error('META_ENABLED_REQUIRED');
if (config.META_TOKEN_STORE_PROVIDER !== 'gcp-secret-manager') {
  throw new Error('META_PUBLICATION_TOKEN_STORE_MUST_BE_GCP_SECRET_MANAGER');
}

const stager = new GcsPublicationAssetStager({
  projectId: env.GCP_PROJECT_ID,
  bucketName: env.INSTAGRAM_PUBLICATION_ASSET_BUCKET,
});
const asset = await stager.stage({
  assetId: env.INSTAGRAM_PUBLICATION_ASSET_ID,
  correlationId: env.INSTAGRAM_PUBLICATION_CORRELATION_ID,
  sourcePath: env.INSTAGRAM_PUBLICATION_ASSET_SOURCE_PATH,
  contentType: env.INSTAGRAM_PUBLICATION_ASSET_CONTENT_TYPE,
});

const metaClient = createMetaPublicationApiClient(config);
const pages = await metaClient.get('me/accounts', {
  fields: 'id,instagram_business_account{id}',
  limit: '100',
});
const pageId = findPageIdForInstagramAccount(pages, env.INSTAGRAM_BUSINESS_ACCOUNT_ID);
const caption = Buffer.from(env.INSTAGRAM_FIRST_PUBLICATION_CAPTION_BASE64, 'base64').toString('utf8');
if (!caption.trim()) throw new Error('INSTAGRAM_FIRST_PUBLICATION_CAPTION_EMPTY');

const manifest = createInstagramPublicationApprovalManifest({
  account: {
    pageId,
    instagramAccountId: env.INSTAGRAM_BUSINESS_ACCOUNT_ID,
  },
  mediaType: 'IMAGE',
  mediaUrls: [asset.publicUrl],
  caption,
  correlationId: env.INSTAGRAM_PUBLICATION_CORRELATION_ID,
  idempotencyKey: env.INSTAGRAM_FIRST_PUBLICATION_IDEMPOTENCY_KEY,
});

process.stdout.write(`INSTAGRAM_FIRST_PUBLICATION_PREPARE_RESULT=${JSON.stringify({ asset, manifest })}\n`);

function findPageIdForInstagramAccount(value: unknown, instagramAccountId: string): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('META_PAGES_RESPONSE_INVALID');
  }
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data)) throw new Error('META_PAGES_RESPONSE_INVALID');

  for (const item of data) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const record = item as { id?: unknown; instagram_business_account?: unknown };
    if (typeof record.id !== 'string' || !record.id) continue;
    const instagramAccount = record.instagram_business_account;
    if (
      typeof instagramAccount === 'object' &&
      instagramAccount !== null &&
      !Array.isArray(instagramAccount) &&
      (instagramAccount as { id?: unknown }).id === instagramAccountId
    ) {
      return record.id;
    }
  }

  throw new Error('INSTAGRAM_FIRST_PUBLICATION_PAGE_NOT_FOUND');
}
