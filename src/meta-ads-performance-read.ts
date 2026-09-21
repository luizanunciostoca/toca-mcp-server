import { loadConfig } from './config.js';
import { createMetaPublicationApiClient } from './providers/meta/meta-publication-client.js';

const ACCOUNT_ID = '311793958882290';
const CAMPAIGN_ID = '52622846509265';
const SINCE = process.env.META_ADS_READ_SINCE?.trim() || '2026-09-07';
const UNTIL = process.env.META_ADS_READ_UNTIL?.trim() || '2026-09-21';

if (!/^\d{4}-\d{2}-\d{2}$/.test(SINCE) || !/^\d{4}-\d{2}-\d{2}$/.test(UNTIL)) {
  throw new Error('META_ADS_READ_DATE_INVALID');
}

const config = loadConfig(process.env);
const api = createMetaPublicationApiClient(config);

const campaign = asRecord(
  await api.get(CAMPAIGN_ID, {
    fields: 'id,name,objective,status,effective_status',
  }),
);
if (String(campaign.id ?? '') !== CAMPAIGN_ID) throw new Error('META_ADS_READ_CAMPAIGN_MISMATCH');

const account = asRecord(
  await api.get(`act_${ACCOUNT_ID}`, {
    fields: 'id,name,currency,account_status',
  }),
);
if (!String(account.id ?? '').endsWith(ACCOUNT_ID)) throw new Error('META_ADS_READ_ACCOUNT_MISMATCH');

const common = {
  time_range: JSON.stringify({ since: SINCE, until: UNTIL }),
  action_attribution_windows: JSON.stringify(['7d_click', '1d_view']),
  limit: '500',
};

const campaignInsights = await readInsights('campaign', {
  ...common,
  level: 'campaign',
  fields:
    'campaign_id,campaign_name,spend,impressions,reach,frequency,clicks,inline_link_clicks,cpc,cpm,ctr,inline_link_click_ctr,cost_per_inline_link_click,actions,cost_per_action_type',
});

const adSetInsights = await readInsights('adset', {
  ...common,
  level: 'adset',
  fields:
    'campaign_id,campaign_name,adset_id,adset_name,spend,impressions,reach,frequency,clicks,inline_link_clicks,cpc,cpm,ctr,inline_link_click_ctr,cost_per_inline_link_click,actions,cost_per_action_type',
});

const adInsights = await readInsights('ad', {
  ...common,
  level: 'ad',
  fields:
    'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,frequency,clicks,inline_link_clicks,cpc,cpm,ctr,inline_link_click_ctr,cost_per_inline_link_click,actions,cost_per_action_type',
});

const placementInsights = await readInsights('placement', {
  ...common,
  level: 'adset',
  breakdowns: 'publisher_platform,platform_position',
  fields:
    'campaign_id,campaign_name,adset_id,adset_name,spend,impressions,reach,frequency,clicks,inline_link_clicks,cpc,cpm,ctr,inline_link_click_ctr,cost_per_inline_link_click,actions,cost_per_action_type',
});

const ageInsights = await readInsights('age', {
  ...common,
  level: 'campaign',
  breakdowns: 'age',
  fields:
    'campaign_id,campaign_name,spend,impressions,reach,frequency,clicks,inline_link_clicks,cpc,cpm,ctr,inline_link_click_ctr,cost_per_inline_link_click,actions,cost_per_action_type',
});

const genderInsights = await readInsights('gender', {
  ...common,
  level: 'campaign',
  breakdowns: 'gender',
  fields:
    'campaign_id,campaign_name,spend,impressions,reach,frequency,clicks,inline_link_clicks,cpc,cpm,ctr,inline_link_click_ctr,cost_per_inline_link_click,actions,cost_per_action_type',
});

const dailyInsights = await readInsights('daily', {
  ...common,
  level: 'campaign',
  time_increment: '1',
  fields:
    'campaign_id,campaign_name,date_start,date_stop,spend,impressions,reach,frequency,clicks,inline_link_clicks,cpc,cpm,ctr,inline_link_click_ctr,cost_per_inline_link_click,actions,cost_per_action_type',
});

const output = {
  schemaVersion: 1,
  readOnly: true,
  providerMutationExecuted: false,
  account: { id: account.id, name: account.name, currency: account.currency },
  campaign,
  period: { since: SINCE, until: UNTIL },
  attribution: ['7d_click', '1d_view'],
  campaignInsights,
  adSetInsights,
  adInsights,
  placementInsights,
  ageInsights,
  genderInsights,
  dailyInsights,
};

console.log(`META_ADS_PERFORMANCE_READ_RESULT=${JSON.stringify(output)}`);

async function readInsights(
  label: string,
  params: Record<string, string>,
): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const response = asRecord(await api.get(`${CAMPAIGN_ID}/insights`, params));
  const data = Array.isArray(response.data) ? response.data.map(asRecord) : [];
  if (data.length >= 500) throw new Error(`META_ADS_READ_${label.toUpperCase()}_PAGINATION_REQUIRED`);
  return data;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
