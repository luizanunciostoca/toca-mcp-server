import pg from 'pg';
import { resolveMetaPageAccessToken } from './instagram-engagement-meta-auth.js';
import { deriveMetaWebhookVerifyToken } from '../providers/meta/meta-webhook-verify-token.js';

const { Pool } = pg;
const INBOUND_TYPE = 'instagram.engagement.inbound.v1';

interface InboundHealthRow {
  count_30m: number;
  count_6h: number;
  count_24h: number;
  valid_count_24h: number;
  latest_at: Date | string | null;
}

const databaseUrl = requiredEnv('DATABASE_URL');
const appId = requiredEnv('META_APP_ID');
const appSecret = requiredEnv('META_APP_SECRET');
const metaAccessToken = requiredEnv('META_ACCESS_TOKEN');
const pageId = requiredEnv('INSTAGRAM_ENGAGEMENT_PAGE_ID');
const accountId = requiredEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID');
const webhookUrl = requiredEnv('INSTAGRAM_ENGAGEMENT_WEBHOOK_URL').replace(/\/$/, '');
const graphBaseUrl = (
  process.env.META_GRAPH_BASE_URL?.trim() || 'https://graph.facebook.com'
).replace(/\/$/, '');
const apiVersion = process.env.META_GRAPH_API_VERSION?.trim() || 'v24.0';
const pool = new Pool({ connectionString: databaseUrl, max: 2 });

let databaseReadPass = false;
let recentCommentCount30m = 0;
let recentCommentCount6h = 0;
let recentCommentCount24h = 0;
let validCommentCount24h = 0;
let latestCommentAgeMinutes: number | null = null;

let providerReadPass = false;
let appInstagramSubscriptionPresent = false;
let appCallbackUrlMatch = false;
let appCommentsFieldPresent = false;
let appMessagesFieldPresent = false;
let pageAppSubscriptionPresent = false;
let pageMessagesFieldPresent = false;
let callbackChallengePass = false;

try {
  try {
    const inbound = await pool.query<InboundHealthRow>(
      `select
         count(*) filter (where inbound.occurred_at >= now() - interval '30 minutes')::int as count_30m,
         count(*) filter (where inbound.occurred_at >= now() - interval '6 hours')::int as count_6h,
         count(*) filter (where inbound.occurred_at >= now() - interval '24 hours')::int as count_24h,
         count(*) filter (
           where inbound.occurred_at >= now() - interval '24 hours'
             and nullif(trim(inbound.payload->>'commentId'),'') is not null
             and nullif(trim(inbound.payload->>'senderId'),'') is not null
             and nullif(trim(inbound.payload->>'text'),'') is not null
         )::int as valid_count_24h,
         max(inbound.occurred_at) as latest_at
       from event_outbox inbound
      where inbound.event_type = $1
        and inbound.status = 'DELIVERED'
        and inbound.payload->>'channel' = 'COMMENT'
        and inbound.payload->>'accountId' = $2`,
      [INBOUND_TYPE, accountId],
    );
    const row = inbound.rows[0];
    recentCommentCount30m = row?.count_30m ?? 0;
    recentCommentCount6h = row?.count_6h ?? 0;
    recentCommentCount24h = row?.count_24h ?? 0;
    validCommentCount24h = row?.valid_count_24h ?? 0;
    latestCommentAgeMinutes = ageMinutes(row?.latest_at ?? null);
    databaseReadPass = true;
  } catch {
    databaseReadPass = false;
  }

  try {
    const pageAccessToken = await resolveMetaPageAccessToken({
      rootToken: metaAccessToken,
      expectedPageId: pageId,
      graphBaseUrl,
      apiVersion,
    });

    const appAccessToken = `${appId}|${appSecret}`;
    const appSubscriptionsUrl = new URL(`${graphBaseUrl}/${apiVersion}/${appId}/subscriptions`);
    appSubscriptionsUrl.searchParams.set('access_token', appAccessToken);
    const appSubscriptions = await readJson(appSubscriptionsUrl);
    const instagramSubscription = asArray(asRecord(appSubscriptions).data)
      .map(asRecord)
      .find((entry) => safeScalarString(entry.object) === 'instagram');
    appInstagramSubscriptionPresent = Boolean(instagramSubscription);
    appCallbackUrlMatch =
      normalizedCallbackUrl(safeScalarString(instagramSubscription?.callback_url)) ===
      normalizedCallbackUrl(`${webhookUrl}/webhooks/meta`);
    const appFields = fieldNames(instagramSubscription?.fields);
    appCommentsFieldPresent = appFields.has('comments');
    appMessagesFieldPresent = appFields.has('messages');

    const pageSubscriptionsUrl = new URL(`${graphBaseUrl}/${apiVersion}/${pageId}/subscribed_apps`);
    pageSubscriptionsUrl.searchParams.set('fields', 'id,subscribed_fields');
    pageSubscriptionsUrl.searchParams.set('access_token', pageAccessToken);
    const pageSubscriptions = await readJson(pageSubscriptionsUrl);
    const pageApp = asArray(asRecord(pageSubscriptions).data)
      .map(asRecord)
      .find((entry) => safeScalarString(entry.id) === appId);
    pageAppSubscriptionPresent = Boolean(pageApp);
    const pageFields = fieldNames(pageApp?.subscribed_fields);
    pageMessagesFieldPresent = pageFields.has('messages');
    providerReadPass = true;
  } catch {
    providerReadPass = false;
  }

  try {
    const verifyToken = deriveMetaWebhookVerifyToken(appSecret);
    const challenge = `readonly-health-${Date.now()}`;
    const challengeUrl = new URL(`${webhookUrl}/webhooks/meta`);
    challengeUrl.searchParams.set('hub.mode', 'subscribe');
    challengeUrl.searchParams.set('hub.verify_token', verifyToken);
    challengeUrl.searchParams.set('hub.challenge', challenge);
    const response = await fetch(challengeUrl, { method: 'GET' });
    callbackChallengePass = response.ok && (await response.text()) === challenge;
  } catch {
    callbackChallengePass = false;
  }

  const status = resolveStatus();
  console.log(`INSTAGRAM_ENGAGEMENT_INGESTION_HEALTH_READONLY=${status}`);
  console.log('SUBSCRIPTION_MODEL=FACEBOOK_LOGIN_PAGE_BOUND');
  console.log(`DATABASE_READ_PASS=${databaseReadPass}`);
  console.log(`PROVIDER_READ_PASS=${providerReadPass}`);
  console.log(`APP_INSTAGRAM_SUBSCRIPTION_PRESENT=${appInstagramSubscriptionPresent}`);
  console.log(`APP_CALLBACK_URL_MATCH=${appCallbackUrlMatch}`);
  console.log(`APP_COMMENTS_FIELD_PRESENT=${appCommentsFieldPresent}`);
  console.log(`APP_MESSAGES_FIELD_PRESENT=${appMessagesFieldPresent}`);
  console.log(`PAGE_APP_SUBSCRIPTION_PRESENT=${pageAppSubscriptionPresent}`);
  console.log(`PAGE_MESSAGES_FIELD_PRESENT=${pageMessagesFieldPresent}`);
  console.log(`CALLBACK_CHALLENGE_PASS=${callbackChallengePass}`);
  console.log(`RECENT_COMMENT_COUNT_30M=${recentCommentCount30m}`);
  console.log(`RECENT_COMMENT_COUNT_6H=${recentCommentCount6h}`);
  console.log(`RECENT_COMMENT_COUNT_24H=${recentCommentCount24h}`);
  console.log(`VALID_COMMENT_COUNT_24H=${validCommentCount24h}`);
  console.log(
    `LATEST_COMMENT_AGE_MINUTES=${latestCommentAgeMinutes === null ? 'NONE' : latestCommentAgeMinutes}`,
  );
  console.log('DATABASE_MUTATIONS=false');
  console.log('PROVIDER_METHODS=GET_ONLY');
  console.log('PROVIDER_WRITES=false');
  console.log('PERSISTENT_SERVICE_MUTATIONS=false');
  console.log('EXTERNAL_REPLY_WRITES=false');
  console.log('RAW_USER_DATA_LOGGED=false');
  console.log('SECRETS_PRINTED=false');
} finally {
  await pool.end();
}

function resolveStatus(): string {
  if (!databaseReadPass) return 'BLOCKED_DATABASE_READ';
  if (!providerReadPass) return 'BLOCKED_PROVIDER_READ';
  if (!appInstagramSubscriptionPresent) return 'BLOCKED_APP_SUBSCRIPTION';
  if (!appCallbackUrlMatch) return 'BLOCKED_APP_CALLBACK_URL';
  if (!appCommentsFieldPresent) return 'BLOCKED_APP_COMMENTS_FIELD';
  if (!appMessagesFieldPresent) return 'BLOCKED_APP_MESSAGES_FIELD';
  if (!pageAppSubscriptionPresent) return 'BLOCKED_PAGE_SUBSCRIPTION';
  if (!pageMessagesFieldPresent) return 'BLOCKED_PAGE_MESSAGES_FIELD';
  if (!callbackChallengePass) return 'BLOCKED_CALLBACK_CHALLENGE';
  return 'PASS';
}

async function readJson(url: URL): Promise<unknown> {
  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) throw new Error('INGESTION_HEALTH_PROVIDER_READ_FAILED');
  return response.json();
}

function fieldNames(value: unknown): Set<string> {
  const names = new Set<string>();
  if (typeof value === 'string') {
    for (const part of value.split(',')) {
      const name = part.trim();
      if (name) names.add(name);
    }
    return names;
  }
  for (const item of asArray(value)) {
    if (typeof item === 'string') {
      if (item.trim()) names.add(item.trim());
      continue;
    }
    const name = safeScalarString(asRecord(item).name).trim();
    if (name) names.add(name);
  }
  return names;
}

function normalizedCallbackUrl(value: string): string {
  return value.trim().replace(/\/$/, '');
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function safeScalarString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return '';
}

function ageMinutes(value: Date | string | null): number | null {
  if (value === null) return null;
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}
