import { loadConfig } from './config.js';
import { MetaAdsControlledGraphProvider } from './providers/meta-ads/meta-ads-controlled-graph-provider.js';
import { createMetaPublicationApiClient } from './providers/meta/meta-publication-client.js';

const APPROVAL = 'APPROVED_THE_PARTY_2026_09_04_LEARN_MORE_CTA';
const ACCOUNT_ID = '311793958882290';
const CAMPAIGN_ID = '52621895410665';
const ADSET_ID = '52621895413265';
const PAGE_ID = '306103746115875';
const INSTAGRAM_USER_ID = '17841402033495654';
const PRODUCT_PATH = '/produtos/the-party-by-toca-experience-7175.html';
const DESIRED_CTA = 'LEARN_MORE';
const EXPECTED_AD_COUNT = 7;
const EXPECTED_BUDGET_MINOR = 30_000;

const suppliedApproval = requiredEnv('META_ADS_THE_PARTY_0904_CTA_FIX_APPROVAL');
if (suppliedApproval !== APPROVAL) {
  throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_APPROVAL_MISMATCH');
}

const account = { adAccountId: ACCOUNT_ID, currency: 'BRL' } as const;
const api = createMetaPublicationApiClient(loadConfig(process.env));
const provider = new MetaAdsControlledGraphProvider(api);

const campaign = asRecord(
  await api.get(CAMPAIGN_ID, {
    fields: 'id,name,status,effective_status,objective',
  }),
);
const initialCampaignStatus = requiredScalar(campaign.status, 'CAMPAIGN_STATUS');
if (initialCampaignStatus !== 'ACTIVE') {
  throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_CAMPAIGN_NOT_ACTIVE');
}

const adSet = asRecord(
  await api.get(ADSET_ID, {
    fields: 'id,name,campaign_id,status,effective_status,lifetime_budget,targeting',
  }),
);
const initialAdSetStatus = requiredScalar(adSet.status, 'ADSET_STATUS');
if (initialAdSetStatus !== 'ACTIVE') {
  throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_ADSET_NOT_ACTIVE');
}
if (scalarString(adSet.campaign_id) !== CAMPAIGN_ID) {
  throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_ADSET_CAMPAIGN_MISMATCH');
}
if (finiteNumber(adSet.lifetime_budget) !== EXPECTED_BUDGET_MINOR) {
  throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_BUDGET_MISMATCH');
}
if (!isStoriesOnlyTargeting(asRecord(adSet.targeting))) {
  throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_PLACEMENTS_MISMATCH');
}

const ads = arrayRecords(
  asRecord(
    await api.get(`${CAMPAIGN_ID}/ads`, {
      fields: 'id,name,adset_id,campaign_id,status,effective_status,creative',
      limit: '100',
    }),
  ).data,
).sort((left, right) => scalarString(left.name).localeCompare(scalarString(right.name)));

if (ads.length !== EXPECTED_AD_COUNT) {
  throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_AD_COUNT_MISMATCH');
}
if (
  ads.some(
    (ad) =>
      scalarString(ad.adset_id) !== ADSET_ID ||
      scalarString(ad.campaign_id) !== CAMPAIGN_ID,
  )
) {
  throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_AD_ENVELOPE_MISMATCH');
}

const originals = new Map<string, { creativeId: string; status: string }>();
const currentCreatives = new Map<string, Record<string, unknown>>();
for (const ad of ads) {
  const adId = requiredScalar(ad.id, 'AD_ID');
  const status = requiredScalar(ad.status, 'AD_STATUS');
  const creativeId = requiredScalar(asRecord(ad.creative).id, 'CREATIVE_ID');
  originals.set(adId, { creativeId, status });
  currentCreatives.set(
    adId,
    asRecord(
      await api.get(creativeId, {
        fields: 'id,name,object_story_spec',
      }),
    ),
  );
}

const mismatchedAds = ads.filter((ad) => {
  const creative = currentCreatives.get(scalarString(ad.id));
  if (!creative) return true;
  const linkData = asRecord(asRecord(creative.object_story_spec).link_data);
  const link = scalarString(linkData.link);
  const cta = asRecord(linkData.call_to_action);
  const ctaValue = asRecord(cta.value);
  return !(
    isProductDestination(link) &&
    scalarString(cta.type) === DESIRED_CTA &&
    scalarString(ctaValue.link) === link
  );
});

if (mismatchedAds.length === 0) {
  const verification = await readback();
  const summary = assertFinalState(verification, originals, initialCampaignStatus, initialAdSetStatus);
  console.log(
    `META_ADS_THE_PARTY_0904_CTA_FIX_RESULT=${JSON.stringify({
      status: 'ALREADY_LEARN_MORE',
      campaignStatus: summary.campaignStatus,
      adSetStatus: summary.adSetStatus,
      finalAdCount: summary.finalAdCount,
      activeAdCount: summary.activeAdCount,
      lifetimeBudgetMinor: summary.lifetimeBudgetMinor,
      ctaType: DESIRED_CTA,
      placements: ['facebook_story', 'instagram_story'],
      correctedAdCount: 0,
      correctedAdNames: [],
      providerMutationExecuted: false,
      activationPerformed: false,
      statusesPreserved: true,
    })}`,
  );
  process.exit(0);
}

const createdCreativeIds: string[] = [];
const correctedAdNames: string[] = [];
try {
  for (const ad of mismatchedAds) {
    const adId = requiredScalar(ad.id, 'AD_ID');
    const adName = requiredScalar(ad.name, 'AD_NAME');
    const original = originals.get(adId);
    const currentCreative = currentCreatives.get(adId);
    if (!original || !currentCreative) {
      throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_CURRENT_STATE_MISSING');
    }

    const currentSpec = asRecord(currentCreative.object_story_spec);
    const currentLinkData = asRecord(currentSpec.link_data);
    const currentLink = requiredScalar(currentLinkData.link, 'CURRENT_LINK');
    assertProductDestination(currentLink);
    if (!scalarString(currentLinkData.image_hash) && !scalarString(currentLinkData.image_url)) {
      throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_IMAGE_REFERENCE_MISSING');
    }

    const currentCta = asRecord(currentLinkData.call_to_action);
    const currentCtaValue = asRecord(currentCta.value);
    const nextSpec = {
      ...currentSpec,
      link_data: {
        ...currentLinkData,
        call_to_action: {
          ...currentCta,
          type: DESIRED_CTA,
          value: {
            ...currentCtaValue,
            link: currentLink,
          },
        },
      },
    };

    const created = await provider.createCreative(account, {
      name: `${scalarString(currentCreative.name) || adName} | Learn More`,
      pageId: PAGE_ID,
      instagramActorId: INSTAGRAM_USER_ID,
      objectStorySpec: nextSpec,
    });
    createdCreativeIds.push(created.id);

    await api.post(adId, {
      creative: JSON.stringify({ creative_id: created.id }),
      status: original.status,
    });
    correctedAdNames.push(adName);
  }

  const verification = await readback();
  const summary = assertFinalState(verification, originals, initialCampaignStatus, initialAdSetStatus);
  console.log(
    `META_ADS_THE_PARTY_0904_CTA_FIX_RESULT=${JSON.stringify({
      status: 'LEARN_MORE_CTA_CORRECTED',
      campaignStatus: summary.campaignStatus,
      adSetStatus: summary.adSetStatus,
      finalAdCount: summary.finalAdCount,
      activeAdCount: summary.activeAdCount,
      lifetimeBudgetMinor: summary.lifetimeBudgetMinor,
      ctaType: DESIRED_CTA,
      placements: ['facebook_story', 'instagram_story'],
      correctedAdCount: correctedAdNames.length,
      correctedAdNames,
      newCreativeIds: createdCreativeIds,
      providerMutationExecuted: true,
      activationPerformed: false,
      statusesPreserved: true,
    })}`,
  );
} catch (error) {
  const rollbackErrors: string[] = [];
  for (const ad of ads) {
    const adId = scalarString(ad.id);
    const original = originals.get(adId);
    if (!adId || !original) continue;
    try {
      await api.post(adId, {
        creative: JSON.stringify({ creative_id: original.creativeId }),
        status: original.status,
      });
    } catch (rollbackError) {
      rollbackErrors.push(normalizeError(rollbackError));
    }
  }
  throw new Error(
    `META_ADS_THE_PARTY_0904_CTA_FIX_FAILED:${normalizeError(error)}:ROLLBACK=${JSON.stringify(
      rollbackErrors,
    )}`,
  );
}

async function readback(): Promise<Readonly<Record<string, unknown>>> {
  const campaignValue = asRecord(
    await api.get(CAMPAIGN_ID, {
      fields: 'id,name,status,effective_status',
    }),
  );
  const adSetValue = asRecord(
    await api.get(ADSET_ID, {
      fields: 'id,name,status,effective_status,lifetime_budget,targeting',
    }),
  );
  const adValues = arrayRecords(
    asRecord(
      await api.get(`${CAMPAIGN_ID}/ads`, {
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

function assertFinalState(
  verification: Readonly<Record<string, unknown>>,
  originalByAdId: ReadonlyMap<string, { creativeId: string; status: string }>,
  expectedCampaignStatus: string,
  expectedAdSetStatus: string,
): {
  campaignStatus: string;
  adSetStatus: string;
  finalAdCount: number;
  activeAdCount: number;
  lifetimeBudgetMinor: number;
} {
  const campaignValue = asRecord(verification.campaign);
  const adSetValue = asRecord(verification.adSet);
  const adValues = arrayRecords(verification.ads);
  const creativeValues = arrayRecords(verification.creatives);
  const campaignStatus = scalarString(campaignValue.status);
  const adSetStatus = scalarString(adSetValue.status);
  const lifetimeBudgetMinor = finiteNumber(adSetValue.lifetime_budget);

  if (campaignStatus !== expectedCampaignStatus) {
    throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_FINAL_CAMPAIGN_STATUS_CHANGED');
  }
  if (adSetStatus !== expectedAdSetStatus) {
    throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_FINAL_ADSET_STATUS_CHANGED');
  }
  if (lifetimeBudgetMinor !== EXPECTED_BUDGET_MINOR) {
    throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_FINAL_BUDGET_MISMATCH');
  }
  if (!isStoriesOnlyTargeting(asRecord(adSetValue.targeting))) {
    throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_FINAL_PLACEMENTS_MISMATCH');
  }
  if (adValues.length !== EXPECTED_AD_COUNT || creativeValues.length !== EXPECTED_AD_COUNT) {
    throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_FINAL_COUNTS_MISMATCH');
  }

  for (const ad of adValues) {
    const adId = requiredScalar(ad.id, 'FINAL_AD_ID');
    const original = originalByAdId.get(adId);
    if (!original || scalarString(ad.status) !== original.status) {
      throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_FINAL_AD_STATUS_CHANGED');
    }
  }

  for (const creative of creativeValues) {
    const linkData = asRecord(asRecord(creative.object_story_spec).link_data);
    const link = scalarString(linkData.link);
    assertProductDestination(link);
    const cta = asRecord(linkData.call_to_action);
    const ctaValue = asRecord(cta.value);
    if (scalarString(cta.type) !== DESIRED_CTA) {
      throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_FINAL_CTA_TYPE_MISMATCH');
    }
    if (scalarString(ctaValue.link) !== link) {
      throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_FINAL_CTA_LINK_MISMATCH');
    }
  }

  return {
    campaignStatus,
    adSetStatus,
    finalAdCount: adValues.length,
    activeAdCount: adValues.filter((ad) => scalarString(ad.status) === 'ACTIVE').length,
    lifetimeBudgetMinor: lifetimeBudgetMinor ?? 0,
  };
}

function isStoriesOnlyTargeting(targeting: Readonly<Record<string, unknown>>): boolean {
  return (
    sortedStrings(targeting.publisher_platforms).join(',') === 'facebook,instagram' &&
    sortedStrings(targeting.facebook_positions).join(',') === 'story' &&
    sortedStrings(targeting.instagram_positions).join(',') === 'story'
  );
}

function assertProductDestination(value: string): void {
  if (!isProductDestination(value)) {
    throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_DESTINATION_MISMATCH');
  }
}

function isProductDestination(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === 'tocadomorcego.com.br' && url.pathname === PRODUCT_PATH;
  } catch {
    return false;
  }
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
  if (!result) throw new Error(`META_ADS_THE_PARTY_0904_CTA_FIX_${label}_MISSING`);
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
