import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadConfig } from './config.js';
import { createPostgresPool } from './persistence/postgres.js';
import { MetaAdsControlledGraphProvider } from './providers/meta-ads/meta-ads-controlled-graph-provider.js';
import {
  assertExactTheParty20260815Descriptor,
  buildTheParty20260815Descriptor,
  THE_PARTY_2026_08_15_APPROVAL,
  theParty20260815DescriptorSha256,
  type TheParty20260815CampaignDescriptor,
} from './providers/meta-ads/meta-ads-the-party-2026-08-15-plan.js';
import { createMetaPublicationApiClient } from './providers/meta/meta-publication-client.js';

const config = loadConfig(process.env);
const mode = requiredEnv('META_ADS_THE_PARTY_MODE');
const explicitApproval = requiredEnv('META_ADS_THE_PARTY_EXPLICIT_APPROVAL');
if (explicitApproval !== THE_PARTY_2026_08_15_APPROVAL) {
  throw new Error('META_ADS_THE_PARTY_EXPLICIT_APPROVAL_MISMATCH');
}

const api = createMetaPublicationApiClient(config);
const provider = new MetaAdsControlledGraphProvider(api);

if (mode === 'PREPARE') {
  const prepared = await prepare();
  console.log(`META_ADS_THE_PARTY_PREPARE_RESULT=${JSON.stringify(prepared)}`);
} else if (mode === 'EXECUTE') {
  const executed = await execute();
  console.log(`META_ADS_THE_PARTY_EXECUTE_RESULT=${JSON.stringify(executed)}`);
} else {
  throw new Error('META_ADS_THE_PARTY_MODE_UNSUPPORTED');
}

async function prepare(): Promise<Readonly<Record<string, unknown>>> {
  const descriptor = buildTheParty20260815Descriptor();
  assertExactTheParty20260815Descriptor(descriptor);
  assertCampaignStartStillFuture(descriptor);
  const assets = await loadAndVerifyAssets(descriptor);
  const grantedScopes = await verifyPermissions();
  const account = await verifyAccount(descriptor);
  await assertNoDuplicateCampaign(descriptor);
  const requestSha256 = theParty20260815DescriptorSha256(descriptor);

  return {
    status: 'READY_FOR_EXACT_APPROVED_EXECUTION',
    eventId: descriptor.eventId,
    requestSha256,
    descriptorBase64: Buffer.from(JSON.stringify(descriptor), 'utf8').toString('base64'),
    account,
    grantedScopes,
    budget: {
      type: 'LIFETIME',
      amountMinor: descriptor.adSet.lifetimeBudgetMinor,
      currency: descriptor.account.currency,
    },
    schedule: {
      startTime: descriptor.adSet.startTime,
      endTime: descriptor.adSet.endTime,
    },
    targeting: descriptor.adSet.targeting,
    promotedObject: descriptor.adSet.promotedObject,
    destinationUrl: descriptor.destinationUrl,
    assets: assets.map((asset) => ({
      key: asset.key,
      sourceSha256: asset.sourceSha256,
      sizeBytes: asset.bytes.length,
    })),
  };
}

async function execute(): Promise<Readonly<Record<string, unknown>>> {
  if (!config.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  const approvedSha256 = requiredEnv('META_ADS_THE_PARTY_APPROVED_SHA256');
  const descriptorBase64 = requiredEnv('META_ADS_THE_PARTY_DESCRIPTOR_B64');
  const descriptor = JSON.parse(
    Buffer.from(descriptorBase64, 'base64').toString('utf8'),
  ) as TheParty20260815CampaignDescriptor;

  assertExactTheParty20260815Descriptor(descriptor);
  assertCampaignStartStillFuture(descriptor);
  const computedSha256 = theParty20260815DescriptorSha256(descriptor);
  if (computedSha256 !== approvedSha256) {
    throw new Error('META_ADS_THE_PARTY_APPROVED_SHA256_MISMATCH');
  }

  const assets = await loadAndVerifyAssets(descriptor);
  await verifyPermissions();
  await verifyAccount(descriptor);
  await assertNoDuplicateCampaign(descriptor);

  const pool = createPostgresPool({ connectionString: config.DATABASE_URL });
  const correlationId = `meta-ads:the-party:2026-08-15:${approvedSha256}`;
  const created: CreatedObjects = { creativeIds: [], adIds: [] };

  await pool.query(
    `insert into audit_events
       (correlation_id, actor_id, tool_name, risk_class, decision, normalized_payload, provider_result)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
    [
      correlationId,
      'github-actions/approved-campaign',
      'meta_ads.the_party_2026_08_15.execute',
      'WRITE_EXTERNAL',
      'APPROVED_CAMPAIGN_EXECUTION_STARTED',
      JSON.stringify({
        eventId: descriptor.eventId,
        requestSha256: approvedSha256,
        lifetimeBudgetMinor: descriptor.adSet.lifetimeBudgetMinor,
        creativeCount: descriptor.assets.length,
      }),
      JSON.stringify({ status: 'STARTED' }),
    ],
  );

  try {
    // Images are uploaded before any campaign/ad object exists. An image-upload failure cannot spend money.
    const imageHashes: string[] = [];
    for (const asset of assets) {
      imageHashes.push(await uploadImage(asset.base64));
    }

    const campaign = await provider.createCampaign(descriptor.account, {
      name: descriptor.campaign.name,
      objective: descriptor.campaign.objective,
      specialAdCategories: descriptor.campaign.specialAdCategories,
      status: 'PAUSED',
    });
    created.campaignId = campaign.id;

    const adSet = await provider.createAdSet(descriptor.account, {
      campaignId: campaign.id,
      name: descriptor.adSet.name,
      lifetimeBudgetMinor: descriptor.adSet.lifetimeBudgetMinor,
      billingEvent: descriptor.adSet.billingEvent,
      optimizationGoal: descriptor.adSet.optimizationGoal,
      targeting: descriptor.adSet.targeting,
      promotedObject: descriptor.adSet.promotedObject,
      startTime: descriptor.adSet.startTime,
      endTime: descriptor.adSet.endTime,
      status: 'PAUSED',
    });
    created.adSetId = adSet.id;

    for (const [index, asset] of descriptor.assets.entries()) {
      const imageHash = imageHashes[index];
      if (!imageHash) throw new Error('META_ADS_THE_PARTY_IMAGE_HASH_MISSING');
      const creative = await provider.createCreative(descriptor.account, {
        name: asset.creativeName,
        pageId: descriptor.identity.pageId,
        instagramActorId: descriptor.identity.instagramUserId,
        objectStorySpec: {
          link_data: {
            image_hash: imageHash,
            link: descriptor.destinationUrl,
          },
        },
      });
      created.creativeIds.push(creative.id);
    }

    for (const [index, asset] of descriptor.assets.entries()) {
      const creativeId = created.creativeIds[index];
      if (!creativeId) throw new Error('META_ADS_THE_PARTY_CREATIVE_ID_MISSING');
      const ad = await provider.createAd(descriptor.account, {
        name: asset.adName,
        adSetId: adSet.id,
        creativeId,
        status: 'PAUSED',
      });
      created.adIds.push(ad.id);
    }

    const pausedVerification = await verifyProviderEnvelope(descriptor, created, imageHashes);
    assertConfiguredStatus(pausedVerification, 'PAUSED');

    // Activate from leaves to root. The campaign is the final switch that can permit delivery.
    for (const adId of created.adIds) await api.post(adId, { status: 'ACTIVE' });
    await api.post(adSet.id, { status: 'ACTIVE' });
    await api.post(campaign.id, { status: 'ACTIVE' });

    const activeVerification = await waitForConfiguredActive(descriptor, created, imageHashes);

    await pool.query(
      `insert into audit_events
         (correlation_id, actor_id, tool_name, risk_class, decision, normalized_payload, provider_result)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
      [
        correlationId,
        'github-actions/approved-campaign',
        'meta_ads.the_party_2026_08_15.execute',
        'WRITE_EXTERNAL',
        'APPROVED_CAMPAIGN_EXECUTION_SUCCEEDED',
        JSON.stringify({
          eventId: descriptor.eventId,
          requestSha256: approvedSha256,
          lifetimeBudgetMinor: descriptor.adSet.lifetimeBudgetMinor,
          startTime: descriptor.adSet.startTime,
          endTime: descriptor.adSet.endTime,
        }),
        JSON.stringify({
          campaignId: campaign.id,
          adSetId: adSet.id,
          creativeIds: created.creativeIds,
          adIds: created.adIds,
          imageHashes,
          providerVerification: activeVerification,
        }),
      ],
    );

    return {
      status: 'ACTIVE_CONFIGURED',
      eventId: descriptor.eventId,
      requestSha256: approvedSha256,
      campaignId: campaign.id,
      adSetId: adSet.id,
      creativeIds: created.creativeIds,
      adIds: created.adIds,
      imageHashes,
      budget: {
        type: 'LIFETIME',
        amountMinor: descriptor.adSet.lifetimeBudgetMinor,
        currency: descriptor.account.currency,
      },
      schedule: {
        startTime: descriptor.adSet.startTime,
        endTime: descriptor.adSet.endTime,
      },
      providerVerification: activeVerification,
    };
  } catch (error) {
    const rollback = await rollbackToPaused(created);
    await pool.query(
      `insert into audit_events
         (correlation_id, actor_id, tool_name, risk_class, decision, normalized_payload, provider_result)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
      [
        correlationId,
        'github-actions/approved-campaign',
        'meta_ads.the_party_2026_08_15.execute',
        'WRITE_EXTERNAL',
        'APPROVED_CAMPAIGN_EXECUTION_FAILED_PAUSED_ROLLBACK',
        JSON.stringify({ eventId: descriptor.eventId, requestSha256: approvedSha256 }),
        JSON.stringify({ error: normalizeError(error), rollback, created }),
      ],
    );
    throw error;
  } finally {
    await pool.end();
  }
}

interface VerifiedAsset {
  readonly key: string;
  readonly sourceSha256: string;
  readonly base64: string;
  readonly bytes: Buffer;
}

interface CreatedObjects {
  campaignId?: string;
  adSetId?: string;
  readonly creativeIds: string[];
  readonly adIds: string[];
}

async function loadAndVerifyAssets(
  descriptor: TheParty20260815CampaignDescriptor,
): Promise<readonly VerifiedAsset[]> {
  const verified: VerifiedAsset[] = [];
  for (const asset of descriptor.assets) {
    const basePath = `ops/meta-ads/the-party-2026-08-15/${asset.fileName}`;
    const parts = await Promise.all(
      Array.from({ length: asset.partCount }, async (_, index) =>
        readFile(`${basePath}.part-${String(index + 1).padStart(2, '0')}`, 'utf8'),
      ),
    );
    const base64 = parts.join('').replace(/\s+/g, '');
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length < 100_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new Error(`META_ADS_THE_PARTY_ASSET_INVALID_${asset.key}`);
    }
    const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
    if (sourceSha256 !== asset.sourceSha256) {
      throw new Error(`META_ADS_THE_PARTY_ASSET_SHA256_MISMATCH_${asset.key}`);
    }
    verified.push({ key: asset.key, sourceSha256, base64, bytes });
  }
  return verified;
}

async function verifyPermissions(): Promise<readonly string[]> {
  const response = asRecord(await api.get('me/permissions'));
  const data = Array.isArray(response.data) ? response.data : [];
  const granted = data
    .map(asRecord)
    .filter((item) => item.status === 'granted')
    .map((item) => scalarString(item.permission))
    .filter(Boolean)
    .sort();
  if (!granted.includes('ads_management')) {
    throw new Error('META_ADS_THE_PARTY_ADS_MANAGEMENT_REQUIRED');
  }
  return granted;
}

async function verifyAccount(
  descriptor: TheParty20260815CampaignDescriptor,
): Promise<Readonly<Record<string, unknown>>> {
  const account = asRecord(
    await api.get(`act_${descriptor.account.adAccountId}`, {
      fields: 'id,name,currency,account_status',
    }),
  );
  if (!scalarString(account.id).endsWith(descriptor.account.adAccountId)) {
    throw new Error('META_ADS_THE_PARTY_ACCOUNT_ID_MISMATCH');
  }
  if (scalarString(account.currency) !== descriptor.account.currency) {
    throw new Error('META_ADS_THE_PARTY_CURRENCY_MISMATCH');
  }
  const accountStatus = finiteNumber(account.account_status);
  if (accountStatus !== 1) throw new Error('META_ADS_THE_PARTY_ACCOUNT_NOT_ACTIVE');
  return account;
}

async function assertNoDuplicateCampaign(
  descriptor: TheParty20260815CampaignDescriptor,
): Promise<void> {
  const response = asRecord(
    await api.get(`act_${descriptor.account.adAccountId}/campaigns`, {
      fields: 'id,name,status,effective_status',
      limit: '100',
    }),
  );
  const campaigns = Array.isArray(response.data) ? response.data.map(asRecord) : [];
  if (campaigns.some((campaign) => scalarString(campaign.name) === descriptor.campaign.name)) {
    throw new Error('META_ADS_THE_PARTY_DUPLICATE_CAMPAIGN_NAME');
  }
}

async function uploadImage(base64: string): Promise<string> {
  const response = asRecord(
    await api.post(`act_${buildTheParty20260815Descriptor().account.adAccountId}/adimages`, {
      bytes: base64,
    }),
  );
  const images = asRecord(response.images);
  for (const value of Object.values(images)) {
    const image = asRecord(value);
    const hash = scalarString(image.hash);
    if (hash) return hash;
  }
  throw new Error('META_ADS_THE_PARTY_IMAGE_UPLOAD_HASH_NOT_RETURNED');
}

async function verifyProviderEnvelope(
  descriptor: TheParty20260815CampaignDescriptor,
  created: CreatedObjects,
  imageHashes: readonly string[],
): Promise<{
  readonly campaign: Readonly<Record<string, unknown>>;
  readonly adSet: Readonly<Record<string, unknown>>;
  readonly creatives: readonly Readonly<Record<string, unknown>>[];
  readonly ads: readonly Readonly<Record<string, unknown>>[];
}> {
  if (!created.campaignId || !created.adSetId) {
    throw new Error('META_ADS_THE_PARTY_CREATED_OBJECTS_INCOMPLETE');
  }
  if (created.creativeIds.length !== 2 || created.adIds.length !== 2 || imageHashes.length !== 2) {
    throw new Error('META_ADS_THE_PARTY_CREATED_COUNTS_MISMATCH');
  }

  const campaign = asRecord(
    await api.get(created.campaignId, {
      fields: 'id,name,objective,status,effective_status',
    }),
  );
  const adSet = asRecord(
    await api.get(created.adSetId, {
      fields:
        'id,name,status,effective_status,lifetime_budget,start_time,end_time,targeting,promoted_object,optimization_goal,billing_event',
    }),
  );
  const creatives = await Promise.all(
    created.creativeIds.map(async (id) =>
      asRecord(await api.get(id, { fields: 'id,name,object_story_spec' })),
    ),
  );
  const ads = await Promise.all(
    created.adIds.map(async (id) =>
      asRecord(await api.get(id, { fields: 'id,name,status,effective_status,creative' })),
    ),
  );

  if (scalarString(campaign.name) !== descriptor.campaign.name) {
    throw new Error('META_ADS_THE_PARTY_PROVIDER_CAMPAIGN_NAME_MISMATCH');
  }
  if (scalarString(campaign.objective) !== descriptor.campaign.objective) {
    throw new Error('META_ADS_THE_PARTY_PROVIDER_OBJECTIVE_MISMATCH');
  }
  assertAdSetEnvelope(descriptor, adSet);

  for (const [index, creative] of creatives.entries()) {
    const expected = descriptor.assets[index];
    const expectedHash = imageHashes[index];
    if (!expected || !expectedHash) throw new Error('META_ADS_THE_PARTY_PROVIDER_CREATIVE_INDEX');
    if (scalarString(creative.id) !== created.creativeIds[index]) {
      throw new Error('META_ADS_THE_PARTY_PROVIDER_CREATIVE_ID_MISMATCH');
    }
    if (scalarString(creative.name) !== expected.creativeName) {
      throw new Error('META_ADS_THE_PARTY_PROVIDER_CREATIVE_NAME_MISMATCH');
    }
    const spec = asRecord(creative.object_story_spec);
    const linkData = asRecord(spec.link_data);
    if (scalarString(linkData.link) !== descriptor.destinationUrl) {
      throw new Error('META_ADS_THE_PARTY_PROVIDER_DESTINATION_MISMATCH');
    }
    const returnedHash = scalarString(linkData.image_hash);
    if (returnedHash && returnedHash !== expectedHash) {
      throw new Error('META_ADS_THE_PARTY_PROVIDER_IMAGE_HASH_MISMATCH');
    }
  }

  for (const [index, ad] of ads.entries()) {
    const expected = descriptor.assets[index];
    if (!expected) throw new Error('META_ADS_THE_PARTY_PROVIDER_AD_INDEX');
    if (scalarString(ad.id) !== created.adIds[index] || scalarString(ad.name) !== expected.adName) {
      throw new Error('META_ADS_THE_PARTY_PROVIDER_AD_MISMATCH');
    }
  }

  return { campaign, adSet, creatives, ads };
}

function assertAdSetEnvelope(
  descriptor: TheParty20260815CampaignDescriptor,
  adSet: Readonly<Record<string, unknown>>,
): void {
  if (scalarString(adSet.name) !== descriptor.adSet.name) {
    throw new Error('META_ADS_THE_PARTY_PROVIDER_ADSET_NAME_MISMATCH');
  }
  if (finiteNumber(adSet.lifetime_budget) !== descriptor.adSet.lifetimeBudgetMinor) {
    throw new Error('META_ADS_THE_PARTY_PROVIDER_TOTAL_BUDGET_MISMATCH');
  }
  if (scalarString(adSet.optimization_goal) !== descriptor.adSet.optimizationGoal) {
    throw new Error('META_ADS_THE_PARTY_PROVIDER_OPTIMIZATION_MISMATCH');
  }
  if (scalarString(adSet.billing_event) !== descriptor.adSet.billingEvent) {
    throw new Error('META_ADS_THE_PARTY_PROVIDER_BILLING_MISMATCH');
  }
  assertSameInstant(adSet.start_time, descriptor.adSet.startTime, 'START');
  assertSameInstant(adSet.end_time, descriptor.adSet.endTime, 'END');

  const promotedObject = asRecord(adSet.promoted_object);
  if (scalarString(promotedObject.pixel_id) !== descriptor.adSet.promotedObject.pixel_id) {
    throw new Error('META_ADS_THE_PARTY_PROVIDER_PIXEL_MISMATCH');
  }
  if (
    scalarString(promotedObject.custom_event_type) !==
    descriptor.adSet.promotedObject.custom_event_type
  ) {
    throw new Error('META_ADS_THE_PARTY_PROVIDER_EVENT_TYPE_MISMATCH');
  }

  const targeting = asRecord(adSet.targeting);
  if (finiteNumber(targeting.age_min) !== 21 || finiteNumber(targeting.age_max) !== 45) {
    throw new Error('META_ADS_THE_PARTY_PROVIDER_AGE_MISMATCH');
  }
  const geo = asRecord(targeting.geo_locations);
  const locations = Array.isArray(geo.custom_locations) ? geo.custom_locations.map(asRecord) : [];
  const location = locations[0];
  if (!location || locations.length !== 1) {
    throw new Error('META_ADS_THE_PARTY_PROVIDER_GEO_COUNT_MISMATCH');
  }
  if (
    !approximatelyEqual(finiteNumber(location.latitude), -13.3833) ||
    !approximatelyEqual(finiteNumber(location.longitude), -38.9167) ||
    finiteNumber(location.radius) !== 15 ||
    scalarString(location.distance_unit) !== 'kilometer'
  ) {
    throw new Error('META_ADS_THE_PARTY_PROVIDER_GEO_MISMATCH');
  }
}

function assertConfiguredStatus(
  verification: {
    readonly campaign: Readonly<Record<string, unknown>>;
    readonly adSet: Readonly<Record<string, unknown>>;
    readonly ads: readonly Readonly<Record<string, unknown>>[];
  },
  expected: 'PAUSED' | 'ACTIVE',
): void {
  if (scalarString(verification.campaign.status) !== expected) {
    throw new Error(`META_ADS_THE_PARTY_CAMPAIGN_NOT_${expected}`);
  }
  if (scalarString(verification.adSet.status) !== expected) {
    throw new Error(`META_ADS_THE_PARTY_ADSET_NOT_${expected}`);
  }
  if (verification.ads.some((ad) => scalarString(ad.status) !== expected)) {
    throw new Error(`META_ADS_THE_PARTY_AD_NOT_${expected}`);
  }
}

async function waitForConfiguredActive(
  descriptor: TheParty20260815CampaignDescriptor,
  created: CreatedObjects,
  imageHashes: readonly string[],
): Promise<Awaited<ReturnType<typeof verifyProviderEnvelope>>> {
  let last: Awaited<ReturnType<typeof verifyProviderEnvelope>> | undefined;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    last = await verifyProviderEnvelope(descriptor, created, imageHashes);
    if (
      scalarString(last.campaign.status) === 'ACTIVE' &&
      scalarString(last.adSet.status) === 'ACTIVE' &&
      last.ads.every((ad) => scalarString(ad.status) === 'ACTIVE')
    ) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  if (last) assertConfiguredStatus(last, 'ACTIVE');
  throw new Error('META_ADS_THE_PARTY_ACTIVE_PROVIDER_CONFIRMATION_TIMEOUT');
}

async function rollbackToPaused(
  created: CreatedObjects,
): Promise<Readonly<Record<string, unknown>>> {
  const attempts: Record<string, string> = {};
  if (created.campaignId) attempts.campaign = await pauseBestEffort(created.campaignId);
  if (created.adSetId) attempts.adSet = await pauseBestEffort(created.adSetId);
  for (const [index, adId] of created.adIds.entries()) {
    attempts[`ad${index + 1}`] = await pauseBestEffort(adId);
  }
  return attempts;
}

async function pauseBestEffort(id: string): Promise<string> {
  try {
    await api.post(id, { status: 'PAUSED' });
    const entity = asRecord(await api.get(id, { fields: 'id,status,effective_status' }));
    return scalarString(entity.status) === 'PAUSED' ? 'PAUSED_CONFIRMED' : 'PAUSE_SENT';
  } catch (error) {
    return `ROLLBACK_FAILED:${normalizeError(error)}`;
  }
}

function assertSameInstant(actual: unknown, expected: string, label: string): void {
  const actualMs = new Date(scalarString(actual)).getTime();
  const expectedMs = new Date(expected).getTime();
  if (!Number.isFinite(actualMs) || actualMs !== expectedMs) {
    throw new Error(`META_ADS_THE_PARTY_PROVIDER_${label}_TIME_MISMATCH`);
  }
}

function approximatelyEqual(value: number | undefined, expected: number): boolean {
  return value !== undefined && Math.abs(value - expected) <= 0.000001;
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

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function assertCampaignStartStillFuture(descriptor: TheParty20260815CampaignDescriptor): void {
  const startTime = new Date(descriptor.adSet.startTime).getTime();
  if (!Number.isFinite(startTime) || Date.now() >= startTime) {
    throw new Error('META_ADS_THE_PARTY_START_ALREADY_REACHED');
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function normalizeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, ' ')
    .slice(0, 500);
}
