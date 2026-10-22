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

const scheduledAtMs = parseTimestamp(env.INSTAGRAM_DUPLICATE_PREFLIGHT_SCHEDULED_AT);
const upperBound = Date.now() + 5 * 60 * 1000;
if (!Number.isFinite(scheduledAtMs) || scheduledAtMs > upperBound)
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
let inspectedMediaCount = 0;
let duplicate: { id: string; permalink?: string; sha256?: string; reason: string } | undefined;

for (const item of items) {
  const timestamp = parseTimestamp(item.timestamp);
  if (!Number.isFinite(timestamp) || timestamp > upperBound) {
    throw new Error('INSTAGRAM_DUPLICATE_PREFLIGHT_PROVIDER_TIMESTAMP_INVALID');
  }
  if (timestamp < lowerBound) continue;
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
  }

  if (
    env.INSTAGRAM_DUPLICATE_PREFLIGHT_FORMAT === 'FEED_IMAGE' &&
    normalizeCaption(caption).length > 0 &&
    typeof item.caption === 'string' &&
    normalizeCaption(item.caption) === normalizeCaption(caption)
  ) {
    duplicate = {
      id: requireId(item),
      ...(typeof item.permalink === 'string' ? { permalink: item.permalink } : {}),
      reason:
        typeof item.media_url === 'string' && item.media_url.length > 0
          ? 'NORMALIZED_CAPTION_MATCH'
          : 'EXACT_CAPTION_MATCH_WITHOUT_MEDIA_URL',
    };
    break;
  }

  if (typeof item.media_url !== 'string' || item.media_url.length === 0) {
    throw new Error('INSTAGRAM_DUPLICATE_PREFLIGHT_MEDIA_URL_MISSING');
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
  // Never infer coverage from timestamp ordering or follow provider-supplied URLs.
  // A full page without a continuation marker is still ambiguous at this bound.
  if (data.length >= 100) {
    throw new Error('INSTAGRAM_DUPLICATE_PREFLIGHT_PROVIDER_COVERAGE_INCOMPLETE');
  }
  const root = value as Record<string, unknown>;
  if ('error' in root) throw new Error('INSTAGRAM_DUPLICATE_PREFLIGHT_PROVIDER_RESPONSE_INVALID');
  if ('paging' in root) {
    const paging = root.paging;
    if (typeof paging !== 'object' || paging === null || Array.isArray(paging)) {
      throw new Error('INSTAGRAM_DUPLICATE_PREFLIGHT_PROVIDER_PAGING_INVALID');
    }
    if ('next' in paging || 'previous' in paging) {
      throw new Error('INSTAGRAM_DUPLICATE_PREFLIGHT_PROVIDER_COVERAGE_INCOMPLETE');
    }
    if (Object.keys(paging).some((key) => key !== 'cursors')) {
      throw new Error('INSTAGRAM_DUPLICATE_PREFLIGHT_PROVIDER_PAGING_INVALID');
    }
    if ('cursors' in paging) {
      const cursors = paging.cursors;
      if (
        typeof cursors !== 'object' ||
        cursors === null ||
        Array.isArray(cursors) ||
        Object.entries(cursors).some(
          ([key, value]) =>
            !['before', 'after'].includes(key) || typeof value !== 'string' || value.length === 0,
        )
      ) {
        throw new Error('INSTAGRAM_DUPLICATE_PREFLIGHT_PROVIDER_PAGING_INVALID');
      }
    }
  }
  return data.map((item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error('INSTAGRAM_DUPLICATE_PREFLIGHT_PROVIDER_ITEM_INVALID');
    }
    const record = item as Record<string, unknown>;
    requireId(record);
    if (
      !Number.isFinite(parseTimestamp(record.timestamp)) ||
      parseTimestamp(record.timestamp) > upperBound
    ) {
      throw new Error('INSTAGRAM_DUPLICATE_PREFLIGHT_PROVIDER_TIMESTAMP_INVALID');
    }
    for (const field of ['caption', 'media_url', 'permalink', 'media_type']) {
      if (field in record && typeof record[field] !== 'string') {
        throw new Error('INSTAGRAM_DUPLICATE_PREFLIGHT_PROVIDER_ITEM_INVALID');
      }
    }
    if (typeof record.media_url === 'string' && record.media_url.length > 0) {
      let url: URL;
      try {
        url = new URL(record.media_url);
      } catch {
        throw new Error('INSTAGRAM_DUPLICATE_PREFLIGHT_MEDIA_URL_INVALID');
      }
      if (url.protocol !== 'https:' || url.username || url.password) {
        throw new Error('INSTAGRAM_DUPLICATE_PREFLIGHT_MEDIA_URL_INVALID');
      }
    }
    return record;
  });
}

function requireId(item: Record<string, unknown>): string {
  if (typeof item.id !== 'string' || item.id.trim().length === 0) {
    throw new Error('INSTAGRAM_DUPLICATE_PREFLIGHT_PROVIDER_ID_INVALID');
  }
  return item.id;
}

function normalizeCaption(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function parseTimestamp(value: unknown): number {
  if (typeof value !== 'string') return Number.NaN;
  // Require explicit timezone and a real calendar date; Date.parse alone rolls
  // invalid dates such as February 30 forward and accepts timezone-less input.
  const match =
    /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})$/.exec(
      value,
    );
  if (!match) return Number.NaN;
  const day = Date.parse(`${match[1]}T00:00:00Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== match[1])
    return Number.NaN;
  return Date.parse(value);
}
