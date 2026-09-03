import { resolveMetaPageAccessToken } from './instagram-engagement-meta-auth.js';
import { deriveMetaWebhookVerifyToken } from '../providers/meta/meta-webhook-verify-token.js';

const webhookUrl = requiredEnv('INSTAGRAM_ENGAGEMENT_SHADOW_WEBHOOK_URL').replace(/\/$/, '');
const appId = requiredEnv('META_APP_ID');
const appSecret = requiredEnv('META_APP_SECRET');
const metaAccessToken = requiredEnv('META_ACCESS_TOKEN');
const pageId = requiredEnv('INSTAGRAM_ENGAGEMENT_PAGE_ID');
const graphBaseUrl = (
  process.env.META_GRAPH_BASE_URL?.trim() || 'https://graph.facebook.com'
).replace(/\/$/, '');
const apiVersion = process.env.META_GRAPH_API_VERSION?.trim() || 'v24.0';
const verifyToken = deriveMetaWebhookVerifyToken(appSecret);
const appAccessToken = `${appId}|${appSecret}`;
const pageAccessToken = await resolveMetaPageAccessToken({
  rootToken: metaAccessToken,
  expectedPageId: pageId,
  graphBaseUrl,
  apiVersion,
});

const challenge = `shadow-${Date.now()}`;
const challengeUrl = new URL(`${webhookUrl}/webhooks/meta`);
challengeUrl.searchParams.set('hub.mode', 'subscribe');
challengeUrl.searchParams.set('hub.verify_token', verifyToken);
challengeUrl.searchParams.set('hub.challenge', challenge);
const challengeResponse = await fetch(challengeUrl);
if (!challengeResponse.ok || (await challengeResponse.text()) !== challenge) {
  throw new Error(`META_WEBHOOK_CHALLENGE_FAILED:${challengeResponse.status}`);
}

// TOCA currently uses Instagram API with Facebook Login semantics: the Instagram
// professional account is linked to a Facebook Page and provider access is made
// with the Page access token. In this model we configure the Instagram webhook at
// app level and bind messaging delivery through the linked Page. The separate
// per-Instagram-account /subscribed_apps edge belongs to the Instagram Login
// model (graph.instagram.com + Instagram access token) and must not be mixed into
// this Page-token flow.
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

await assertAssetSubscription(pageId, pageAccessToken, appId);

console.log(
  JSON.stringify({
    validation: 'instagram-engagement-meta-subscriptions',
    status: 'PASS',
    subscriptionModel: 'FACEBOOK_LOGIN_PAGE_BOUND',
    appSubscriptionConfigured: true,
    pageSubscriptionConfigured: true,
    // Backwards-compatible meaning: Instagram webhook delivery is configured for
    // this integration through app-level Instagram fields + linked Page binding.
    instagramSubscriptionConfigured: true,
    instagramAccountSubscriptionRequired: false,
    instagramAccountSubscriptionAttempted: false,
    pageAccessTokenResolved: true,
    verifyTokenDerived: true,
    secretsPrinted: false,
  }),
);

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
