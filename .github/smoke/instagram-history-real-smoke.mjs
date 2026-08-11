import { EnvironmentSecretResolver } from '../../dist/src/core/secrets.js';
import { InstagramHistoryProvider } from '../../dist/src/providers/instagram/instagram-history-provider.js';
import { MetaApiClient } from '../../dist/src/providers/meta/meta-api-client.js';

const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
const token = process.env.META_ACCESS_TOKEN;
if (!accountId || !token) throw new Error('Instagram smoke configuration missing');

const env = { META_ACCESS_TOKEN: token };
const secrets = new EnvironmentSecretResolver(env);
const client = new MetaApiClient(
  { graphBaseUrl: 'https://graph.facebook.com', apiVersion: 'v24.0' },
  secrets,
  { provider: 'env', key: 'META_ACCESS_TOKEN' },
);
const provider = new InstagramHistoryProvider(client, accountId);

const media = await provider.listMedia({ limit: 3 });
if (!Array.isArray(media.data)) throw new Error('media.list did not return a data array');

const permissionsResponse = await fetch('https://graph.facebook.com/v24.0/me/permissions', {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
});
const permissionsBody = await permissionsResponse.json();
if (!permissionsResponse.ok || !Array.isArray(permissionsBody.data)) {
  throw new Error(`Permission inspection failed: HTTP ${permissionsResponse.status}`);
}
const granted = new Set(
  permissionsBody.data
    .filter((item) => item && item.status === 'granted' && typeof item.permission === 'string')
    .map((item) => item.permission),
);
const insightsScopeGranted = granted.has('instagram_manage_insights');

let mediaInsightsOk = false;
let mediaInsightsStatus = insightsScopeGranted ? 'NOT_TESTED_NO_MEDIA' : 'SCOPE_NOT_GRANTED';
const firstMediaId = media.data[0]?.id;
if (insightsScopeGranted && firstMediaId) {
  try {
    const insights = await provider.getMediaInsights({ mediaId: firstMediaId, metrics: ['reach'] });
    mediaInsightsOk = Array.isArray(insights.data);
    mediaInsightsStatus = mediaInsightsOk ? 'OK' : 'INVALID_RESPONSE';
  } catch (error) {
    mediaInsightsStatus = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  }
}

let accountInsightsOk = false;
let accountInsightsStatus = insightsScopeGranted ? 'NOT_TESTED' : 'SCOPE_NOT_GRANTED';
if (insightsScopeGranted) {
  try {
    const insights = await provider.getAccountInsights({
      metrics: ['reach'],
      period: 'day',
      since: '2026-08-01',
      until: '2026-08-10',
      metricType: 'time_series',
    });
    accountInsightsOk = Array.isArray(insights.data);
    accountInsightsStatus = accountInsightsOk ? 'OK' : 'INVALID_RESPONSE';
  } catch (error) {
    accountInsightsStatus = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  }
}

console.log(
  JSON.stringify({
    validation: 'post-oauth-insights-grant',
    mediaListOk: true,
    returnedMedia: media.data.length,
    firstMediaId: firstMediaId ?? null,
    instagramBasicGranted: granted.has('instagram_basic'),
    instagramManageInsightsGranted: insightsScopeGranted,
    mediaInsightsOk,
    mediaInsightsStatus,
    accountInsightsOk,
    accountInsightsStatus,
  }),
);
