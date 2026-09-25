import { loadConfig } from './config.js';
import { createMetaPublicationApiClient } from './providers/meta/meta-publication-client.js';

const ACCOUNT_ID = '311793958882290';
const CAMPAIGN_ID = '52622846509265';
const SINCE = process.env.META_ADS_READ_SINCE?.trim() || '2026-09-07';
const UNTIL = process.env.META_ADS_READ_UNTIL?.trim() || '2026-09-25';

const config = loadConfig(process.env);
const api = createMetaPublicationApiClient(config);

const campaign = asRecord(
  await api.get(CAMPAIGN_ID, { fields: 'id,name,status,effective_status,objective' }),
);
if (scalarString(campaign.id) !== CAMPAIGN_ID) {
  throw new Error('META_ADS_PERF_CAMPAIGN_MISMATCH');
}

const common = {
  time_range: JSON.stringify({ since: SINCE, until: UNTIL }),
  action_attribution_windows: JSON.stringify(['7d_click', '1d_view']),
  limit: '500',
};

const campaignRows = await readInsights({
  ...common,
  level: 'campaign',
  fields:
    'campaign_id,campaign_name,spend,impressions,reach,frequency,clicks,inline_link_clicks,cpc,cpm,ctr,inline_link_click_ctr,actions,action_values,purchase_roas',
});

const adSetRows = await readInsights({
  ...common,
  level: 'adset',
  fields:
    'campaign_id,campaign_name,adset_id,adset_name,spend,impressions,reach,frequency,clicks,inline_link_clicks,cpc,cpm,ctr,inline_link_click_ctr,actions,action_values,purchase_roas',
});

const adRows = await readInsights({
  ...common,
  level: 'ad',
  fields:
    'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,frequency,clicks,inline_link_clicks,cpc,cpm,ctr,inline_link_click_ctr,actions,action_values,purchase_roas',
});

const placementRows = await readInsights({
  ...common,
  level: 'adset',
  breakdowns: 'publisher_platform,platform_position',
  fields:
    'campaign_id,adset_id,adset_name,spend,impressions,reach,frequency,clicks,inline_link_clicks,cpc,cpm,ctr,inline_link_click_ctr,actions,action_values,purchase_roas',
});

const ageRows = await readInsights({
  ...common,
  level: 'campaign',
  breakdowns: 'age',
  fields:
    'campaign_id,spend,impressions,reach,frequency,clicks,inline_link_clicks,cpc,cpm,ctr,inline_link_click_ctr,actions,action_values,purchase_roas',
});

type Summary = {
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  linkClicks: number;
  cpc: number;
  cpm: number;
  ctr: number;
  linkCtr: number;
  purchases: number;
  purchaseValue: number;
  cpa: number | null;
  roas: number | null;
};

const output = {
  schemaVersion: 1,
  readOnly: true,
  providerMutationExecuted: false,
  period: { since: SINCE, until: UNTIL },
  campaign: summarize(campaignRows[0] ?? {}),
  adSets: adSetRows.map((row) => ({
    id: row.adset_id,
    name: row.adset_name,
    ...summarize(row),
  })),
  topAds: adRows
    .map((row) => {
      const summary = summarize(row);
      return {
        id: row.ad_id,
        name: row.ad_name,
        adSetId: row.adset_id,
        adSetName: row.adset_name,
        ...summary,
      };
    })
    .sort((a, b) => {
      const purchaseDiff = finiteNumber(b.purchases) - finiteNumber(a.purchases);
      if (purchaseDiff !== 0) return purchaseDiff;
      return finiteNumber(b.spend) - finiteNumber(a.spend);
    })
    .slice(0, 30),
  placements: placementRows.map((row) => ({
    publisherPlatform: row.publisher_platform,
    platformPosition: row.platform_position,
    adSetId: row.adset_id,
    adSetName: row.adset_name,
    ...summarize(row),
  })),
  ages: ageRows.map((row) => ({
    age: row.age,
    ...summarize(row),
  })),
};

console.log(`META_ADS_ITACARE_PERFORMANCE_RESULT=${JSON.stringify(output)}`);

async function readInsights(params: Record<string, string>): Promise<Record<string, unknown>[]> {
  const response = asRecord(await api.get(`${CAMPAIGN_ID}/insights`, params));
  const rows = Array.isArray(response.data) ? response.data.map(asRecord) : [];
  if (rows.length >= 500) throw new Error('META_ADS_PERF_PAGINATION_REQUIRED');
  return rows;
}

function summarize(row: Record<string, unknown>): Summary {
  const spend = numberValue(row.spend);
  const purchases = actionValue(row.actions, [
    'offsite_conversion.fb_pixel_purchase',
    'purchase',
    'omni_purchase',
  ]);
  const purchaseValue = actionValue(row.action_values, [
    'offsite_conversion.fb_pixel_purchase',
    'purchase',
    'omni_purchase',
  ]);
  return {
    spend,
    impressions: numberValue(row.impressions),
    reach: numberValue(row.reach),
    frequency: numberValue(row.frequency),
    clicks: numberValue(row.clicks),
    linkClicks: numberValue(row.inline_link_clicks),
    cpc: numberValue(row.cpc),
    cpm: numberValue(row.cpm),
    ctr: numberValue(row.ctr),
    linkCtr: numberValue(row.inline_link_click_ctr),
    purchases,
    purchaseValue,
    cpa: purchases > 0 ? spend / purchases : null,
    roas: spend > 0 && purchaseValue > 0 ? purchaseValue / spend : purchaseRoas(row.purchase_roas),
  };
}

function actionValue(value: unknown, types: readonly string[]): number {
  if (!Array.isArray(value)) return 0;
  let total = 0;
  for (const item of value) {
    const record = asRecord(item);
    if (types.includes(scalarString(record.action_type))) {
      total += numberValue(record.value);
    }
  }
  return total;
}

function purchaseRoas(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    const record = asRecord(item);
    const type = scalarString(record.action_type);
    if (type === 'offsite_conversion.fb_pixel_purchase' || type === 'omni_purchase') {
      const parsed = numberValue(record.value);
      return parsed > 0 ? parsed : null;
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function scalarString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
