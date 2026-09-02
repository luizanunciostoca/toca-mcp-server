import { buildTheParty20260904Descriptor } from './providers/meta-ads/meta-ads-the-party-2026-09-04-plan.js';
import { createMetaPublicationApiClient } from './providers/meta/meta-publication-client.js';
import { loadConfig } from './config.js';

const descriptor = buildTheParty20260904Descriptor();
const api = createMetaPublicationApiClient(loadConfig(process.env));

const campaignsResponse = asRecord(
  await api.get(`act_${descriptor.account.adAccountId}/campaigns`, {
    fields: 'id,name,objective,status,effective_status,created_time,updated_time',
    limit: '100',
  }),
);
const campaigns = arrayRecords(campaignsResponse.data);
const campaign = campaigns.find((item) => scalarString(item.name) === descriptor.campaign.name);
if (!campaign) throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_CAMPAIGN_NOT_FOUND');

const campaignId = requiredScalar(campaign.id, 'CAMPAIGN_ID');
const campaignReadback = asRecord(
  await api.get(campaignId, {
    fields: 'id,name,objective,status,effective_status,created_time,updated_time',
  }),
);

const adSetsResponse = asRecord(
  await api.get(`${campaignId}/adsets`, {
    fields:
      'id,name,campaign_id,status,effective_status,lifetime_budget,budget_remaining,bid_strategy,optimization_goal,billing_event,start_time,end_time,targeting,promoted_object,created_time,updated_time',
    limit: '100',
  }),
);
const adSets = arrayRecords(adSetsResponse.data);
if (adSets.length !== 1) throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_ADSET_COUNT_MISMATCH');
const adSet = adSets[0];
if (!adSet) throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_ADSET_MISSING');

const adsResponse = asRecord(
  await api.get(`${campaignId}/ads`, {
    fields: 'id,name,adset_id,campaign_id,status,effective_status,creative,created_time,updated_time',
    limit: '100',
  }),
);
const ads = arrayRecords(adsResponse.data).sort((left, right) =>
  scalarString(left.name).localeCompare(scalarString(right.name)),
);
if (ads.length !== descriptor.assets.length) {
  throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_AD_COUNT_MISMATCH');
}

const creatives: Readonly<Record<string, unknown>>[] = [];
for (const ad of ads) {
  const creativeRef = asRecord(ad.creative);
  const creativeId = requiredScalar(creativeRef.id, 'CREATIVE_ID');
  creatives.push(
    asRecord(
      await api.get(creativeId, {
        fields: 'id,name,object_story_spec,effective_object_story_id,status',
      }),
    ),
  );
}

assertCampaign(campaignReadback);
assertAdSet(adSet);
assertAdsAndCreatives(ads, creatives);

const result = {
  status: 'RECONCILED_EXISTING_PAUSED_CAMPAIGN',
  providerMutationExecuted: false,
  activationPerformed: false,
  campaign: pick(campaignReadback, [
    'id',
    'name',
    'objective',
    'status',
    'effective_status',
    'created_time',
    'updated_time',
  ]),
  adSet: pick(adSet, [
    'id',
    'name',
    'campaign_id',
    'status',
    'effective_status',
    'lifetime_budget',
    'budget_remaining',
    'bid_strategy',
    'optimization_goal',
    'billing_event',
    'start_time',
    'end_time',
    'targeting',
    'promoted_object',
  ]),
  ads: ads.map((ad, index) => ({
    ...pick(ad, ['id', 'name', 'adset_id', 'campaign_id', 'status', 'effective_status']),
    creative: summarizeCreative(creatives[index] ?? {}),
  })),
  expectedCreativeNames: descriptor.assets.map((asset) => asset.creativeName),
  returnedCreativeNames: creatives.map((creative) => scalarString(creative.name)),
};

console.log(`META_ADS_THE_PARTY_0904_RECONCILE_RESULT=${JSON.stringify(result)}`);

function assertCampaign(campaignValue: Readonly<Record<string, unknown>>): void {
  if (scalarString(campaignValue.name) !== descriptor.campaign.name) {
    throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_CAMPAIGN_NAME_MISMATCH');
  }
  if (scalarString(campaignValue.objective) !== descriptor.campaign.objective) {
    throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_CAMPAIGN_OBJECTIVE_MISMATCH');
  }
  if (scalarString(campaignValue.status) !== 'PAUSED') {
    throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_CAMPAIGN_NOT_PAUSED');
  }
}

function assertAdSet(adSetValue: Readonly<Record<string, unknown>>): void {
  if (scalarString(adSetValue.name) !== descriptor.adSet.name) {
    throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_ADSET_NAME_MISMATCH');
  }
  if (scalarString(adSetValue.status) !== 'PAUSED') {
    throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_ADSET_NOT_PAUSED');
  }
  if (finiteNumber(adSetValue.lifetime_budget) !== descriptor.adSet.lifetimeBudgetMinor) {
    throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_BUDGET_MISMATCH');
  }
  if (scalarString(adSetValue.optimization_goal) !== descriptor.adSet.optimizationGoal) {
    throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_OPTIMIZATION_MISMATCH');
  }
  if (scalarString(adSetValue.billing_event) !== descriptor.adSet.billingEvent) {
    throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_BILLING_MISMATCH');
  }
  assertSameInstant(adSetValue.start_time, descriptor.adSet.startTime, 'START');
  assertSameInstant(adSetValue.end_time, descriptor.adSet.endTime, 'END');

  const promotedObject = asRecord(adSetValue.promoted_object);
  if (scalarString(promotedObject.pixel_id) !== descriptor.adSet.promotedObject.pixel_id) {
    throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_PIXEL_MISMATCH');
  }
  if (
    scalarString(promotedObject.custom_event_type) !== descriptor.adSet.promotedObject.custom_event_type
  ) {
    throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_EVENT_MISMATCH');
  }

  const targeting = asRecord(adSetValue.targeting);
  if (finiteNumber(targeting.age_min) !== 21 || finiteNumber(targeting.age_max) !== 45) {
    throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_AGE_MISMATCH');
  }
  const automation = asRecord(targeting.targeting_automation);
  if (finiteNumber(automation.advantage_audience) !== 0) {
    throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_ADVANTAGE_AUDIENCE_MISMATCH');
  }
  const platforms = Array.isArray(targeting.publisher_platforms)
    ? targeting.publisher_platforms.map(scalarString).sort()
    : [];
  if (platforms.join(',') !== 'facebook,instagram') {
    throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_PLATFORMS_MISMATCH');
  }
  const geo = asRecord(targeting.geo_locations);
  const locations = arrayRecords(geo.custom_locations);
  const location = locations[0];
  if (!location || locations.length !== 1) {
    throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_GEO_COUNT_MISMATCH');
  }
  if (
    !approximatelyEqual(finiteNumber(location.latitude), -13.3833) ||
    !approximatelyEqual(finiteNumber(location.longitude), -38.9167) ||
    finiteNumber(location.radius) !== 2 ||
    scalarString(location.distance_unit) !== 'kilometer'
  ) {
    throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_GEO_MISMATCH');
  }
}

function assertAdsAndCreatives(
  adValues: readonly Readonly<Record<string, unknown>>[],
  creativeValues: readonly Readonly<Record<string, unknown>>[],
): void {
  if (adValues.some((ad) => scalarString(ad.status) !== 'PAUSED')) {
    throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_AD_NOT_PAUSED');
  }
  if (creativeValues.length !== descriptor.assets.length) {
    throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_CREATIVE_COUNT_MISMATCH');
  }

  const assetsByAdName = new Map(descriptor.assets.map((asset) => [asset.adName, asset]));
  for (let index = 0; index < adValues.length; index += 1) {
    const ad = adValues[index];
    const creative = creativeValues[index];
    if (!ad || !creative) throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_INDEX_MISSING');
    const asset = assetsByAdName.get(scalarString(ad.name));
    if (!asset) throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_AD_NAME_UNKNOWN');

    const spec = asRecord(creative.object_story_spec);
    const linkData = asRecord(spec.link_data);
    if (scalarString(linkData.link) !== asset.destinationUrl) {
      throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_DESTINATION_MISMATCH');
    }
    if (scalarString(linkData.message) !== asset.primaryText) {
      throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_PRIMARY_TEXT_MISMATCH');
    }
    if (scalarString(linkData.name) !== asset.headline) {
      throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_HEADLINE_MISMATCH');
    }
    if (scalarString(linkData.description) !== asset.description) {
      throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_DESCRIPTION_MISMATCH');
    }
    const callToAction = asRecord(linkData.call_to_action);
    if (scalarString(callToAction.type) !== asset.callToActionType) {
      throw new Error('META_ADS_THE_PARTY_0904_RECONCILE_CTA_MISMATCH');
    }
  }
}

function summarizeCreative(creative: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const spec = asRecord(creative.object_story_spec);
  const linkData = asRecord(spec.link_data);
  return {
    id: scalarString(creative.id),
    name: scalarString(creative.name),
    effectiveObjectStoryId: scalarString(creative.effective_object_story_id),
    destinationUrl: scalarString(linkData.link),
    message: scalarString(linkData.message),
    headline: scalarString(linkData.name),
    description: scalarString(linkData.description),
    ctaType: scalarString(asRecord(linkData.call_to_action).type),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function scalarString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function requiredScalar(value: unknown, label: string): string {
  const result = scalarString(value);
  if (!result) throw new Error(`META_ADS_THE_PARTY_0904_RECONCILE_${label}_MISSING`);
  return result;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function approximatelyEqual(value: number | undefined, expected: number): boolean {
  return value !== undefined && Math.abs(value - expected) <= 0.000001;
}

function assertSameInstant(actual: unknown, expected: string, label: string): void {
  const actualMs = new Date(scalarString(actual)).getTime();
  const expectedMs = new Date(expected).getTime();
  if (!Number.isFinite(actualMs) || actualMs !== expectedMs) {
    throw new Error(`META_ADS_THE_PARTY_0904_RECONCILE_${label}_TIME_MISMATCH`);
  }
}

function pick(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Readonly<Record<string, unknown>> {
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    if (value[key] !== undefined) output[key] = value[key];
  }
  return output;
}
