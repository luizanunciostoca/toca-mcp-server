type JsonRecord = Record<string, unknown>;

const accountId = required('ACCOUNT_ID');
const smokeId = required('SMOKE_ID');
const token = required('META_TOKEN');
const graphVersion = process.env.GRAPH_VERSION || 'v24.0';
const graphBase = `https://graph.facebook.com/${graphVersion}`;

const campaignName = `TOCA | P0 SMOKE CREATE_PAUSED | ${smokeId}`;
const adSetName = `P0 Smoke | Morro locality | Purchase | ${smokeId}`;
const adName = `P0 Smoke Ad | ${smokeId}`;

const campaigns = await queryEdge(
  'campaigns',
  'id,name,status,effective_status,issues_info,created_time,updated_time',
  campaignName,
);
const adSets = await queryEdge(
  'adsets',
  'id,name,status,effective_status,issues_info,campaign_id,start_time,end_time,created_time,updated_time',
  adSetName,
);
const ads = await queryEdge(
  'ads',
  'id,name,status,effective_status,issues_info,failed_delivery_checks,campaign_id,adset_id,creative{id,name},created_time,updated_time',
  adName,
);

console.log(
  `META_ADS_CREATE_PAUSED_PROVIDER_DISCOVERY=${JSON.stringify({
    campaignCount: campaigns.length,
    adSetCount: adSets.length,
    adCount: ads.length,
    campaigns,
    adSets,
    ads,
  })}`,
);

assertSingle('campaign', campaigns);
assertSingle('adSet', adSets);
assertSingle('ad', ads);

const campaign = campaigns[0]!;
const adSet = adSets[0]!;
const ad = ads[0]!;

const campaignId = scalar(campaign.id);
const adSetId = scalar(adSet.id);
const adId = scalar(ad.id);
const adCreative = record(ad.creative);
const creativeId = scalar(adCreative.id);
if (!campaignId || !adSetId || !adId || !creativeId) throw new Error('READBACK_RESOURCE_ID_MISSING');

if (scalar(adSet.campaign_id) !== campaignId) throw new Error('READBACK_ADSET_CAMPAIGN_MISMATCH');
if (scalar(ad.campaign_id) !== campaignId) throw new Error('READBACK_AD_CAMPAIGN_MISMATCH');
if (scalar(ad.adset_id) !== adSetId) throw new Error('READBACK_AD_ADSET_MISMATCH');

// Meta may normalize the requested creative name. The Ad's creative binding is
// authoritative, so reconcile the exact provider resource by that ID.
const creative = await graphGet(creativeId, {
  fields: 'id,name,account_id,object_story_id,effective_object_story_id',
});
if (scalar(creative.id) !== creativeId) throw new Error('READBACK_CREATIVE_ID_MISMATCH');

const insightsResponse = await graphGet(`${campaignId}/insights`, {
  fields: 'spend,impressions,clicks',
  date_preset: 'maximum',
});
const insights = Array.isArray(insightsResponse.data) ? insightsResponse.data.map(record) : [];
const spend = insights.reduce((sum, row) => sum + finiteNumber(row.spend), 0);

const configuredPaused = [campaign, adSet, ad].every((entity) => scalar(entity.status) === 'PAUSED');
const noActiveEffectiveStatus = [campaign, adSet, ad].every(
  (entity) => scalar(entity.effective_status) !== 'ACTIVE',
);
const noIssues =
  emptyCollection(campaign.issues_info) &&
  emptyCollection(adSet.issues_info) &&
  emptyCollection(ad.issues_info) &&
  emptyCollection(ad.failed_delivery_checks);
const settledSafe =
  scalar(campaign.effective_status) === 'PAUSED' &&
  new Set(['PAUSED', 'CAMPAIGN_PAUSED']).has(scalar(adSet.effective_status)) &&
  new Set(['PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED']).has(scalar(ad.effective_status)) &&
  configuredPaused &&
  noIssues;

const evidence = {
  accountId,
  smokeId,
  recoveredAt: new Date().toISOString(),
  duplicateCounts: {
    campaign: campaigns.length,
    adSet: adSets.length,
    ad: ads.length,
  },
  resourceIds: {
    campaignId,
    adSetId,
    creativeId,
    adId,
  },
  campaign,
  adSet,
  ad,
  creative,
  insights,
  spend,
  safety: {
    configuredPaused,
    noActiveEffectiveStatus,
    noIssues,
    settledSafe,
    zeroSpend: spend === 0,
  },
};

console.log(`META_ADS_CREATE_PAUSED_PROVIDER_READBACK=${JSON.stringify(evidence)}`);

if (!configuredPaused) throw new Error('READBACK_NOT_CONFIGURED_PAUSED');
if (!noActiveEffectiveStatus) throw new Error('READBACK_ACTIVE_EFFECTIVE_STATUS');
if (spend !== 0) throw new Error('READBACK_NONZERO_SPEND');

async function queryEdge(edge: string, fields: string, expectedName: string): Promise<JsonRecord[]> {
  const matches: JsonRecord[] = [];
  let after = '';
  let exhausted = false;
  for (let page = 1; page <= 20; page += 1) {
    const response = await graphGet(`act_${accountId}/${edge}`, {
      fields,
      limit: '500',
      ...(after ? { after } : {}),
    });
    const data = Array.isArray(response.data) ? response.data.map(record) : [];
    matches.push(...data.filter((item) => scalar(item.name) === expectedName));
    const paging = record(response.paging);
    const next = scalar(paging.next);
    if (!next) {
      exhausted = true;
      break;
    }
    after = scalar(record(paging.cursors).after);
    if (!after) throw new Error(`READBACK_${edge.toUpperCase()}_PAGING_CURSOR_MISSING`);
  }
  if (!exhausted) throw new Error(`READBACK_${edge.toUpperCase()}_SCAN_INCOMPLETE`);
  return matches;
}

async function graphGet(path: string, params: Record<string, string>): Promise<JsonRecord> {
  const url = new URL(`${graphBase}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set('access_token', token);
  const response = await fetch(url, { method: 'GET' });
  const payload = record(await response.json());
  if (!response.ok || payload.error) {
    const error = record(payload.error);
    throw new Error(
      `META_GRAPH_READ_FAILED status=${response.status} code=${scalar(error.code)} subcode=${scalar(error.error_subcode)} type=${scalar(error.type)} message=${scalar(error.message)}`,
    );
  }
  return payload;
}

function assertSingle(kind: string, values: JsonRecord[]): void {
  if (values.length !== 1) throw new Error(`READBACK_${kind.toUpperCase()}_COUNT_${values.length}`);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function scalar(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function finiteNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function emptyCollection(value: unknown): boolean {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return !value;
}
