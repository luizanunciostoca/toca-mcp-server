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
  readonly requestSha256: string;
  readonly planBase64: string;
  readonly geo: Readonly<Record<string, unknown>>;
  readonly sourceCreativeId: string;
  readonly account: Readonly<Record<string, unknown>>;
  readonly grantedScopes: readonly string[];
}> {
  const grantedScopes = await verifyPermissions();
  const account = await verifyAccount();
  const geo = await resolveMorroGeo();
  const sourceCreative = await resolveSourceCreative();

  const now = new Date();
  const start = new Date(now.getTime() + 30 * 60 * 1000);
  const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const plan: ControlledCreatePausedPlan = {
    account: { adAccountId: accountId, currency },
    campaign: {
      name: `TOCA | P0 SMOKE CREATE_PAUSED | ${smokeId}`,
      objective: 'OUTCOME_SALES',
      specialAdCategories: [],
    },
    adSet: {
      name: `P0 Smoke | Morro | Purchase | ${smokeId}`,
      dailyBudgetMinor,
      billingEvent: 'IMPRESSIONS',
      optimizationGoal: 'OFFSITE_CONVERSIONS',
      targeting: {
        geo_locations: { cities: [{ key: scalarString(geo.key) }] },
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
        name: `P0 Smoke Creative | ${smokeId}`,
        pageId,
        instagramActorId,
        objectStorySpec: sourceCreative.objectStorySpec,
      },
    ],
    ads: [{ name: `P0 Smoke Ad | ${smokeId}`, creativeIndex: 0 }],
  };

  const sha = requestSha256(plan);
  const guardrails = guardrailsFor([scalarString(geo.key)], sha);
  const service = new MetaAdsControlledWriteService(provider, guardrails);
  const validation = service.prepare(plan);
  if (validation.requestSha256 !== sha) throw new Error('META_ADS_SMOKE_PREPARE_HASH_MISMATCH');

  return {
    requestSha256: sha,
    planBase64: Buffer.from(JSON.stringify(plan), 'utf8').toString('base64'),
    geo,
    sourceCreativeId: sourceCreative.id,
    account,
    grantedScopes,
  };
}

async function executePlan(): Promise<{
  readonly requestSha256: string;
  readonly campaignId: string;
  readonly adSetId: string;
  readonly creativeIds: readonly string[];
  readonly adIds: readonly string[];
  readonly status: 'PAUSED';
  readonly providerVerification: {
    readonly campaign: Readonly<Record<string, unknown>>;
    readonly adSet: Readonly<Record<string, unknown>>;
    readonly ads: readonly Readonly<Record<string, unknown>>[];
  };
}> {
  if (!config.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  const approvedSha256 = requiredEnv('META_ADS_SMOKE_APPROVED_SHA256');
  const planBase64 = requiredEnv('META_ADS_SMOKE_PLAN_B64');
  const plan = JSON.parse(
    Buffer.from(planBase64, 'base64').toString('utf8'),
  ) as ControlledCreatePausedPlan;
  const computed = requestSha256(plan);
  if (computed !== approvedSha256) throw new Error('META_ADS_SMOKE_APPROVED_SHA_MISMATCH');
  if (plan.account.adAccountId !== accountId || plan.account.currency !== currency) {
    throw new Error('META_ADS_SMOKE_ACCOUNT_ENVELOPE_MISMATCH');
  }

  await verifyPermissions();
  await verifyAccount();
  const geoKeys = extractGeoKeys(plan.adSet.targeting);
  const service = new MetaAdsControlledWriteService(
    provider,
    guardrailsFor(geoKeys, approvedSha256),
  );
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
      JSON.stringify({ requestSha256: approvedSha256, smokeId }),
      JSON.stringify({ status: 'STARTED' }),
    ],
  );

  try {
    const result = await service.createPaused(plan, approvedSha256);
    const campaign = asRecord(
      await api.get(result.campaignId, { fields: 'id,name,status,effective_status' }),
    );
    const adSet = asRecord(
      await api.get(result.adSetId, { fields: 'id,name,status,effective_status' }),
    );
    const ads = await Promise.all(
      result.adIds.map(async (id) =>
        asRecord(await api.get(id, { fields: 'id,name,status,effective_status' })),
      ),
    );

    assertProviderPaused('campaign', campaign);
    assertProviderPaused('adset', adSet);
    for (const ad of ads) assertProviderPaused('ad', ad);

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
        JSON.stringify({ requestSha256: approvedSha256, smokeId }),
        JSON.stringify({
          campaignId: result.campaignId,
          adSetId: result.adSetId,
          creativeIds: result.creativeIds,
          adIds: result.adIds,
          status: result.status,
          campaign,
          adSet,
          ads,
        }),
      ],
    );

    return { ...result, providerVerification: { campaign, adSet, ads } };
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
        JSON.stringify({ requestSha256: approvedSha256, smokeId }),
        JSON.stringify({ error: normalizeError(error) }),
      ],
    );
    throw error;
  } finally {
    await pool.end();
  }
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
    await api.get(`act_${accountId}`, { fields: 'id,name,currency,account_status' }),
  );
  if (scalarString(account.currency) !== currency)
    throw new Error('META_ADS_SMOKE_CURRENCY_MISMATCH');
  if (!scalarString(account.id).endsWith(accountId))
    throw new Error('META_ADS_SMOKE_ACCOUNT_ID_MISMATCH');
  return account;
}

async function resolveMorroGeo(): Promise<Readonly<Record<string, unknown>>> {
  const queries = ['Morro de São Paulo', 'Morro de Sao Paulo'];
  const matches = new Map<string, Readonly<Record<string, unknown>>>();
  for (const query of queries) {
    const response = asRecord(
      await api.get('search', {
        type: 'adgeolocation',
        location_types: JSON.stringify(['city']),
        q: query,
        country_code: 'BR',
      }),
    );
    const data = Array.isArray(response.data) ? response.data : [];
    for (const itemValue of data) {
      const item = asRecord(itemValue);
      const key = scalarString(item.key);
      const name = normalizeText(scalarString(item.name));
      const countryCode = scalarString(item.country_code).toUpperCase();
      if (
        key &&
        name.includes('morro de sao paulo') &&
        (countryCode === 'BR' || countryCode === 'BRA' || countryCode === '')
      ) {
        matches.set(key, item);
      }
    }
  }
  if (matches.size !== 1) {
    throw new Error(`META_ADS_SMOKE_GEO_NOT_UNIQUE:${matches.size}`);
  }
  return [...matches.values()][0]!;
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
  return { id: selected.id, objectStorySpec: spec };
}

function guardrailsFor(
  geoKeys: readonly string[],
  approvedRequestSha256: string,
): MetaAdsWriteGuardrails {
  return {
    allowedAccountId: accountId,
    allowedCurrency: currency,
    maxDailyBudgetMinor,
    allowedGeoKeys: geoKeys,
    allowedPixelId: pixelId,
    allowedPageId: pageId,
    allowedInstagramActorId: instagramActorId,
    approvedRequestSha256,
  };
}

function extractGeoKeys(targeting: Readonly<Record<string, unknown>>): readonly string[] {
  const geo = asRecord(targeting.geo_locations);
  const cities = Array.isArray(geo.cities) ? geo.cities : [];
  const keys = cities.map((city) => scalarString(asRecord(city).key)).filter(Boolean);
  if (keys.length === 0) throw new Error('META_ADS_SMOKE_PLAN_GEO_REQUIRED');
  return keys;
}

function assertProviderPaused(kind: string, entity: Readonly<Record<string, unknown>>): void {
  const status = scalarString(entity.status);
  const effective = scalarString(entity.effective_status);
  if (status !== 'PAUSED') throw new Error(`META_ADS_SMOKE_${kind.toUpperCase()}_NOT_PAUSED`);
  if (effective === 'ACTIVE')
    throw new Error(`META_ADS_SMOKE_${kind.toUpperCase()}_EFFECTIVE_ACTIVE`);
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

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
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

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
