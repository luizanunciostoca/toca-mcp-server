import { Buffer } from 'node:buffer';
import { loadConfig } from './config.js';
import { createPostgresPool } from './persistence/postgres.js';
import {
  MetaAdsControlledWriteService,
  requestSha256,
  type ControlledCreatePausedPlan,
  type MetaAdsWriteGuardrails,
} from './providers/meta-ads/meta-ads-controlled-write.js';
import { MetaAdsControlledGraphProvider } from './providers/meta-ads/meta-ads-controlled-graph-provider.js';
import {
  metaAdsProviderCreationCheckpointFromError,
  runMetaAdsCreatePausedSettlement,
} from './providers/meta-ads/meta-ads-smoke-execution.js';
import { validateMetaAdsAdWriteReadiness } from './providers/meta-ads/meta-ads-provider-preflight.js';
import {
  evaluateMetaAdsProviderSmokeReadiness,
  isMetaAdsPixelAssignedToAccount,
  type MetaAdsProviderSmokeSnapshot,
} from './providers/meta-ads/meta-ads-smoke-readiness.js';
import { createMetaPublicationApiClient } from './providers/meta/meta-publication-client.js';

const config = loadConfig(process.env);
const mode = requiredEnv('META_ADS_SMOKE_MODE');
const accountId = requiredEnv('META_ADS_SMOKE_ACCOUNT_ID');
const currency = requiredEnv('META_ADS_SMOKE_CURRENCY');
const pixelId = requiredEnv('META_ADS_SMOKE_PIXEL_ID');
const pageId = requiredEnv('META_ADS_SMOKE_PAGE_ID');
const instagramActorId = requiredEnv('META_ADS_SMOKE_INSTAGRAM_ACTOR_ID');
const smokeId = requiredEnv('META_ADS_SMOKE_ID');
const dailyBudgetMinor = parsePositiveInt(requiredEnv('META_ADS_SMOKE_DAILY_BUDGET_MINOR'));
const maxDailyBudgetMinor = parsePositiveInt(requiredEnv('META_ADS_SMOKE_MAX_DAILY_BUDGET_MINOR'));
const geoLatitude = parseFiniteNumber(
  process.env.META_ADS_SMOKE_GEO_LATITUDE?.trim() || '-13.3833',
);
const geoLongitude = parseFiniteNumber(
  process.env.META_ADS_SMOKE_GEO_LONGITUDE?.trim() || '-38.9167',
);
const geoRadiusKm = parsePositiveNumber(process.env.META_ADS_SMOKE_GEO_RADIUS_KM?.trim() || '15');

const api = createMetaPublicationApiClient(config);
const provider = new MetaAdsControlledGraphProvider(api);

if (mode === 'PREPARE') {
  const prepared = await preparePlan();
  console.log(`META_ADS_SMOKE_PREPARE_RESULT=${JSON.stringify(prepared)}`);
} else if (mode === 'EXECUTE') {
  const executed = await executePlan();
  console.log(`META_ADS_SMOKE_EXECUTE_RESULT=${JSON.stringify(executed)}`);
} else {
  throw new Error('META_ADS_SMOKE_MODE_UNSUPPORTED');
}

async function preparePlan(): Promise<{
  readonly smokeId: string;
  readonly campaignName: string;
  readonly requestSha256: string;
  readonly planBase64: string;
  readonly geo: Readonly<Record<string, unknown>>;
  readonly sourceCreativeId: string;
  readonly account: Readonly<Record<string, unknown>>;
  readonly pixelAccess: Readonly<Record<string, unknown>>;
  readonly writeReadiness: Awaited<ReturnType<typeof validateMetaAdsAdWriteReadiness>>;
  readonly grantedScopes: readonly string[];
}> {
  const grantedScopes = await verifyPermissions();
  const account = await verifyAccount();
  const pixelAccess = await verifyPixelAccess();
  const geoTarget = canonicalMorroCustomLocation();
  const sourceCreative = await resolveSourceCreative();
  const writeReadiness = await validateMetaAdsAdWriteReadiness(api, {
    accountId,
    creativeId: sourceCreative.id,
    validationId: `prepare-${smokeId}`,
  });

  const now = new Date();
  const start = new Date(now.getTime() + 30 * 60 * 1000);
  const end = new Date(start.getTime() + 25 * 60 * 60 * 1000);
  const plan: ControlledCreatePausedPlan = {
    account: { adAccountId: accountId, currency },
    campaign: {
      name: expectedCampaignName(),
      objective: 'OUTCOME_SALES',
      specialAdCategories: [],
    },
    adSet: {
      name: expectedAdSetName(),
      dailyBudgetMinor,
      billingEvent: 'IMPRESSIONS',
      optimizationGoal: 'OFFSITE_CONVERSIONS',
      targeting: {
        geo_locations: { custom_locations: [geoTarget] },
        targeting_automation: { advantage_audience: 0 },
      },
      promotedObject: {
        pixel_id: pixelId,
        custom_event_type: 'PURCHASE',
      },
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    },
    creatives: [
      {
        name: expectedCreativeName(),
        pageId,
        instagramActorId,
        objectStorySpec: sourceCreative.objectStorySpec,
        providerSourceCreativeId: sourceCreative.id,
      },
    ],
    ads: [{ name: expectedAdName(), creativeIndex: 0 }],
  };

  assertExactSmokePlanEnvelope(plan);
  const sha = requestSha256(plan);
  const service = new MetaAdsControlledWriteService(provider, guardrailsFor(sha));
  const validation = service.prepare(plan);
  if (validation.requestSha256 !== sha) throw new Error('META_ADS_SMOKE_PREPARE_HASH_MISMATCH');

  return {
    smokeId,
    campaignName: plan.campaign.name,
    requestSha256: sha,
    planBase64: Buffer.from(JSON.stringify(plan), 'utf8').toString('base64'),
    geo: geoEvidence(geoTarget),
    sourceCreativeId: sourceCreative.id,
    account,
    pixelAccess,
    writeReadiness,
    grantedScopes,
  };
}

async function executePlan(): Promise<{
  readonly smokeId: string;
  readonly campaignName: string;
  readonly requestSha256: string;
  readonly campaignId: string;
  readonly adSetId: string;
  readonly creativeIds: readonly string[];
  readonly adIds: readonly string[];
  readonly status: 'PAUSED';
  readonly providerVerification: MetaAdsProviderSmokeSnapshot;
}> {
  if (!config.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  const approvedSha256 = requiredEnv('META_ADS_SMOKE_APPROVED_SHA256');
  const planBase64 = requiredEnv('META_ADS_SMOKE_PLAN_B64');
  const plan = JSON.parse(
    Buffer.from(planBase64, 'base64').toString('utf8'),
  ) as ControlledCreatePausedPlan;
  assertExactSmokePlanEnvelope(plan);
  const computed = requestSha256(plan);
  if (computed !== approvedSha256) throw new Error('META_ADS_SMOKE_APPROVED_SHA_MISMATCH');
  if (plan.account.adAccountId !== accountId || plan.account.currency !== currency) {
    throw new Error('META_ADS_SMOKE_ACCOUNT_ENVELOPE_MISMATCH');
  }

  await verifyPermissions();
  await verifyAccount();
  await verifyPixelAccess();
  const sourceCreative = await resolveSourceCreative();
  if (plan.creatives[0]?.providerSourceCreativeId !== sourceCreative.id) {
    throw new Error('META_ADS_SMOKE_SOURCE_CREATIVE_ID_MISMATCH');
  }
  await validateMetaAdsAdWriteReadiness(api, {
    accountId,
    creativeId: sourceCreative.id,
    validationId: `execute-${smokeId}`,
  });
  const service = new MetaAdsControlledWriteService(provider, guardrailsFor(approvedSha256));
  service.prepare(plan);
  const pool = createPostgresPool({ connectionString: config.DATABASE_URL });
  const correlationId = `meta-ads:p0-smoke:${smokeId}:${approvedSha256}`;

  await pool.query(
    `insert into audit_events
       (correlation_id, actor_id, tool_name, risk_class, decision, normalized_payload, provider_result)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
    [
      correlationId,
      'github-actions/provider-smoke',
      'meta_ads.campaign.create_paused',
      'WRITE_EXTERNAL',
      'SMOKE_STARTED',
      JSON.stringify({
        requestSha256: approvedSha256,
        smokeId,
        campaignName: plan.campaign.name,
        providerSourceCreativeId: sourceCreative.id,
      }),
      JSON.stringify({ status: 'STARTED' }),
    ],
  );

  try {
    const settled = await runMetaAdsCreatePausedSettlement(
      {
        smokeId,
        campaignName: plan.campaign.name,
        approvedRequestSha256: approvedSha256,
      },
      {
        createPaused: () => service.createPaused(plan, approvedSha256),
        checkpointCreated: async (checkpoint) => {
          console.log(`META_ADS_SMOKE_PROVIDER_CHECKPOINT=${JSON.stringify(checkpoint)}`);
          await pool.query(
            `insert into audit_events
               (correlation_id, actor_id, tool_name, risk_class, decision, normalized_payload, provider_result)
             values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
            [
              correlationId,
              'github-actions/provider-smoke',
              'meta_ads.campaign.create_paused',
              'WRITE_EXTERNAL',
              'SMOKE_PROVIDER_CREATED',
              JSON.stringify({
                requestSha256: approvedSha256,
                smokeId,
                campaignName: plan.campaign.name,
                providerSourceCreativeId: sourceCreative.id,
              }),
              JSON.stringify(checkpoint),
            ],
          );
        },
        reconcile: (result) =>
          reconcileProviderPaused(result.campaignId, result.adSetId, result.adIds),
      },
    );
    const { result, providerVerification } = settled;

    await pool.query(
      `insert into audit_events
         (correlation_id, actor_id, tool_name, risk_class, decision, normalized_payload, provider_result)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
      [
        correlationId,
        'github-actions/provider-smoke',
        'meta_ads.campaign.create_paused',
        'WRITE_EXTERNAL',
        'SMOKE_SUCCEEDED',
        JSON.stringify({
          requestSha256: approvedSha256,
          smokeId,
          campaignName: plan.campaign.name,
          providerSourceCreativeId: sourceCreative.id,
        }),
        JSON.stringify({
          campaignId: result.campaignId,
          adSetId: result.adSetId,
          creativeIds: result.creativeIds,
          adIds: result.adIds,
          status: result.status,
          ...providerVerification,
        }),
      ],
    );

    return {
      smokeId,
      campaignName: plan.campaign.name,
      ...result,
      providerVerification,
    };
  } catch (error) {
    await pool.query(
      `insert into audit_events
         (correlation_id, actor_id, tool_name, risk_class, decision, normalized_payload, provider_result)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
      [
        correlationId,
        'github-actions/provider-smoke',
        'meta_ads.campaign.create_paused',
        'WRITE_EXTERNAL',
        'SMOKE_FAILED',
        JSON.stringify({
          requestSha256: approvedSha256,
          smokeId,
          campaignName: plan.campaign.name,
          providerSourceCreativeId: sourceCreative.id,
        }),
        JSON.stringify({
          error: normalizeError(error),
          ...(metaAdsProviderCreationCheckpointFromError(error)
            ? { providerCheckpoint: metaAdsProviderCreationCheckpointFromError(error) }
            : {}),
        }),
      ],
    );
    throw error;
  } finally {
    await pool.end();
  }
}

function assertExactSmokePlanEnvelope(plan: ControlledCreatePausedPlan): void {
  if (plan.campaign.name !== expectedCampaignName()) {
    throw new Error('META_ADS_SMOKE_PLAN_CAMPAIGN_NAME_MISMATCH');
  }
  if (plan.adSet.name !== expectedAdSetName()) {
    throw new Error('META_ADS_SMOKE_PLAN_ADSET_NAME_MISMATCH');
  }
  if (plan.creatives.length !== 1 || plan.creatives[0]?.name !== expectedCreativeName()) {
    throw new Error('META_ADS_SMOKE_PLAN_CREATIVE_NAME_MISMATCH');
  }
  if (!plan.creatives[0]?.providerSourceCreativeId) {
    throw new Error('META_ADS_SMOKE_SOURCE_CREATIVE_ID_REQUIRED');
  }
  if (
    plan.ads.length !== 1 ||
    plan.ads[0]?.name !== expectedAdName() ||
    plan.ads[0]?.creativeIndex !== 0
  ) {
    throw new Error('META_ADS_SMOKE_PLAN_AD_NAME_MISMATCH');
  }
  const targeting = asRecord(plan.adSet.targeting);
  const targetingAutomation = asRecord(targeting.targeting_automation);
  if (finiteNumber(targetingAutomation.advantage_audience) !== 0) {
    throw new Error('META_ADS_SMOKE_PLAN_ADVANTAGE_AUDIENCE_MISMATCH');
  }
}

function expectedCampaignName(): string {
  return `TOCA | P0 SMOKE CREATE_PAUSED | ${smokeId}`;
}

function expectedAdSetName(): string {
  return `P0 Smoke | Morro locality | Purchase | ${smokeId}`;
}

function expectedCreativeName(): string {
  return `P0 Smoke Creative | ${smokeId}`;
}

function expectedAdName(): string {
  return `P0 Smoke Ad | ${smokeId}`;
}

async function verifyPermissions(): Promise<readonly string[]> {
  const response = asRecord(await api.get('me/permissions'));
  const data = Array.isArray(response.data) ? response.data : [];
  const granted = data
    .map(asRecord)
    .filter((item) => item.status === 'granted')
    .map((item) => scalarString(item.permission))
    .filter(Boolean);
  if (!granted.includes('ads_management'))
    throw new Error('META_ADS_SMOKE_ADS_MANAGEMENT_REQUIRED');
  return granted.sort();
}

async function verifyAccount(): Promise<Readonly<Record<string, unknown>>> {
  const account = asRecord(
    await api.get(`act_${accountId}`, { fields: 'id,name,currency,account_status,business' }),
  );
  if (scalarString(account.currency) !== currency)
    throw new Error('META_ADS_SMOKE_CURRENCY_MISMATCH');
  if (!scalarString(account.id).endsWith(accountId))
    throw new Error('META_ADS_SMOKE_ACCOUNT_ID_MISMATCH');
  if (scalarString(account.account_status) !== '1')
    throw new Error('META_ADS_SMOKE_ACCOUNT_NOT_ACTIVE');
  return account;
}

async function verifyPixelAccess(): Promise<Readonly<Record<string, unknown>>> {
  const businessesResponse = asRecord(
    await api.get('me/businesses', { fields: 'id,name', limit: '200' }),
  );
  const businesses = Array.isArray(businessesResponse.data)
    ? businessesResponse.data.map(asRecord)
    : [];

  for (const business of businesses) {
    const businessId = scalarString(business.id);
    if (!businessId) continue;

    let pixelsResponse: Record<string, unknown>;
    try {
      pixelsResponse = asRecord(
        await api.get(`${businessId}/adspixels`, {
          fields: 'id,name,is_unavailable',
          limit: '200',
        }),
      );
    } catch {
      continue;
    }

    const pixels = Array.isArray(pixelsResponse.data) ? pixelsResponse.data.map(asRecord) : [];
    const pixel = pixels.find((candidate) => scalarString(candidate.id) === pixelId);
    if (!pixel) continue;
    if (pixel.is_unavailable === true) throw new Error('META_ADS_SMOKE_PIXEL_UNAVAILABLE');

    const assignedResponse = asRecord(
      await api.get(`${pixelId}/adaccounts`, {
        business: businessId,
        fields: 'id,account_id,name,account_status',
        limit: '200',
      }),
    );
    const assignedAccounts = Array.isArray(assignedResponse.data)
      ? assignedResponse.data.map(asRecord)
      : [];
    if (!isMetaAdsPixelAssignedToAccount(assignedAccounts, accountId)) {
      throw new Error('META_ADS_SMOKE_PIXEL_ACCOUNT_ACCESS_REQUIRED');
    }

    return {
      pixelId,
      pixelName: scalarString(pixel.name),
      businessId,
      businessName: scalarString(business.name),
      accountId,
      assigned: true,
    };
  }

  throw new Error('META_ADS_SMOKE_PIXEL_NOT_FOUND_IN_ACCESSIBLE_BUSINESS');
}

async function reconcileProviderPaused(
  campaignId: string,
  adSetId: string,
  adIds: readonly string[],
): Promise<MetaAdsProviderSmokeSnapshot> {
  const maxAttempts = 20;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const campaign = asRecord(
      await api.get(campaignId, { fields: 'id,name,status,effective_status,issues_info' }),
    );
    const adSet = asRecord(
      await api.get(adSetId, { fields: 'id,name,status,effective_status,issues_info' }),
    );
    const ads = await Promise.all(
      adIds.map(async (id) =>
        asRecord(
          await api.get(id, {
            fields: 'id,name,status,effective_status,issues_info,failed_delivery_checks',
          }),
        ),
      ),
    );
    const snapshot: MetaAdsProviderSmokeSnapshot = { campaign, adSet, ads };
    const readiness = evaluateMetaAdsProviderSmokeReadiness(snapshot);
    if (readiness.state === 'READY') return snapshot;
    if (attempt < maxAttempts) await delay(5_000);
  }
  throw new Error('META_ADS_SMOKE_PROVIDER_RECONCILIATION_TIMEOUT');
}

function canonicalMorroCustomLocation(): Readonly<Record<string, unknown>> {
  return {
    latitude: geoLatitude,
    longitude: geoLongitude,
    radius: geoRadiusKm,
    distance_unit: 'kilometer',
  };
}

function geoEvidence(target: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    key: `custom:${geoLatitude},${geoLongitude}:${geoRadiusKm}km`,
    mode: 'custom_location',
    ...target,
  };
}

async function resolveSourceCreative(): Promise<{
  readonly id: string;
  readonly objectStorySpec: Readonly<Record<string, unknown>>;
}> {
  const response = asRecord(
    await api.get(`act_${accountId}/adcreatives`, {
      fields: 'id,name,object_story_spec',
      limit: '100',
    }),
  );
  const data = Array.isArray(response.data) ? response.data : [];
  const eligible = data
    .map(asRecord)
    .map((item) => ({
      id: scalarString(item.id),
      spec: asRecord(item.object_story_spec),
    }))
    .filter(({ id, spec }) => {
      if (!id || scalarString(spec.page_id) !== pageId) return false;
      return Boolean(spec.link_data || spec.photo_data || spec.video_data || spec.template_data);
    });
  if (eligible.length === 0) throw new Error('META_ADS_SMOKE_SOURCE_CREATIVE_NOT_FOUND');
  const selected = eligible[0]!;
  const spec = { ...selected.spec };
  delete spec.page_id;
  delete spec.instagram_actor_id;
  delete spec.instagram_user_id;
  return { id: selected.id, objectStorySpec: spec };
}

function guardrailsFor(approvedRequestSha256: string): MetaAdsWriteGuardrails {
  return {
    allowedAccountId: accountId,
    allowedCurrency: currency,
    maxDailyBudgetMinor,
    allowedCustomLocations: [
      {
        latitude: geoLatitude,
        longitude: geoLongitude,
        maxRadius: geoRadiusKm,
        distanceUnit: 'kilometer',
      },
    ],
    allowedPixelId: pixelId,
    allowedPageId: pageId,
    allowedInstagramActorId: instagramActorId,
    approvedRequestSha256,
    allowUnboundCreativeForProviderValidation: true,
  };
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
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error('META_ADS_SMOKE_INTEGER_INVALID');
  return parsed;
}

function parseFiniteNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error('META_ADS_SMOKE_NUMBER_INVALID');
  return parsed;
}

function parsePositiveNumber(value: string): number {
  const parsed = parseFiniteNumber(value);
  if (parsed <= 0) throw new Error('META_ADS_SMOKE_POSITIVE_NUMBER_REQUIRED');
  return parsed;
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
