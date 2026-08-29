import { deriveMetaWebhookVerifyToken } from '../providers/meta/meta-webhook-verify-token.js';

const webhookUrl = requiredEnv('INSTAGRAM_ENGAGEMENT_SHADOW_WEBHOOK_URL').replace(/\/$/, '');
const appId = requiredEnv('META_APP_ID');
const appSecret = requiredEnv('META_APP_SECRET');
const metaAccessToken = requiredEnv('META_ACCESS_TOKEN');
const pageId = requiredEnv('INSTAGRAM_ENGAGEMENT_PAGE_ID');
const instagramAccountId = requiredEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID');
const graphBaseUrl = (
  process.env.META_GRAPH_BASE_URL?.trim() || 'https://graph.facebook.com'
).replace(/\/$/, '');
const apiVersion = process.env.META_GRAPH_API_VERSION?.trim() || 'v24.0';
const verifyToken = deriveMetaWebhookVerifyToken(appSecret);
const appAccessToken = `${appId}|${appSecret}`;
const pageAccessToken = await resolvePageAccessToken(metaAccessToken, pageId);

const challenge = `shadow-${Date.now()}`;
const challengeUrl = new URL(`${webhookUrl}/webhooks/meta`);
challengeUrl.searchParams.set('hub.mode', 'subscribe');
challengeUrl.searchParams.set('hub.verify_token', verifyToken);
challengeUrl.searchParams.set('hub.challenge', challenge);
const challengeResponse = await fetch(challengeUrl);
if (!challengeResponse.ok || (await challengeResponse.text()) !== challenge) {
  throw new Error(`META_WEBHOOK_CHALLENGE_FAILED:${challengeResponse.status}`);
}

await expectSuccess(
  `${graphBaseUrl}/${apiVersion}/${appId}/subscriptions`,
  new URLSearchParams({
    object: 'instagram',
    callback_url: `${webhookUrl}/webhooks/meta`,
    verify_token: verifyToken,
    fields: 'comments,messages',
    access_token: appAccessToken,
  }),
  'META_APP_SUBSCRIPTION_FAILED',
);

await expectSuccess(
  `${graphBaseUrl}/${apiVersion}/${pageId}/subscribed_apps`,
  new URLSearchParams({ subscribed_fields: 'messages', access_token: pageAccessToken }),
  'META_PAGE_SUBSCRIPTION_FAILED',
);

await expectSuccess(
  `${graphBaseUrl}/${apiVersion}/${instagramAccountId}/subscribed_apps`,
  new URLSearchParams({
    subscribed_fields: 'comments,messages',
    access_token: pageAccessToken,
  }),
  'META_INSTAGRAM_SUBSCRIPTION_FAILED',
);

await assertAssetSubscription(pageId, pageAccessToken, appId);
await assertAssetSubscription(instagramAccountId, pageAccessToken, appId);

console.log(
  JSON.stringify({
    validation: 'instagram-engagement-meta-subscriptions',
    status: 'PASS',
    appSubscriptionConfigured: true,
    pageSubscriptionConfigured: true,
    instagramSubscriptionConfigured: true,
    pageAccessTokenResolved: true,
    verifyTokenDerived: true,
    secretsPrinted: false,
  }),
);

async function resolvePageAccessToken(rootToken: string, expectedPageId: string): Promise<string> {
  const accountsUrl = new URL(`${graphBaseUrl}/${apiVersion}/me/accounts`);
  accountsUrl.searchParams.set('fields', 'id,access_token');
  accountsUrl.searchParams.set('limit', '100');
  accountsUrl.searchParams.set('access_token', rootToken);

  const accountsResponse = await fetch(accountsUrl);
  if (accountsResponse.ok) {
    const json = (await accountsResponse.json()) as {
      data?: readonly { id?: unknown; access_token?: unknown }[];
    };
    const match = (json.data ?? []).find(
      (item) => safeScalarString(item.id) === expectedPageId && safeScalarString(item.access_token),
    );
    const resolved = safeScalarString(match?.access_token);
    if (resolved) return resolved;
  }

  const pageUrl = new URL(`${graphBaseUrl}/${apiVersion}/${expectedPageId}`);
  pageUrl.searchParams.set('fields', 'id');
  pageUrl.searchParams.set('access_token', rootToken);
  const pageResponse = await fetch(pageUrl);
  if (!pageResponse.ok) {
    throw new Error(`META_PAGE_ACCESS_TOKEN_RESOLUTION_FAILED:${pageResponse.status}`);
  }
  const page = (await pageResponse.json()) as { id?: unknown };
  if (safeScalarString(page.id) !== expectedPageId) {
    throw new Error('META_PAGE_ACCESS_TOKEN_RESOLUTION_ID_MISMATCH');
  }
  return rootToken;
}

async function expectSuccess(url: string, body: URLSearchParams, code: string): Promise<void> {
  const response = await fetch(url, { method: 'POST', body });
  if (!response.ok) throw new Error(`${code}:${response.status}`);
  const json = (await response.json()) as { success?: unknown };
  if (json.success !== true) throw new Error(`${code}:UNCONFIRMED`);
}

async function assertAssetSubscription(
  assetId: string,
  accessToken: string,
  expectedAppId: string,
): Promise<void> {
  const url = new URL(`${graphBaseUrl}/${apiVersion}/${assetId}/subscribed_apps`);
  url.searchParams.set('access_token', accessToken);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`META_SUBSCRIPTION_READBACK_FAILED:${response.status}`);
  const json = (await response.json()) as { data?: readonly { id?: unknown }[] };
  const present = (json.data ?? []).some((item) => safeScalarString(item.id) === expectedAppId);
  if (!present) throw new Error('META_SUBSCRIPTION_READBACK_APP_MISSING');
}

function safeScalarString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return '';
}

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key}_REQUIRED`);
  return value;
}
