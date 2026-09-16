import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import { loadConfig } from './config.js';
import { createMetaPublicationApiClient } from './providers/meta/meta-publication-client.js';

const envSchema = z.object({
  INSTAGRAM_BUSINESS_ACCOUNT_ID: z.string().min(1),
  INSTAGRAM_DUPLICATE_PREFLIGHT_CONTENT_ITEM_ID: z.string().min(1),
  INSTAGRAM_DUPLICATE_PREFLIGHT_FORMAT: z.enum(['FEED_IMAGE', 'STORY_IMAGE']),
  INSTAGRAM_DUPLICATE_PREFLIGHT_EXPECTED_ASSET_SHA256: z.string().regex(/^[a-f0-9]{64}$/),
  INSTAGRAM_DUPLICATE_PREFLIGHT_SCHEDULED_AT: z.string().min(1),
  INSTAGRAM_DUPLICATE_PREFLIGHT_CAPTION_BASE64: z.string().optional(),
});

const env = envSchema.parse(process.env);
const config = loadConfig(process.env);
if (!config.META_ENABLED) throw new Error('META_ENABLED_REQUIRED');
if (config.META_TOKEN_STORE_PROVIDER !== 'gcp-secret-manager') {
  throw new Error('META_PUBLICATION_TOKEN_STORE_MUST_BE_GCP_SECRET_MANAGER');
}
if (config.INSTAGRAM_PUBLICATION_WRITES_ENABLED) {
  throw new Error('INSTAGRAM_DUPLICATE_PREFLIGHT_WRITES_MUST_BE_DISABLED');
}

const scheduledAtMs = Date.parse(env.INSTAGRAM_DUPLICATE_PREFLIGHT_SCHEDULED_AT);
if (!Number.isFinite(scheduledAtMs))
  throw new Error('INSTAGRAM_DUPLICATE_PREFLIGHT_SCHEDULE_INVALID');
const caption = env.INSTAGRAM_DUPLICATE_PREFLIGHT_CAPTION_BASE64
  ? Buffer.from(env.INSTAGRAM_DUPLICATE_PREFLIGHT_CAPTION_BASE64, 'base64').toString('utf8')
  : '';
const client = createMetaPublicationApiClient(config);
const edge = env.INSTAGRAM_DUPLICATE_PREFLIGHT_FORMAT === 'STORY_IMAGE' ? 'stories' : 'media';
const response = await client.get(`${env.INSTAGRAM_BUSINESS_ACCOUNT_ID}/${edge}`, {
  fields: 'id,caption,media_url,media_type,permalink,timestamp',
  limit: '100',
});
const items = requireData(response);
const lowerBound = scheduledAtMs - 72 * 60 * 60 * 1000;
const upperBound = Date.now() + 5 * 60 * 1000;
let inspectedMediaCount = 0;
let duplicate: { id: string; permalink?: string; sha256?: string; reason: string } | undefined;

for (const item of items) {
  const timestamp = typeof item.timestamp === 'string' ? Date.parse(item.timestamp) : Number.NaN;
  if (!Number.isFinite(timestamp) || timestamp < lowerBound || timestamp > upperBound) continue;
  inspectedMediaCount += 1;

  if (typeof item.media_url === 'string' && item.media_url.length > 0) {
    const sha256 = await hashRemoteMedia(item.media_url);
    if (sha256 === env.INSTAGRAM_DUPLICATE_PREFLIGHT_EXPECTED_ASSET_SHA256) {
      duplicate = {
        id: requireId(item),
        ...(typeof item.permalink === 'string' ? { permalink: item.permalink } : {}),
        sha256,
        reason: 'EXACT_ASSET_SHA256_MATCH',
      };
      break;
    }
    continue;
  }

  if (
    env.INSTAGRAM_DUPLICATE_PREFLIGHT_FORMAT === 'FEED_IMAGE' &&
    caption.length > 0 &&
    item.caption === caption
  ) {
    duplicate = {
      id: requireId(item),
      ...(typeof item.permalink === 'string' ? { permalink: item.permalink } : {}),
      reason: 'EXACT_CAPTION_MATCH_WITHOUT_MEDIA_URL',
    };
    break;
  }

  if (env.INSTAGRAM_DUPLICATE_PREFLIGHT_FORMAT === 'STORY_IMAGE') {
    throw new Error('INSTAGRAM_DUPLICATE_PREFLIGHT_STORY_MEDIA_URL_MISSING');
  }
}

const evidence = {
  schemaVersion: 1,
  contentItemId: env.INSTAGRAM_DUPLICATE_PREFLIGHT_CONTENT_ITEM_ID,
  instagramAccountId: env.INSTAGRAM_BUSINESS_ACCOUNT_ID,
  format: env.INSTAGRAM_DUPLICATE_PREFLIGHT_FORMAT,
  providerReadOnly: true,
  expectedAssetSha256: env.INSTAGRAM_DUPLICATE_PREFLIGHT_EXPECTED_ASSET_SHA256,
  duplicateFound: Boolean(duplicate),
  duplicatePublicationId: duplicate?.id ?? null,
  duplicatePermalink: duplicate?.permalink ?? null,
  duplicateAssetSha256: duplicate?.sha256 ?? null,
  duplicateReason: duplicate?.reason ?? null,
  inspectedMediaCount,
  checkedAt: new Date().toISOString(),
};

process.stdout.write(`INSTAGRAM_DUPLICATE_PREFLIGHT_RESULT=${JSON.stringify(evidence)}\n`);
if (duplicate) process.exitCode = 2;

async function hashRemoteMedia(url: string): Promise<string> {
  const response = await fetch(url, { method: 'GET', redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`INSTAGRAM_DUPLICATE_PREFLIGHT_MEDIA_FETCH_FAILED:${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error('INSTAGRAM_DUPLICATE_PREFLIGHT_MEDIA_EMPTY');
  return createHash('sha256').update(buffer).digest('hex');
}

function requireData(value: unknown): Array<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('INSTAGRAM_DUPLICATE_PREFLIGHT_PROVIDER_RESPONSE_INVALID');
  }
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data)) throw new Error('INSTAGRAM_DUPLICATE_PREFLIGHT_PROVIDER_DATA_INVALID');
  return data.filter(
    (item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null && !Array.isArray(item),
  );
}

function requireId(item: Record<string, unknown>): string {
  if (typeof item.id !== 'string' || item.id.length === 0) {
    throw new Error('INSTAGRAM_DUPLICATE_PREFLIGHT_PROVIDER_ID_INVALID');
  }
  return item.id;
}
