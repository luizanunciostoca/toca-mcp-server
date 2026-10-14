import type {
  MetaAdsReadAccountRef,
  MetaAdsReadInsightsQuery,
  MetaAdsReadProvider,
} from '../providers/meta-ads/meta-ads-read-provider.js';

/**
 * AG-09 must use the TOCA-owned Meta Marketing API read path, not a third-party
 * reporting connector. This is a source-code contract, not live-provider proof.
 */
export const AG09_NATIVE_META_ANALYTICS_SOURCE = {
  provider: 'META_MARKETING_API',
  gateway: 'TOCA_MCP_SERVER',
  repository: 'luizanunciostoca/toca-mcp-server',
  capability: 'meta_ads.insights.get',
  reportingTimeZone: 'America/Bahia',
  externalAggregatorsAccepted: false,
} as const;

export interface Ag09NativeMetaInsightsEnvelope {
  readonly data: readonly Readonly<Record<string, unknown>>[];
  readonly source: typeof AG09_NATIVE_META_ANALYTICS_SOURCE;
  readonly accountId: string;
  readonly currency: string;
  readonly level: MetaAdsReadInsightsQuery['level'];
  readonly window: {
    readonly since: string;
    readonly until: string;
  };
  readonly observationState: 'ROWS_RETURNED' | 'NO_ROWS';
  readonly identicalRowsDiscarded: number;
}

/**
 * Provider-backed READ only. Never infers spend, leads or revenue from missing
 * rows. Duplicate records are discarded only with confirmed level-specific ID
 * and date bounds; missing identity preserves rows rather than guessing.
 */
export async function readAg09NativeMetaInsights(
  provider: Pick<MetaAdsReadProvider, 'getInsights'>,
  account: MetaAdsReadAccountRef,
  query: MetaAdsReadInsightsQuery,
): Promise<Ag09NativeMetaInsightsEnvelope> {
  if (!/^\d+$/.test(account.adAccountId)) throw new Error('AG09_META_AD_ACCOUNT_ID_INVALID');
  if (!/^[A-Z]{3}$/.test(account.currency)) throw new Error('AG09_META_CURRENCY_INVALID');
  assertCalendarDate(query.since);
  assertCalendarDate(query.until);
  if (query.since > query.until) throw new Error('AG09_META_INSIGHTS_WINDOW_REVERSED');
  if (query.fields.length === 0) throw new Error('AG09_META_INSIGHTS_FIELDS_REQUIRED');

  const rows: unknown = await provider.getInsights(account, query);
  if (!Array.isArray(rows)) throw new Error('AG09_META_INSIGHTS_PROVIDER_RESPONSE_INVALID');

  // A projected record cannot be deduplicated if its source identity is unknown.
  // Equal metrics from two campaigns must never be mistaken for the same entity.
  const entityIdField = {
    account: 'account_id',
    campaign: 'campaign_id',
    adset: 'adset_id',
    ad: 'ad_id',
  } as const satisfies Record<MetaAdsReadInsightsQuery['level'], string>;
  const seen = new Set<string>();
  const uniqueRows: Readonly<Record<string, unknown>>[] = [];
  let identicalRowsDiscarded = 0;
  for (const row of rows as readonly Readonly<Record<string, unknown>>[]) {
    if (row === null || typeof row !== 'object' || Array.isArray(row))
      throw new Error('AG09_META_INSIGHTS_ROW_INVALID');
    const entityId = row[entityIdField[query.level]];
    if (
      typeof entityId !== 'string' ||
      !entityId.trim() ||
      typeof row.date_start !== 'string' ||
      typeof row.date_stop !== 'string'
    ) {
      uniqueRows.push(row);
      continue;
    }
    const fingerprint = JSON.stringify(canonicalizeProviderJson(row));
    if (seen.has(fingerprint)) {
      identicalRowsDiscarded += 1;
      continue;
    }
    seen.add(fingerprint);
    uniqueRows.push(row);
  }

  return {
    data: uniqueRows,
    source: AG09_NATIVE_META_ANALYTICS_SOURCE,
    accountId: account.adAccountId,
    currency: account.currency,
    level: query.level,
    window: { since: query.since, until: query.until },
    observationState: uniqueRows.length === 0 ? 'NO_ROWS' : 'ROWS_RETURNED',
    identicalRowsDiscarded,
  };
}

function assertCalendarDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('AG09_META_INSIGHTS_DATE_INVALID');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new Error('AG09_META_INSIGHTS_DATE_INVALID');
}

function canonicalizeProviderJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => canonicalizeProviderJson(item));
  if (value !== null && typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalizeProviderJson(record[key])]),
    );
  }
  return value;
}
