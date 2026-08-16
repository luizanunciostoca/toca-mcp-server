const token = required('META_TOKEN');
const baseUrl = process.env.META_GRAPH_BASE_URL?.trim() || 'https://graph.facebook.com/v24.0';
const accountId = required('META_ADS_ACCOUNT_ID');
const campaignId = required('META_ADS_CAMPAIGN_ID');
const adSetId = required('META_ADS_ADSET_ID');
const creativeId = required('META_ADS_CREATIVE_ID');
const adId = required('META_ADS_AD_ID');

const [account, permissions, campaign, adSet, creative, ad, insights] = await Promise.all([
  get(`act_${accountId}`, { fields: 'id,name,currency,account_status,business' }),
  get('me/permissions'),
  get(campaignId, { fields: 'id,name,status,effective_status,issues_info' }),
  get(adSetId, { fields: 'id,name,status,effective_status,issues_info,daily_budget,start_time,end_time' }),
  get(creativeId, { fields: 'id,name' }),
  get(adId, { fields: 'id,name,status,effective_status,issues_info' }),
  get(`${campaignId}/insights`, { fields: 'spend,impressions,clicks', date_preset: 'maximum' }),
]);

assertAccount(account, accountId);
assertPaused('campaign', campaign);
assertPaused('adSet', adSet);
assertPaused('ad', ad);
assertPermission(permissions, 'ads_read');
assertPermission(permissions, 'ads_management');
const spend = totalSpend(insights);
if (spend !== 0) throw new Error(`META_ADS_READBACK_NONZERO_SPEND:${spend}`);

console.log(
  `META_ADS_FINAL_READBACK_RESULT=${JSON.stringify({
    account,
    campaign,
    adSet,
    creative,
    ad,
    insights,
    spend,
  })}`,
);

async function get(path: string, params: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const url = new URL(`${baseUrl}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(`META_ADS_READBACK_HTTP_${response.status}:${JSON.stringify(body)}`);
  return body;
}

function assertAccount(account: Record<string, unknown>, expected: string): void {
  if (!String(account.id ?? '').endsWith(expected)) throw new Error('META_ADS_READBACK_ACCOUNT_ID_MISMATCH');
  if (account.currency !== 'BRL') throw new Error('META_ADS_READBACK_CURRENCY_MISMATCH');
  if (String(account.account_status ?? '') !== '1') throw new Error('META_ADS_READBACK_ACCOUNT_NOT_ACTIVE');
}

function assertPaused(label: string, value: Record<string, unknown>): void {
  if (value.status !== 'PAUSED') throw new Error(`META_ADS_READBACK_${label.toUpperCase()}_NOT_PAUSED`);
  if (value.effective_status === 'ACTIVE') throw new Error(`META_ADS_READBACK_${label.toUpperCase()}_EFFECTIVE_ACTIVE`);
}

function assertPermission(value: Record<string, unknown>, permission: string): void {
  const data = Array.isArray(value.data) ? value.data : [];
  const granted = data.some((item) => {
    if (!item || typeof item !== 'object') return false;
    const record = item as Record<string, unknown>;
    return record.permission === permission && record.status === 'granted';
  });
  if (!granted) throw new Error(`META_ADS_READBACK_PERMISSION_MISSING:${permission}`);
}

function totalSpend(value: Record<string, unknown>): number {
  const data = Array.isArray(value.data) ? value.data : [];
  return data.reduce((sum: number, item) => {
    if (!item || typeof item !== 'object') return sum;
    const raw = (item as Record<string, unknown>).spend;
    const parsed = Number(raw ?? 0);
    return Number.isFinite(parsed) ? sum + parsed : sum;
  }, 0);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}
