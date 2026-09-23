import { loadConfig } from './config.js';
import { createMetaPublicationApiClient } from './providers/meta/meta-publication-client.js';

const ACCOUNT_ID = '311793958882290';
const CAMPAIGN_ID = '52622846509265';
const EXPECTED_CURRENCY = 'BRL';

const config = loadConfig(process.env);
const api = createMetaPublicationApiClient(config);

const account = asRecord(
  await api.get(`act_${ACCOUNT_ID}`, {
    fields: 'id,name,currency,account_status',
  }),
);
if (!String(account.id ?? '').endsWith(ACCOUNT_ID)) {
  throw new Error('META_ADS_ITACARE_READ_ACCOUNT_MISMATCH');
}
if (String(account.currency ?? '') !== EXPECTED_CURRENCY) {
  throw new Error('META_ADS_ITACARE_READ_CURRENCY_MISMATCH');
}

const campaign = asRecord(
  await api.get(CAMPAIGN_ID, {
    fields:
      'id,name,objective,status,effective_status,daily_budget,lifetime_budget,budget_remaining,bid_strategy,buying_type,start_time,stop_time',
  }),
);
if (String(campaign.id ?? '') !== CAMPAIGN_ID) {
  throw new Error('META_ADS_ITACARE_READ_CAMPAIGN_MISMATCH');
}

const adSets = await readCollection(`${CAMPAIGN_ID}/adsets`, {
  fields:
    'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,budget_remaining,bid_strategy,billing_event,optimization_goal,start_time,end_time,targeting,promoted_object,destination_type,attribution_spec',
  limit: '200',
});

const ads = await readCollection(`${CAMPAIGN_ID}/ads`, {
  fields: 'id,name,adset_id,campaign_id,status,effective_status,creative',
  limit: '500',
});

const creativeIds = [
  ...new Set(
    ads
      .map((ad) => String(asRecord(ad.creative).id ?? ''))
      .filter(Boolean),
  ),
];
const creatives: Record<string, unknown>[] = [];
for (const creativeId of creativeIds) {
  creatives.push(
    asRecord(
      await api.get(creativeId, {
        fields: 'id,name,object_story_spec,asset_feed_spec,thumbnail_url',
      }),
    ),
  );
}

const output = {
  schemaVersion: 1,
  readOnly: true,
  providerMutationExecuted: false,
  account: {
    id: account.id,
    name: account.name,
    currency: account.currency,
    accountStatus: account.account_status,
  },
  campaign,
  budgetMode: inferBudgetMode(campaign, adSets),
  adSets: adSets.map((value) => sanitizeAdSet(value)),
  ads,
  creatives,
};

console.log(
  `META_ADS_THE_PARTY_ITACARE_1011_READ_RESULT=${JSON.stringify(output)}`,
);

async function readCollection(path: string, params: Record<string, string>) {
  const response = asRecord(await api.get(path, params));
  const data = Array.isArray(response.data) ? response.data.map(asRecord) : [];
  if (data.length >= Number(params.limit ?? 100)) {
    throw new Error('META_ADS_ITACARE_READ_PAGINATION_REQUIRED');
  }
  return data;
}

function inferBudgetMode(
  campaignValue: Record<string, unknown>,
  sets: Record<string, unknown>[],
) {
  const campaignBudget =
    finiteNumber(campaignValue.daily_budget) ??
    finiteNumber(campaignValue.lifetime_budget);
  const setsWithBudget = sets.filter(
    (set) =>
      finiteNumber(set.daily_budget) != null ||
      finiteNumber(set.lifetime_budget) != null,
  ).length;
  if (campaignBudget != null && campaignBudget > 0) return 'CBO';
  if (setsWithBudget > 0) return 'ABO';
  return 'UNKNOWN';
}

function sanitizeAdSet(value: Record<string, unknown>) {
  const targeting = asRecord(value.targeting);
  return {
    ...value,
    targeting: {
      age_min: targeting.age_min,
      age_max: targeting.age_max,
      geo_locations: targeting.geo_locations,
      publisher_platforms: targeting.publisher_platforms,
      facebook_positions: targeting.facebook_positions,
      instagram_positions: targeting.instagram_positions,
      device_platforms: targeting.device_platforms,
      targeting_automation: targeting.targeting_automation,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}
