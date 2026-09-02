import { loadConfig } from './config.js';
import { createPostgresPool } from './persistence/postgres.js';
import { createMetaPublicationApiClient } from './providers/meta/meta-publication-client.js';

const APPROVAL = 'APPROVED_THE_PARTY_2026_09_04_START_NOW_R300';
const CAMPAIGN_ID = '52621895410665';
const ADSET_ID = '52621895413265';
const ACCOUNT_ID = '311793958882290';
const EXPECTED_BUDGET_MINOR = 30_000;
const EXPECTED_AD_COUNT = 7;
const EXPECTED_END_TIME = '2026-09-05T01:00:00-03:00';
const IMMEDIATE_LEAD_MS = 60_000;
const IMMEDIATE_WINDOW_MS = 180_000;

const suppliedApproval = requiredEnv('META_ADS_THE_PARTY_0904_START_NOW_APPROVAL');
if (suppliedApproval !== APPROVAL) {
  throw new Error('META_ADS_THE_PARTY_0904_START_NOW_APPROVAL_MISMATCH');
}

const config = loadConfig(process.env);
if (!config.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
const api = createMetaPublicationApiClient(config);
const pool = createPostgresPool({ connectionString: config.DATABASE_URL });
const correlationId = 'meta-ads:the-party:2026-09-04:start-now:r300';
let providerMutationExecuted = false;
let priorStartTime = '';

try {
  const before = await readEnvelope();
  assertInvariantEnvelope(before);
  priorStartTime = requiredScalar(before.adSet.start_time, 'PREFLIGHT_START_TIME');

  const nowMs = Date.now();
  const priorStartMs = parseTime(priorStartTime, 'PREFLIGHT_START_TIME');
  const requestedStartTime = new Date(nowMs + IMMEDIATE_LEAD_MS).toISOString();

  await writeAudit('APPROVED_START_NOW_STARTED', {
    priorStartTime,
    requestedStartTime,
    lifetimeBudgetMinor: EXPECTED_BUDGET_MINOR,
    configuredAdCount: before.ads.length,
  });

  if (priorStartMs > nowMs + IMMEDIATE_WINDOW_MS) {
    await api.post(ADSET_ID, { start_time: requestedStartTime });
    providerMutationExecuted = true;
  }

  const after = await readEnvelope();
  assertInvariantEnvelope(after);
  const finalStartTime = requiredScalar(after.adSet.start_time, 'FINAL_START_TIME');
  const finalStartMs = parseTime(finalStartTime, 'FINAL_START_TIME');

  if (finalStartMs > Date.now() + IMMEDIATE_WINDOW_MS) {
    throw new Error('META_ADS_THE_PARTY_0904_START_NOW_FINAL_START_NOT_IMMEDIATE');
  }

  const status = providerMutationExecuted
    ? 'START_TIME_ADVANCED_TO_IMMEDIATE'
    : 'START_ALREADY_IMMEDIATE';

  await writeAudit('APPROVED_START_NOW_SUCCEEDED', {
    priorStartTime,
    requestedStartTime,
    finalStartTime,
    status,
    campaignStatus: scalarString(after.campaign.status),
    adSetStatus: scalarString(after.adSet.status),
    lifetimeBudgetMinor: finiteNumber(after.adSet.lifetime_budget),
    configuredAdCount: after.ads.length,
    providerMutationExecuted,
  });

  console.log(
    `META_ADS_THE_PARTY_0904_START_NOW_RESULT=${JSON.stringify({
      status,
      campaignStatus: scalarString(after.campaign.status),
      adSetStatus: scalarString(after.adSet.status),
      configuredActiveAds: after.ads.filter((ad) => scalarString(ad.status) === 'ACTIVE').length,
      finalAdCount: after.ads.length,
      priorStartTime,
      requestedStartTime,
      finalStartTime,
      endTime: scalarString(after.adSet.end_time),
      lifetimeBudgetMinor: finiteNumber(after.adSet.lifetime_budget),
      currency: 'BRL',
      placements: ['facebook_story', 'instagram_story'],
      geoRadiusKm: 2,
      ageMin: 21,
      ageMax: 45,
      providerMutationExecuted,
      immediateStartConfirmed: true,
    })}`,
  );
} catch (error) {
  const rollbackErrors: string[] = [];
  if (providerMutationExecuted && priorStartTime) {
    try {
      await api.post(ADSET_ID, { start_time: priorStartTime });
    } catch (rollbackError) {
      rollbackErrors.push(`ADSET_START_TIME:${normalizeError(rollbackError)}`);
    }
  }

  try {
    await writeAudit('APPROVED_START_NOW_FAILED_ROLLBACK_ATTEMPTED', {
      error: normalizeError(error),
      priorStartTime,
      providerMutationExecuted,
      rollbackErrors,
    });
  } catch (auditError) {
    rollbackErrors.push(`AUDIT:${normalizeError(auditError)}`);
  }

  throw new Error(
    `META_ADS_THE_PARTY_0904_START_NOW_FAILED:${normalizeError(error)}:ROLLBACK=${JSON.stringify(rollbackErrors)}`,
  );
} finally {
  await pool.end();
}

interface Envelope {
  readonly campaign: Record<string, unknown>;
  readonly adSet: Record<string, unknown>;
  readonly ads: Record<string, unknown>[];
}

async function readEnvelope(): Promise<Envelope> {
  const campaign = asRecord(
    await api.get(CAMPAIGN_ID, {
      fields: 'id,name,status,effective_status,objective',
    }),
  );
  const adSet = asRecord(
    await api.get(ADSET_ID, {
      fields:
        'id,name,campaign_id,status,effective_status,lifetime_budget,start_time,end_time,targeting,promoted_object,optimization_goal,billing_event',
    }),
  );
  const ads = arrayRecords(
    asRecord(
      await api.get(`${CAMPAIGN_ID}/ads`, {
        fields: 'id,name,adset_id,campaign_id,status,effective_status',
        limit: '100',
      }),
    ).data,
  );
  return { campaign, adSet, ads };
}

function assertInvariantEnvelope(envelope: Envelope): void {
  if (scalarString(envelope.campaign.status) !== 'ACTIVE') {
    throw new Error('META_ADS_THE_PARTY_0904_START_NOW_CAMPAIGN_NOT_ACTIVE');
  }
  if (scalarString(envelope.adSet.status) !== 'ACTIVE') {
    throw new Error('META_ADS_THE_PARTY_0904_START_NOW_ADSET_NOT_ACTIVE');
  }
  if (scalarString(envelope.adSet.campaign_id) !== CAMPAIGN_ID) {
    throw new Error('META_ADS_THE_PARTY_0904_START_NOW_ADSET_CAMPAIGN_MISMATCH');
  }
  if (finiteNumber(envelope.adSet.lifetime_budget) !== EXPECTED_BUDGET_MINOR) {
    throw new Error('META_ADS_THE_PARTY_0904_START_NOW_BUDGET_MISMATCH');
  }
  if (scalarString(envelope.adSet.optimization_goal) !== 'OFFSITE_CONVERSIONS') {
    throw new Error('META_ADS_THE_PARTY_0904_START_NOW_OPTIMIZATION_MISMATCH');
  }
  if (!isPurchasePromotedObject(asRecord(envelope.adSet.promoted_object))) {
    throw new Error('META_ADS_THE_PARTY_0904_START_NOW_PURCHASE_OBJECT_MISMATCH');
  }
  if (!isExpectedTargeting(asRecord(envelope.adSet.targeting))) {
    throw new Error('META_ADS_THE_PARTY_0904_START_NOW_TARGETING_MISMATCH');
  }
  if (
    parseTime(requiredScalar(envelope.adSet.end_time, 'END_TIME'), 'END_TIME') !==
    parseTime(EXPECTED_END_TIME, 'EXPECTED_END_TIME')
  ) {
    throw new Error('META_ADS_THE_PARTY_0904_START_NOW_END_TIME_MISMATCH');
  }
  if (envelope.ads.length !== EXPECTED_AD_COUNT) {
    throw new Error('META_ADS_THE_PARTY_0904_START_NOW_AD_COUNT_MISMATCH');
  }
  if (envelope.ads.some((ad) => scalarString(ad.status) !== 'ACTIVE')) {
    throw new Error('META_ADS_THE_PARTY_0904_START_NOW_AD_NOT_ACTIVE');
  }
}

function isExpectedTargeting(targeting: Readonly<Record<string, unknown>>): boolean {
  const customLocations = arrayRecords(asRecord(targeting.geo_locations).custom_locations);
  const location = customLocations[0] ?? {};
  return (
    finiteNumber(targeting.age_min) === 21 &&
    finiteNumber(targeting.age_max) === 45 &&
    sortedStrings(targeting.publisher_platforms).join(',') === 'facebook,instagram' &&
    sortedStrings(targeting.facebook_positions).join(',') === 'story' &&
    sortedStrings(targeting.instagram_positions).join(',') === 'story' &&
    customLocations.length === 1 &&
    approximately(finiteNumber(location.latitude), -13.3833) &&
    approximately(finiteNumber(location.longitude), -38.9167) &&
    finiteNumber(location.radius) === 2 &&
    scalarString(location.distance_unit) === 'kilometer'
  );
}

function isPurchasePromotedObject(promotedObject: Readonly<Record<string, unknown>>): boolean {
  return (
    scalarString(promotedObject.pixel_id) === '461233076843065' &&
    scalarString(promotedObject.custom_event_type) === 'PURCHASE'
  );
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
      'meta_ads.the_party_2026_09_04.start_now',
      'WRITE_EXTERNAL',
      decision,
      JSON.stringify({
        eventId: 'THE_PARTY_2026_09_04',
        accountId: ACCOUNT_ID,
        campaignId: CAMPAIGN_ID,
        adSetId: ADSET_ID,
        lifetimeBudgetMinor: EXPECTED_BUDGET_MINOR,
        currency: 'BRL',
        financialImpact: true,
        requestedAction: 'ADVANCE_START_TIME_TO_IMMEDIATE',
      }),
      JSON.stringify(providerResult),
    ],
  );
}

function approximately(value: number | undefined, expected: number): boolean {
  return value !== undefined && Math.abs(value - expected) < 0.001;
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

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function requiredScalar(value: unknown, label: string): string {
  const result = scalarString(value);
  if (!result) throw new Error(`META_ADS_THE_PARTY_0904_START_NOW_${label}_MISSING`);
  return result;
}

function parseTime(value: string, label: string): number {
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) {
    throw new Error(`META_ADS_THE_PARTY_0904_START_NOW_${label}_INVALID`);
  }
  return parsed;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MISSING_REQUIRED_ENV_${name}`);
  return value;
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
