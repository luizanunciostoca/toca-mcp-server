import { loadConfig } from './config.js';
import { MetaAdsControlledGraphProvider } from './providers/meta-ads/meta-ads-controlled-graph-provider.js';
import { buildTheParty20260904Descriptor } from './providers/meta-ads/meta-ads-the-party-2026-09-04-plan.js';
import { createMetaPublicationApiClient } from './providers/meta/meta-publication-client.js';

const APPROVAL = 'APPROVED_THE_PARTY_2026_09_04_STORIES_ONLY_LINK_7175';
const PRODUCT_URL =
  'https://tocadomorcego.com.br/produtos/the-party-by-toca-experience-7175.html';

const suppliedApproval = requiredEnv('META_ADS_THE_PARTY_0904_FIX_APPROVAL');
if (suppliedApproval !== APPROVAL) {
  throw new Error('META_ADS_THE_PARTY_0904_FIX_APPROVAL_MISMATCH');
}

const descriptor = buildTheParty20260904Descriptor();
const api = createMetaPublicationApiClient(loadConfig(process.env));
const provider = new MetaAdsControlledGraphProvider(api);

const storiesTargeting = {
  ...descriptor.adSet.targeting,
  publisher_platforms: ['facebook', 'instagram'],
  facebook_positions: ['story'],
  instagram_positions: ['story'],
};

const expectedDestinationByAdName = new Map(
  descriptor.assets.map((asset) => [asset.adName, correctedDestination(asset.destinationUrl)]),
);

const campaigns = arrayRecords(
  asRecord(
    await api.get(`act_${descriptor.account.adAccountId}/campaigns`, {
      fields: 'id,name,objective,status,effective_status',
      limit: '100',
    }),
  ).data,
).filter((campaign) => scalarString(campaign.name) === descriptor.campaign.name);

if (campaigns.length !== 1) {
  throw new Error('META_ADS_THE_PARTY_0904_FIX_CAMPAIGN_COUNT_MISMATCH');
}

const campaign = campaigns[0];
if (!campaign) throw new Error('META_ADS_THE_PARTY_0904_FIX_CAMPAIGN_MISSING');
if (scalarString(campaign.status) !== 'PAUSED') {
  throw new Error('META_ADS_THE_PARTY_0904_FIX_CAMPAIGN_NOT_PAUSED');
}
const campaignId = requiredScalar(campaign.id, 'CAMPAIGN_ID');

const adSets = arrayRecords(
  asRecord(
    await api.get(`${campaignId}/adsets`, {
      fields:
        'id,name,status,effective_status,lifetime_budget,start_time,end_time,targeting,promoted_object',
      limit: '100',
    }),
  ).data,
);
if (adSets.length !== 1) {
  throw new Error('META_ADS_THE_PARTY_0904_FIX_ADSET_COUNT_MISMATCH');
}
const adSet = adSets[0];
if (!adSet) throw new Error('META_ADS_THE_PARTY_0904_FIX_ADSET_MISSING');
if (scalarString(adSet.status) !== 'PAUSED') {
  throw new Error('META_ADS_THE_PARTY_0904_FIX_ADSET_NOT_PAUSED');
}
if (finiteNumber(adSet.lifetime_budget) !== descriptor.adSet.lifetimeBudgetMinor) {
  throw new Error('META_ADS_THE_PARTY_0904_FIX_BUDGET_MISMATCH');
}
const adSetId = requiredScalar(adSet.id, 'ADSET_ID');

const ads = arrayRecords(
  asRecord(
    await api.get(`${campaignId}/ads`, {
      fields: 'id,name,status,effective_status,creative',
      limit: '100',
    }),
  ).data,
).sort((left, right) => scalarString(left.name).localeCompare(scalarString(right.name)));

if (ads.length !== descriptor.assets.length) {
  throw new Error('META_ADS_THE_PARTY_0904_FIX_AD_COUNT_MISMATCH');
}
if (ads.some((ad) => scalarString(ad.status) !== 'PAUSED')) {
  throw new Error('META_ADS_THE_PARTY_0904_FIX_AD_NOT_PAUSED');
}

const currentCreatives = new Map<string, Record<string, unknown>>();
const originalCreativeByAdId = new Map<string, string>();
for (const ad of ads) {
  const adId = requiredScalar(ad.id, 'AD_ID');
  const creativeId = requiredScalar(asRecord(ad.creative).id, 'CREATIVE_ID');
  originalCreativeByAdId.set(adId, creativeId);
  currentCreatives.set(
    adId,
    asRecord(
      await api.get(creativeId, {
        fields: 'id,name,object_story_spec',
      }),
    ),
  );
}

if (alreadyCorrect(adSet, ads, currentCreatives)) {
  console.log(
    `META_ADS_THE_PARTY_0904_STORIES_FIX_RESULT=${JSON.stringify({
      status: 'ALREADY_CORRECT',
      campaignId,
      adSetId,
      adIds: ads.map((ad) => scalarString(ad.id)),
      placements: ['facebook_story', 'instagram_story'],
      productUrl: PRODUCT_URL,
      providerMutationExecuted: false,
      activationPerformed: false,
    })}`,
  );
  process.exit(0);
}

const originalTargeting = asRecord(adSet.targeting);
const createdCreativeIds: string[] = [];

try {
  await api.post(adSetId, {
    targeting: JSON.stringify(storiesTargeting),
    status: 'PAUSED',
  });

  for (const ad of ads) {
    const adId = requiredScalar(ad.id, 'AD_ID');
    const adName = scalarString(ad.name);
    const asset = descriptor.assets.find((candidate) => candidate.adName === adName);
    if (!asset) throw new Error('META_ADS_THE_PARTY_0904_FIX_UNKNOWN_AD_NAME');

    const currentCreative = currentCreatives.get(adId);
    if (!currentCreative) {
      throw new Error('META_ADS_THE_PARTY_0904_FIX_CURRENT_CREATIVE_MISSING');
    }
    const currentSpec = asRecord(currentCreative.object_story_spec);
    const currentLinkData = asRecord(currentSpec.link_data);
    if (!scalarString(currentLinkData.image_hash) && !scalarString(currentLinkData.image_url)) {
      throw new Error('META_ADS_THE_PARTY_0904_FIX_IMAGE_REFERENCE_MISSING');
    }

    const destinationUrl = correctedDestination(asset.destinationUrl);
    const callToAction = asRecord(currentLinkData.call_to_action);
    const callToActionValue = asRecord(callToAction.value);
    const nextSpec = {
      ...currentSpec,
      link_data: {
        ...currentLinkData,
        link: destinationUrl,
        message: asset.primaryText,
        name: asset.headline,
        description: asset.description,
        call_to_action: {
          ...callToAction,
          type: asset.callToActionType,
          value: {
            ...callToActionValue,
            link: destinationUrl,
          },
        },
      },
    };

    const created = await provider.createCreative(descriptor.account, {
      name: `${asset.creativeName} | Stories Only | 7175`,
      pageId: descriptor.identity.pageId,
      instagramActorId: descriptor.identity.instagramUserId,
      objectStorySpec: nextSpec,
    });
    createdCreativeIds.push(created.id);

    await api.post(adId, {
      creative: JSON.stringify({ creative_id: created.id }),
      status: 'PAUSED',
    });
  }

  const verification = await readback(campaignId, adSetId);
  assertFinalState(verification);

  console.log(
    `META_ADS_THE_PARTY_0904_STORIES_FIX_RESULT=${JSON.stringify({
      status: 'STORIES_ONLY_LINK_CORRECTED_PAUSED',
      campaignId,
      adSetId,
      adIds: ads.map((ad) => scalarString(ad.id)),
      newCreativeIds: createdCreativeIds,
      placements: ['facebook_story', 'instagram_story'],
      productUrl: PRODUCT_URL,
      providerMutationExecuted: true,
      activationPerformed: false,
      verification,
    })}`,
  );
} catch (error) {
  const rollbackErrors: string[] = [];

  try {
    await api.post(adSetId, {
      targeting: JSON.stringify(originalTargeting),
      status: 'PAUSED',
    });
  } catch (rollbackError) {
    rollbackErrors.push(normalizeError(rollbackError));
  }

  for (const ad of ads) {
    const adId = scalarString(ad.id);
    const originalCreativeId = originalCreativeByAdId.get(adId);
    if (!adId || !originalCreativeId) continue;
    try {
      await api.post(adId, {
        creative: JSON.stringify({ creative_id: originalCreativeId }),
        status: 'PAUSED',
      });
    } catch (rollbackError) {
      rollbackErrors.push(normalizeError(rollbackError));
    }
  }

  throw new Error(
    `META_ADS_THE_PARTY_0904_FIX_FAILED:${normalizeError(error)}:ROLLBACK=${JSON.stringify(
      rollbackErrors,
    )}`,
  );
}

function alreadyCorrect(
  adSetValue: Readonly<Record<string, unknown>>,
  adValues: readonly Readonly<Record<string, unknown>>[],
  creativeByAdId: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
): boolean {
  if (!isStoriesOnlyTargeting(asRecord(adSetValue.targeting))) return false;

  return adValues.every((ad) => {
    const adId = scalarString(ad.id);
    const expected = expectedDestinationByAdName.get(scalarString(ad.name));
    const creative = creativeByAdId.get(adId);
    if (!expected || !creative) return false;
    const linkData = asRecord(asRecord(creative.object_story_spec).link_data);
    return scalarString(linkData.link) === expected;
  });
}

async function readback(
  campaignIdValue: string,
  adSetIdValue: string,
): Promise<Readonly<Record<string, unknown>>> {
  const campaignValue = asRecord(
    await api.get(campaignIdValue, {
      fields: 'id,name,status,effective_status',
    }),
  );
  const adSetValue = asRecord(
    await api.get(adSetIdValue, {
      fields: 'id,name,status,effective_status,lifetime_budget,targeting',
    }),
  );
  const adValues = arrayRecords(
    asRecord(
      await api.get(`${campaignIdValue}/ads`, {
        fields: 'id,name,status,effective_status,creative',
        limit: '100',
      }),
    ).data,
  );

  const creativeValues: Record<string, unknown>[] = [];
  for (const ad of adValues) {
    const creativeId = requiredScalar(asRecord(ad.creative).id, 'READBACK_CREATIVE_ID');
    creativeValues.push(
      asRecord(
        await api.get(creativeId, {
          fields: 'id,name,object_story_spec',
        }),
      ),
    );
  }

  return {
    campaign: campaignValue,
    adSet: adSetValue,
    ads: adValues,
    creatives: creativeValues,
  };
}

function assertFinalState(verification: Readonly<Record<string, unknown>>): void {
  const campaignValue = asRecord(verification.campaign);
  const adSetValue = asRecord(verification.adSet);
  const adValues = arrayRecords(verification.ads);
  const creativeValues = arrayRecords(verification.creatives);

  if (scalarString(campaignValue.status) !== 'PAUSED') {
    throw new Error('META_ADS_THE_PARTY_0904_FIX_FINAL_CAMPAIGN_NOT_PAUSED');
  }
  if (scalarString(adSetValue.status) !== 'PAUSED') {
    throw new Error('META_ADS_THE_PARTY_0904_FIX_FINAL_ADSET_NOT_PAUSED');
  }
  if (finiteNumber(adSetValue.lifetime_budget) !== descriptor.adSet.lifetimeBudgetMinor) {
    throw new Error('META_ADS_THE_PARTY_0904_FIX_FINAL_BUDGET_MISMATCH');
  }
  if (!isStoriesOnlyTargeting(asRecord(adSetValue.targeting))) {
    throw new Error('META_ADS_THE_PARTY_0904_FIX_FINAL_PLACEMENTS_MISMATCH');
  }
  if (adValues.length !== descriptor.assets.length || creativeValues.length !== adValues.length) {
    throw new Error('META_ADS_THE_PARTY_0904_FIX_FINAL_COUNTS_MISMATCH');
  }
  if (adValues.some((ad) => scalarString(ad.status) !== 'PAUSED')) {
    throw new Error('META_ADS_THE_PARTY_0904_FIX_FINAL_AD_NOT_PAUSED');
  }

  for (let index = 0; index < adValues.length; index += 1) {
    const ad = adValues[index];
    const creative = creativeValues[index];
    if (!ad || !creative) throw new Error('META_ADS_THE_PARTY_0904_FIX_FINAL_INDEX_MISSING');
    const expected = expectedDestinationByAdName.get(scalarString(ad.name));
    if (!expected) throw new Error('META_ADS_THE_PARTY_0904_FIX_FINAL_AD_NAME_UNKNOWN');
    const linkData = asRecord(asRecord(creative.object_story_spec).link_data);
    if (scalarString(linkData.link) !== expected) {
      throw new Error('META_ADS_THE_PARTY_0904_FIX_FINAL_DESTINATION_MISMATCH');
    }
    const ctaValue = asRecord(asRecord(linkData.call_to_action).value);
    if (scalarString(ctaValue.link) !== expected) {
      throw new Error('META_ADS_THE_PARTY_0904_FIX_FINAL_CTA_LINK_MISMATCH');
    }
  }
}

function isStoriesOnlyTargeting(targeting: Readonly<Record<string, unknown>>): boolean {
  return (
    sortedStrings(targeting.publisher_platforms).join(',') === 'facebook,instagram' &&
    sortedStrings(targeting.facebook_positions).join(',') === 'story' &&
    sortedStrings(targeting.instagram_positions).join(',') === 'story'
  );
}

function correctedDestination(currentUrl: string): string {
  const source = new URL(currentUrl);
  const destination = new URL(PRODUCT_URL);
  destination.search = source.search;
  destination.searchParams.delete('fbclid');
  return destination.toString();
}

function sortedStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(scalarString).filter(Boolean).sort() : [];
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
  if (!result) throw new Error(`META_ADS_THE_PARTY_0904_FIX_${label}_MISSING`);
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

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MISSING_REQUIRED_ENV_${name}`);
  return value;
}
