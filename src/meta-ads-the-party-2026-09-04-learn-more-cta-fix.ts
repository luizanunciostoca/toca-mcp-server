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
const EXPECTED_AD_COUNT = 5;
const EXPECTED_BUDGET_MINOR = 30_000;

const suppliedApproval = requiredEnv('META_ADS_THE_PARTY_0904_CTA_FIX_APPROVAL');
if (suppliedApproval !== APPROVAL) {
  throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_APPROVAL_MISMATCH');
}

const account = { adAccountId: ACCOUNT_ID } as const;
const api = createMetaPublicationApiClient(loadConfig(process.env));
const provider = new MetaAdsControlledGraphProvider(api);

const campaign = asRecord(
  await api.get(CAMPAIGN_ID, {
    fields: 'id,name,status,effective_status,objective',
  }),
);
if (scalarString(campaign.status) !== 'PAUSED') {
  throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_CAMPAIGN_NOT_PAUSED');
}

const adSet = asRecord(
  await api.get(ADSET_ID, {
    fields: 'id,name,campaign_id,status,effective_status,lifetime_budget,targeting',
  }),
);
if (scalarString(adSet.status) !== 'PAUSED') {
  throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_ADSET_NOT_PAUSED');
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
      scalarString(ad.status) !== 'PAUSED' ||
      scalarString(ad.adset_id) !== ADSET_ID ||
      scalarString(ad.campaign_id) !== CAMPAIGN_ID,
  )
) {
  throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_AD_ENVELOPE_MISMATCH');
}

const originals = new Map<string, string>();
const currentCreatives = new Map<string, Record<string, unknown>>();
for (const ad of ads) {
  const adId = requiredScalar(ad.id, 'AD_ID');
  const creativeId = requiredScalar(asRecord(ad.creative).id, 'CREATIVE_ID');
  originals.set(adId, creativeId);
  currentCreatives.set(
    adId,
    asRecord(
      await api.get(creativeId, {
        fields: 'id,name,object_story_spec',
      }),
    ),
  );
}

if (allAlreadyLearnMore(ads, currentCreatives)) {
  console.log(
    `META_ADS_THE_PARTY_0904_CTA_FIX_RESULT=${JSON.stringify({
      status: 'ALREADY_LEARN_MORE_PAUSED',
      campaignId: CAMPAIGN_ID,
      adSetId: ADSET_ID,
      adIds: ads.map((ad) => scalarString(ad.id)),
      ctaType: DESIRED_CTA,
      placements: ['facebook_story', 'instagram_story'],
      providerMutationExecuted: false,
      activationPerformed: false,
    })}`,
  );
  process.exit(0);
}

const createdCreativeIds: string[] = [];
try {
  for (const ad of ads) {
    const adId = requiredScalar(ad.id, 'AD_ID');
    const currentCreative = currentCreatives.get(adId);
    if (!currentCreative) {
      throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_CURRENT_CREATIVE_MISSING');
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
      name: `${scalarString(currentCreative.name)} | Learn More`,
      pageId: PAGE_ID,
      instagramActorId: INSTAGRAM_USER_ID,
      objectStorySpec: nextSpec,
    });
    createdCreativeIds.push(created.id);

    await api.post(adId, {
      creative: JSON.stringify({ creative_id: created.id }),
      status: 'PAUSED',
    });
  }

  const verification = await readback();
  assertFinalState(verification);
  console.log(
    `META_ADS_THE_PARTY_0904_CTA_FIX_RESULT=${JSON.stringify({
      status: 'LEARN_MORE_CTA_CORRECTED_PAUSED',
      campaignId: CAMPAIGN_ID,
      adSetId: ADSET_ID,
      adIds: ads.map((ad) => scalarString(ad.id)),
      newCreativeIds: createdCreativeIds,
      ctaType: DESIRED_CTA,
      placements: ['facebook_story', 'instagram_story'],
      providerMutationExecuted: true,
      activationPerformed: false,
      verification,
    })}`,
  );
} catch (error) {
  const rollbackErrors: string[] = [];
  for (const ad of ads) {
    const adId = scalarString(ad.id);
    const originalCreativeId = originals.get(adId);
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
    `META_ADS_THE_PARTY_0904_CTA_FIX_FAILED:${normalizeError(error)}:ROLLBACK=${JSON.stringify(
      rollbackErrors,
    )}`,
  );
}

function allAlreadyLearnMore(
  adValues: readonly Readonly<Record<string, unknown>>[],
  creativeByAdId: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
): boolean {
  return adValues.every((ad) => {
    const creative = creativeByAdId.get(scalarString(ad.id));
    if (!creative) return false;
    const linkData = asRecord(asRecord(creative.object_story_spec).link_data);
    const link = scalarString(linkData.link);
    const cta = asRecord(linkData.call_to_action);
    const ctaValue = asRecord(cta.value);
    return (
      isProductDestination(link) &&
      scalarString(cta.type) === DESIRED_CTA &&
      scalarString(ctaValue.link) === link
    );
  });
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

function assertFinalState(verification: Readonly<Record<string, unknown>>): void {
  const campaignValue = asRecord(verification.campaign);
  const adSetValue = asRecord(verification.adSet);
  const adValues = arrayRecords(verification.ads);
  const creativeValues = arrayRecords(verification.creatives);

  if (scalarString(campaignValue.status) !== 'PAUSED') {
    throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_FINAL_CAMPAIGN_NOT_PAUSED');
  }
  if (scalarString(adSetValue.status) !== 'PAUSED') {
    throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_FINAL_ADSET_NOT_PAUSED');
  }
  if (finiteNumber(adSetValue.lifetime_budget) !== EXPECTED_BUDGET_MINOR) {
    throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_FINAL_BUDGET_MISMATCH');
  }
  if (!isStoriesOnlyTargeting(asRecord(adSetValue.targeting))) {
    throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_FINAL_PLACEMENTS_MISMATCH');
  }
  if (adValues.length !== EXPECTED_AD_COUNT || creativeValues.length !== EXPECTED_AD_COUNT) {
    throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_FINAL_COUNTS_MISMATCH');
  }
  if (adValues.some((ad) => scalarString(ad.status) !== 'PAUSED')) {
    throw new Error('META_ADS_THE_PARTY_0904_CTA_FIX_FINAL_AD_NOT_PAUSED');
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
