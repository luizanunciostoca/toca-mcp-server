import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadConfig } from './config.js';
import { createPostgresPool } from './persistence/postgres.js';
import { MetaAdsControlledGraphProvider } from './providers/meta-ads/meta-ads-controlled-graph-provider.js';
import {
  THE_PARTY_ITACARE_1011_ACCOUNT_ID,
  THE_PARTY_ITACARE_1011_CAMPAIGN_ID,
  THE_PARTY_ITACARE_1011_CURRENCY,
  THE_PARTY_ITACARE_1011_DESTINATION_URL,
  THE_PARTY_ITACARE_1011_END_TIME,
  THE_PARTY_ITACARE_1011_FEED_ASSETS,
  THE_PARTY_ITACARE_1011_FEED_CITIES,
  THE_PARTY_ITACARE_1011_INSTAGRAM_USER_ID,
  THE_PARTY_ITACARE_1011_PAGE_ID,
  THE_PARTY_ITACARE_1011_PIXEL_ID,
  buildThePartyItacare1011Targeting,
} from './providers/meta-ads/meta-ads-the-party-itacare-2026-10-11-feed-plan.js';
import { createMetaPublicationApiClient } from './providers/meta/meta-publication-client.js';

const APPROVAL = 'APPROVED_THE_PARTY_ITACARE_1011_FEED_18_35_CREATE_PAUSED';
const suppliedApproval = requiredEnv('META_ADS_THE_PARTY_ITACARE_1011_FEED_APPROVAL');

if (suppliedApproval !== APPROVAL) {
  throw new Error('META_ADS_ITACARE_1011_FEED_APPROVAL_MISMATCH');
}

const config = loadConfig(process.env);
if (!config.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');

const api = createMetaPublicationApiClient(config);
const provider = new MetaAdsControlledGraphProvider(api);
const pool = createPostgresPool({ connectionString: config.DATABASE_URL });
const account = {
  adAccountId: THE_PARTY_ITACARE_1011_ACCOUNT_ID,
  currency: THE_PARTY_ITACARE_1011_CURRENCY,
} as const;
const correlationId = 'meta-ads:the-party-itacare:2026-10-11:feed-18-35:create-paused';
const createdAdSetIds: string[] = [];
const createdCreativeIds: string[] = [];
const createdAdIds: string[] = [];
let providerMutationExecuted = false;

try {
  const preflight = await readPreflight();
  assertPreflight(preflight);
  const assets = await loadAndVerifyAssets();

  await writeAudit('APPROVED_CREATE_PAUSED_STARTED', {
    campaignId: THE_PARTY_ITACARE_1011_CAMPAIGN_ID,
    sourceAdSetIds: THE_PARTY_ITACARE_1011_FEED_CITIES.map((city) => city.sourceAdSetId),
    cityCount: THE_PARTY_ITACARE_1011_FEED_CITIES.length,
    creativeCountPerCity: THE_PARTY_ITACARE_1011_FEED_ASSETS.length,
    ageRange: [18, 35],
    placements: ['facebook_feed', 'instagram_feed'],
    activationApproved: false,
  });

  const imageHashes = new Map<string, string>();
  for (const asset of assets) {
    imageHashes.set(asset.code, await uploadImage(asset.base64));
    providerMutationExecuted = true;
  }

  for (const city of THE_PARTY_ITACARE_1011_FEED_CITIES) {
    const targeting = buildThePartyItacare1011Targeting(city);
    const createdAdSet = asRecord(
      await api.post(`act_${THE_PARTY_ITACARE_1011_ACCOUNT_ID}/adsets`, {
        campaign_id: THE_PARTY_ITACARE_1011_CAMPAIGN_ID,
        name: `TESTE FEED | ${city.displayName} | 18-35 | NOVOS CRIATIVOS | 23.09`,
        targeting: JSON.stringify(targeting),
        status: 'PAUSED',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        lifetime_budget: String(city.lifetimeBudgetMinor),
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'OFFSITE_CONVERSIONS',
        promoted_object: JSON.stringify({
          pixel_id: THE_PARTY_ITACARE_1011_PIXEL_ID,
          custom_event_type: 'PURCHASE',
        }),
        attribution_spec: JSON.stringify([{ event_type: 'CLICK_THROUGH', window_days: 7 }]),
        end_time: THE_PARTY_ITACARE_1011_END_TIME,
        fields: 'id',
      }),
    );
    const adSetId = requiredScalar(createdAdSet.id, 'CREATED_ADSET_ID');
    createdAdSetIds.push(adSetId);
    providerMutationExecuted = true;

    for (const [index, asset] of THE_PARTY_ITACARE_1011_FEED_ASSETS.entries()) {
      const imageHash = imageHashes.get(asset.code);
      if (!imageHash) throw new Error(`META_ADS_ITACARE_1011_IMAGE_HASH_MISSING_${asset.code}`);

      const creative = await provider.createCreative(account, {
        name: `THE PARTY 11.10 | ${city.displayName} | ${asset.code} | FEED`,
        pageId: THE_PARTY_ITACARE_1011_PAGE_ID,
        instagramActorId: THE_PARTY_ITACARE_1011_INSTAGRAM_USER_ID,
        objectStorySpec: {
          link_data: {
            image_hash: imageHash,
            link: THE_PARTY_ITACARE_1011_DESTINATION_URL,
            message: city.primaryTexts[index],
            name: asset.headline,
            description: asset.description,
            call_to_action: {
              type: 'SHOP_NOW',
              value: { link: THE_PARTY_ITACARE_1011_DESTINATION_URL },
            },
          },
        },
      });
      createdCreativeIds.push(creative.id);
      providerMutationExecuted = true;

      const ad = await provider.createAd(account, {
        name: `${city.displayName} | ${asset.code} | FEED 4x5 | 18-35`,
        adSetId,
        creativeId: creative.id,
        status: 'PAUSED',
      });
      createdAdIds.push(ad.id);
      providerMutationExecuted = true;
    }
  }

  const verification = await readVerification();
  const summary = assertFinalState(preflight, verification, imageHashes);

  await writeAudit('APPROVED_CREATE_PAUSED_SUCCEEDED', {
    ...summary,
    newAdSetIds: createdAdSetIds,
    newCreativeIds: createdCreativeIds,
    newAdIds: createdAdIds,
    providerMutationExecuted,
    activationPerformed: false,
  });

  console.log(
    `META_ADS_THE_PARTY_ITACARE_1011_FEED_CREATE_RESULT=${JSON.stringify({
      status: 'PAUSED_READY_FOR_BUDGET_DECISION',
      campaignId: THE_PARTY_ITACARE_1011_CAMPAIGN_ID,
      campaignStatus: summary.campaignStatus,
      newAdSetIds: createdAdSetIds,
      newCreativeIds: createdCreativeIds,
      newAdIds: createdAdIds,
      cityCount: THE_PARTY_ITACARE_1011_FEED_CITIES.length,
      adsPerCity: THE_PARTY_ITACARE_1011_FEED_ASSETS.length,
      totalNewAds: createdAdIds.length,
      ageMin: 18,
      ageMax: 35,
      placements: ['facebook_feed', 'instagram_feed'],
      ctaType: 'SHOP_NOW',
      pixelId: THE_PARTY_ITACARE_1011_PIXEL_ID,
      optimizationEvent: 'PURCHASE',
      destinationUrl: THE_PARTY_ITACARE_1011_DESTINATION_URL,
      budgetMode: 'ABO',
      sourceObjectsPreserved: true,
      activationPerformed: false,
      providerMutationExecuted,
    })}`,
  );
} catch (error) {
  const rollbackErrors = await keepCreatedObjectsPaused();
  try {
    await writeAudit('APPROVED_CREATE_PAUSED_FAILED_SAFE_PAUSED', {
      error: normalizeError(error),
      createdAdSetIds,
      createdCreativeIds,
      createdAdIds,
      rollbackErrors,
      providerMutationExecuted,
      activationPerformed: false,
    });
  } catch (auditError) {
    rollbackErrors.push(`AUDIT:${normalizeError(auditError)}`);
  }
  throw new Error(
    `META_ADS_ITACARE_1011_FEED_CREATE_FAILED:${normalizeError(error)}:SAFE_PAUSED=${JSON.stringify(rollbackErrors)}`,
  );
} finally {
  await pool.end();
}

interface Preflight {
  readonly campaign: Record<string, unknown>;
  readonly sources: ReadonlyMap<string, Record<string, unknown>>;
}

interface Verification {
  readonly campaign: Record<string, unknown>;
  readonly sources: ReadonlyMap<string, Record<string, unknown>>;
  readonly newAdSets: readonly Record<string, unknown>[];
  readonly ads: readonly Record<string, unknown>[];
  readonly creatives: ReadonlyMap<string, Record<string, unknown>>;
}

interface VerifiedAsset {
  readonly code: string;
  readonly base64: string;
}

async function readPreflight(): Promise<Preflight> {
  const campaign = asRecord(
    await api.get(THE_PARTY_ITACARE_1011_CAMPAIGN_ID, {
      fields:
        'id,name,status,effective_status,objective,daily_budget,lifetime_budget,budget_remaining,stop_time',
    }),
  );
  const sources = new Map<string, Record<string, unknown>>();

  for (const city of THE_PARTY_ITACARE_1011_FEED_CITIES) {
    sources.set(
      city.sourceAdSetId,
      asRecord(
        await api.get(city.sourceAdSetId, {
          fields:
            'id,name,campaign_id,status,effective_status,lifetime_budget,bid_strategy,billing_event,optimization_goal,end_time,targeting,promoted_object,attribution_spec',
        }),
      ),
    );
  }

  return { campaign, sources };
}

function assertPreflight(preflight: Preflight): void {
  if (requiredScalar(preflight.campaign.id, 'CAMPAIGN_ID') !== THE_PARTY_ITACARE_1011_CAMPAIGN_ID) {
    throw new Error('META_ADS_ITACARE_1011_CAMPAIGN_MISMATCH');
  }
  if (scalarString(preflight.campaign.status) !== 'ACTIVE') {
    throw new Error('META_ADS_ITACARE_1011_CAMPAIGN_NOT_ACTIVE');
  }
  if (finiteNumber(preflight.campaign.daily_budget) || finiteNumber(preflight.campaign.lifetime_budget)) {
    throw new Error('META_ADS_ITACARE_1011_CAMPAIGN_NOT_ABO');
  }

  for (const city of THE_PARTY_ITACARE_1011_FEED_CITIES) {
    const source = preflight.sources.get(city.sourceAdSetId);
    if (!source) throw new Error(`META_ADS_ITACARE_1011_SOURCE_MISSING_${city.code}`);
    if (scalarString(source.campaign_id) !== THE_PARTY_ITACARE_1011_CAMPAIGN_ID) {
      throw new Error(`META_ADS_ITACARE_1011_SOURCE_CAMPAIGN_MISMATCH_${city.code}`);
    }
    if (scalarString(source.status) !== 'ACTIVE') {
      throw new Error(`META_ADS_ITACARE_1011_SOURCE_NOT_ACTIVE_${city.code}`);
    }
    if (finiteNumber(source.lifetime_budget) !== city.lifetimeBudgetMinor) {
      throw new Error(`META_ADS_ITACARE_1011_SOURCE_BUDGET_MISMATCH_${city.code}`);
    }
    if (scalarString(source.optimization_goal) !== 'OFFSITE_CONVERSIONS') {
      throw new Error(`META_ADS_ITACARE_1011_SOURCE_OPTIMIZATION_MISMATCH_${city.code}`);
    }
    const promotedObject = asRecord(source.promoted_object);
    if (
      scalarString(promotedObject.pixel_id) !== THE_PARTY_ITACARE_1011_PIXEL_ID ||
      scalarString(promotedObject.custom_event_type) !== 'PURCHASE'
    ) {
      throw new Error(`META_ADS_ITACARE_1011_SOURCE_PROMOTED_OBJECT_MISMATCH_${city.code}`);
    }
  }
}

async function loadAndVerifyAssets(): Promise<readonly VerifiedAsset[]> {
  const output: VerifiedAsset[] = [];
  for (const asset of THE_PARTY_ITACARE_1011_FEED_ASSETS) {
    const bytes = await readFile(`ops/meta-ads/the-party-itacare-2026-10-11/${asset.fileName}`);
    if (bytes.length < 100_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new Error(`META_ADS_ITACARE_1011_ASSET_INVALID_${asset.code}`);
    }
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== asset.sha256) {
      throw new Error(`META_ADS_ITACARE_1011_ASSET_HASH_MISMATCH_${asset.code}`);
    }
    output.push({ code: asset.code, base64: bytes.toString('base64') });
  }
  return output;
}

async function uploadImage(base64: string): Promise<string> {
  const response = asRecord(
    await api.post(`act_${THE_PARTY_ITACARE_1011_ACCOUNT_ID}/adimages`, { bytes: base64 }),
  );
  const images = asRecord(response.images);
  for (const value of Object.values(images)) {
    const hash = scalarString(asRecord(value).hash);
    if (hash) return hash;
  }
  throw new Error('META_ADS_ITACARE_1011_IMAGE_HASH_NOT_RETURNED');
}

async function readVerification(): Promise<Verification> {
  const campaign = asRecord(
    await api.get(THE_PARTY_ITACARE_1011_CAMPAIGN_ID, {
      fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,stop_time',
    }),
  );
  const sources = new Map<string, Record<string, unknown>>();
  for (const city of THE_PARTY_ITACARE_1011_FEED_CITIES) {
    sources.set(
      city.sourceAdSetId,
      asRecord(
        await api.get(city.sourceAdSetId, {
          fields: 'id,name,status,effective_status,lifetime_budget,targeting,promoted_object',
        }),
      ),
    );
  }

  const newAdSets: Record<string, unknown>[] = [];
  for (const adSetId of createdAdSetIds) {
    newAdSets.push(
      asRecord(
        await api.get(adSetId, {
          fields:
            'id,name,campaign_id,status,effective_status,lifetime_budget,bid_strategy,billing_event,optimization_goal,end_time,targeting,promoted_object,attribution_spec',
        }),
      ),
    );
  }

  const ads: Record<string, unknown>[] = [];
  const creatives = new Map<string, Record<string, unknown>>();
  for (const adId of createdAdIds) {
    const ad = asRecord(
      await api.get(adId, {
        fields: 'id,name,adset_id,campaign_id,status,effective_status,creative',
      }),
    );
    ads.push(ad);
    const creativeId = requiredScalar(asRecord(ad.creative).id, 'VERIFY_CREATIVE_ID');
    creatives.set(
      creativeId,
      asRecord(
        await api.get(creativeId, {
          fields: 'id,name,object_story_spec',
        }),
      ),
    );
  }

  return { campaign, sources, newAdSets, ads, creatives };
}

function assertFinalState(
  preflight: Preflight,
  verification: Verification,
  imageHashes: ReadonlyMap<string, string>,
): {
  readonly campaignStatus: string;
  readonly newAdSetCount: number;
  readonly newAdCount: number;
} {
  const campaignStatus = scalarString(verification.campaign.status);
  if (campaignStatus !== scalarString(preflight.campaign.status) || campaignStatus !== 'ACTIVE') {
    throw new Error('META_ADS_ITACARE_1011_FINAL_CAMPAIGN_CHANGED');
  }

  for (const city of THE_PARTY_ITACARE_1011_FEED_CITIES) {
    const before = preflight.sources.get(city.sourceAdSetId);
    const after = verification.sources.get(city.sourceAdSetId);
    if (!before || !after) throw new Error(`META_ADS_ITACARE_1011_SOURCE_READBACK_MISSING_${city.code}`);
    if (
      scalarString(after.status) !== scalarString(before.status) ||
      finiteNumber(after.lifetime_budget) !== finiteNumber(before.lifetime_budget)
    ) {
      throw new Error(`META_ADS_ITACARE_1011_SOURCE_CHANGED_${city.code}`);
    }
  }

  if (verification.newAdSets.length !== THE_PARTY_ITACARE_1011_FEED_CITIES.length) {
    throw new Error('META_ADS_ITACARE_1011_NEW_ADSET_COUNT_MISMATCH');
  }
  if (
    verification.ads.length !==
    THE_PARTY_ITACARE_1011_FEED_CITIES.length * THE_PARTY_ITACARE_1011_FEED_ASSETS.length
  ) {
    throw new Error('META_ADS_ITACARE_1011_NEW_AD_COUNT_MISMATCH');
  }

  for (const [index, adSet] of verification.newAdSets.entries()) {
    const city = THE_PARTY_ITACARE_1011_FEED_CITIES[index];
    if (!city) throw new Error('META_ADS_ITACARE_1011_CITY_INDEX_MISSING');
    if (scalarString(adSet.status) !== 'PAUSED') {
      throw new Error(`META_ADS_ITACARE_1011_NEW_ADSET_NOT_PAUSED_${city.code}`);
    }
    if (finiteNumber(adSet.lifetime_budget) !== city.lifetimeBudgetMinor) {
      throw new Error(`META_ADS_ITACARE_1011_NEW_ADSET_BUDGET_MISMATCH_${city.code}`);
    }
    const targeting = asRecord(adSet.targeting);
    if (finiteNumber(targeting.age_min) !== 18 || finiteNumber(targeting.age_max) !== 35) {
      throw new Error(`META_ADS_ITACARE_1011_NEW_ADSET_AGE_MISMATCH_${city.code}`);
    }
    if (finiteNumber(asRecord(targeting.targeting_automation).advantage_audience) !== 0) {
      throw new Error(`META_ADS_ITACARE_1011_ADVANTAGE_AUDIENCE_NOT_DISABLED_${city.code}`);
    }
    if (sortedStrings(targeting.publisher_platforms).join(',') !== 'facebook,instagram') {
      throw new Error(`META_ADS_ITACARE_1011_PUBLISHER_PLACEMENT_MISMATCH_${city.code}`);
    }
    if (sortedStrings(targeting.facebook_positions).join(',') !== 'feed') {
      throw new Error(`META_ADS_ITACARE_1011_FACEBOOK_PLACEMENT_MISMATCH_${city.code}`);
    }
    if (sortedStrings(targeting.instagram_positions).join(',') !== 'stream') {
      throw new Error(`META_ADS_ITACARE_1011_INSTAGRAM_PLACEMENT_MISMATCH_${city.code}`);
    }
    const promotedObject = asRecord(adSet.promoted_object);
    if (
      scalarString(promotedObject.pixel_id) !== THE_PARTY_ITACARE_1011_PIXEL_ID ||
      scalarString(promotedObject.custom_event_type) !== 'PURCHASE'
    ) {
      throw new Error(`META_ADS_ITACARE_1011_NEW_PROMOTED_OBJECT_MISMATCH_${city.code}`);
    }
  }

  for (const ad of verification.ads) {
    if (scalarString(ad.status) !== 'PAUSED') {
      throw new Error('META_ADS_ITACARE_1011_NEW_AD_NOT_PAUSED');
    }
    const creativeId = requiredScalar(asRecord(ad.creative).id, 'FINAL_CREATIVE_ID');
    const creative = verification.creatives.get(creativeId);
    if (!creative) throw new Error('META_ADS_ITACARE_1011_FINAL_CREATIVE_MISSING');
    const linkData = asRecord(asRecord(creative.object_story_spec).link_data);
    const cta = asRecord(linkData.call_to_action);
    if (scalarString(cta.type) !== 'SHOP_NOW') {
      throw new Error('META_ADS_ITACARE_1011_FINAL_CTA_MISMATCH');
    }
    if (scalarString(linkData.link) !== THE_PARTY_ITACARE_1011_DESTINATION_URL) {
      throw new Error('META_ADS_ITACARE_1011_FINAL_DESTINATION_MISMATCH');
    }
    const imageHash = scalarString(linkData.image_hash);
    if (![...imageHashes.values()].includes(imageHash)) {
      throw new Error('META_ADS_ITACARE_1011_FINAL_IMAGE_HASH_MISMATCH');
    }
  }

  return {
    campaignStatus,
    newAdSetCount: verification.newAdSets.length,
    newAdCount: verification.ads.length,
  };
}

async function keepCreatedObjectsPaused(): Promise<string[]> {
  const errors: string[] = [];
  for (const adId of createdAdIds) {
    try {
      await api.post(adId, { status: 'PAUSED' });
    } catch (error) {
      errors.push(`AD:${adId}:${normalizeError(error)}`);
    }
  }
  for (const adSetId of createdAdSetIds) {
    try {
      await api.post(adSetId, { status: 'PAUSED' });
    } catch (error) {
      errors.push(`ADSET:${adSetId}:${normalizeError(error)}`);
    }
  }
  return errors;
}

async function writeAudit(
  decision: string,
  providerResult: Readonly<Record<string, unknown>>,
): Promise<void> {
  await pool.query(
    `insert into audit_events
       (correlation_id, actor_id, tool_name, risk_class, decision, normalized_payload, provider_result)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
    [
      correlationId,
      'chatgpt/user-explicit-approval',
      'meta_ads.the_party_itacare_2026_10_11.feed_18_35.create_paused',
      'WRITE_EXTERNAL',
      decision,
      JSON.stringify({
        accountId: THE_PARTY_ITACARE_1011_ACCOUNT_ID,
        campaignId: THE_PARTY_ITACARE_1011_CAMPAIGN_ID,
        budgetMode: 'ABO',
        ageMin: 18,
        ageMax: 35,
        placements: ['facebook_feed', 'instagram_feed'],
        cityCodes: THE_PARTY_ITACARE_1011_FEED_CITIES.map((city) => city.code),
        creativeCodes: THE_PARTY_ITACARE_1011_FEED_ASSETS.map((asset) => asset.code),
        activationApproved: false,
      }),
      JSON.stringify(providerResult),
    ],
  );
}

function sortedStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(scalarString).filter(Boolean).sort() : [];
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

function requiredScalar(value: unknown, label: string): string {
  const result = scalarString(value);
  if (!result) throw new Error(`META_ADS_ITACARE_1011_${label}_MISSING`);
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
