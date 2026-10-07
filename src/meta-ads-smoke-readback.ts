import { loadConfig } from './config.js';
import { createPostgresPool } from './persistence/postgres.js';
import { createMetaPublicationApiClient } from './providers/meta/meta-publication-client.js';

const config = loadConfig(process.env);
const accountId = requiredEnv('META_ADS_SMOKE_ACCOUNT_ID');
const smokeId = requiredEnv('META_ADS_SMOKE_ID');
const approvedSha256 = requiredEnv('META_ADS_SMOKE_APPROVED_SHA256');

const campaignName = `TOCA | P0 SMOKE CREATE_PAUSED | ${smokeId}`;
const adSetName = `P0 Smoke | Morro locality | Purchase | ${smokeId}`;
const creativeName = `P0 Smoke Creative | ${smokeId}`;
const adName = `P0 Smoke Ad | ${smokeId}`;
const correlationId = `meta-ads:p0-smoke:${smokeId}:${approvedSha256}`;

const api = createMetaPublicationApiClient(config);

try {
  const audit = await readAuditCheckpoint();
  const provider = await readProviderObjects(audit.providerCheckpoint);
  const result = {
    schemaVersion: 1,
    mode: 'READBACK',
    smokeId,
    approvedRequestSha256: approvedSha256,
    correlationId,
    expectedNames: { campaignName, adSetName, creativeName, adName },
    audit,
    provider,
    providerMutationExecuted: false,
  };
  console.log(`META_ADS_SMOKE_READBACK_RESULT=${JSON.stringify(result)}`);
} catch (error) {
  console.error(
    `META_ADS_SMOKE_READBACK_FAILURE=${JSON.stringify({
      schemaVersion: 1,
      mode: 'READBACK',
      smokeId,
      errorCode: normalizeError(error),
      providerMutationExecuted: false,
    })}`,
  );
  throw error;
}

async function readAuditCheckpoint(): Promise<{
  readonly events: readonly Readonly<Record<string, unknown>>[];
  readonly providerCheckpoint: Readonly<Record<string, unknown>> | null;
}> {
  if (!config.DATABASE_URL) return { events: [], providerCheckpoint: null };
  const pool = createPostgresPool({ connectionString: config.DATABASE_URL });
  try {
    const response = await pool.query(
      `select decision, normalized_payload, provider_result, created_at
         from audit_events
        where correlation_id = $1
        order by created_at asc`,
      [correlationId],
    );
    const events = response.rows.map((row) => ({
      decision: row.decision,
      normalizedPayload: row.normalized_payload,
      providerResult: row.provider_result,
      createdAt: row.created_at,
    }));
    let providerCheckpoint: Readonly<Record<string, unknown>> | null = null;
    for (const event of events) {
      const providerResult = asRecord(event.providerResult);
      const direct = asRecord(providerResult.providerCheckpoint);
      if (Object.keys(direct).length > 0) providerCheckpoint = direct;
      if (event.decision === 'SMOKE_PROVIDER_CREATED' && Object.keys(providerResult).length > 0) {
        providerCheckpoint = providerResult;
      }
    }
    return { events, providerCheckpoint };
  } finally {
    await pool.end();
  }
}

async function readProviderObjects(
  checkpoint: Readonly<Record<string, unknown>> | null,
): Promise<Readonly<Record<string, unknown>>> {
  const campaignId = scalarString(checkpoint?.campaignId);
  const adSetId = scalarString(checkpoint?.adSetId);
  const creativeIds = stringArray(checkpoint?.creativeIds);
  const adIds = stringArray(checkpoint?.adIds);

  if (campaignId) {
    return {
      source: 'checkpoint_ids',
      campaign: await safeGet(campaignId, 'id,name,status,effective_status,issues_info'),
      adSet: adSetId
        ? await safeGet(adSetId, 'id,name,status,effective_status,issues_info')
        : null,
      creatives: await Promise.all(
        creativeIds.map((id) => safeGet(id, 'id,name,status,object_story_spec')),
      ),
      ads: await Promise.all(
        adIds.map((id) =>
          safeGet(id, 'id,name,status,effective_status,issues_info,failed_delivery_checks'),
        ),
      ),
    };
  }

  const [campaigns, adSets, creatives, ads] = await Promise.all([
    listByName(`act_${accountId}/campaigns`, campaignName, 'id,name,status,effective_status,issues_info'),
    listByName(`act_${accountId}/adsets`, adSetName, 'id,name,status,effective_status,issues_info'),
    listByName(`act_${accountId}/adcreatives`, creativeName, 'id,name,status,object_story_spec'),
    listByName(
      `act_${accountId}/ads`,
      adName,
      'id,name,status,effective_status,issues_info,failed_delivery_checks,adset_id,campaign_id,creative',
    ),
  ]);
  return { source: 'exact_name_scan', campaigns, adSets, creatives, ads };
}

async function listByName(
  endpoint: string,
  expectedName: string,
  fields: string,
): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const response = asRecord(await api.get(endpoint, { fields, limit: '500' }));
  const data = Array.isArray(response.data) ? response.data.map(asRecord) : [];
  return data.filter((item) => scalarString(item.name) === expectedName);
}

async function safeGet(id: string, fields: string): Promise<Readonly<Record<string, unknown>>> {
  try {
    return asRecord(await api.get(id, { fields }));
  } catch (error) {
    return { id, readbackError: normalizeError(error) };
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function scalarString(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(scalarString).filter(Boolean) : [];
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
