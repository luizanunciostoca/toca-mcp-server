import { describe, expect, it, vi } from 'vitest';
import {
  AG09_NATIVE_META_ANALYTICS_SOURCE,
  readAg09NativeMetaInsights,
} from '../src/measurement/ag09-native-meta-insights.js';
import type {
  MetaAdsReadInsightsQuery,
  MetaAdsReadProvider,
} from '../src/providers/meta-ads/meta-ads-read-provider.js';

const account = { adAccountId: '311793958882290', currency: 'BRL' };
const query: MetaAdsReadInsightsQuery = {
  level: 'campaign',
  fields: ['campaign_id', 'date_start', 'date_stop', 'spend', 'impressions'],
  since: '2026-10-08',
  until: '2026-10-14',
};

function fakeProvider(rows: readonly Readonly<Record<string, unknown>>[]) {
  const getInsights = vi.fn().mockResolvedValue(rows);
  return {
    provider: { getInsights } as unknown as Pick<MetaAdsReadProvider, 'getInsights'>,
    getInsights,
  };
}

describe('AG-09 native Meta Ads analytics source', () => {
  it('uses the TOCA-owned Meta read path with explicit provenance and scope', async () => {
    const { provider, getInsights } = fakeProvider([
      {
        campaign_id: 'campaign-a',
        date_start: '2026-10-08',
        date_stop: '2026-10-08',
        spend: '0',
        impressions: '0',
      },
    ]);
    const report = await readAg09NativeMetaInsights(provider, account, query);

    expect(getInsights).toHaveBeenCalledExactlyOnceWith(account, query);
    expect(report.source).toEqual(AG09_NATIVE_META_ANALYTICS_SOURCE);
    expect(report.source.gateway).toBe('TOCA_MCP_SERVER');
    expect(report.source.provider).toBe('META_MARKETING_API');
    expect(report.source.externalAggregatorsAccepted).toBe(false);
    expect(report.source.reportingTimeZone).toBe('America/Bahia');
    expect(report.accountId).toBe(account.adAccountId);
    expect(report.currency).toBe('BRL');
    expect(report.level).toBe('campaign');
    expect(report.window).toEqual({ since: '2026-10-08', until: '2026-10-14' });
    expect(report.observationState).toBe('ROWS_RETURNED');
    expect(report.data[0]).toMatchObject({ spend: '0', impressions: '0' });
  });

  it('distinguishes no provider rows from an explicit zero', async () => {
    const { provider } = fakeProvider([]);
    const report = await readAg09NativeMetaInsights(provider, account, query);
    expect(report.data).toEqual([]);
    expect(report.observationState).toBe('NO_ROWS');
    expect(report.identicalRowsDiscarded).toBe(0);
    expect(report).not.toHaveProperty('spend');
    expect(report).not.toHaveProperty('revenue');
  });

  it('deduplicates identical provider rows without merging distinct breakdowns', async () => {
    const first = {
      campaign_id: 'campaign-a',
      date_start: '2026-10-08',
      date_stop: '2026-10-08',
      spend: '10.00',
      placement: 'feed',
    };
    const second = { ...first, placement: 'story' };
    const { provider } = fakeProvider([first, { ...first }, second]);
    const report = await readAg09NativeMetaInsights(provider, account, query);
    expect(report.data).toEqual([first, second]);
    expect(report.identicalRowsDiscarded).toBe(1);
  });

  it('fails before provider access for wrong account, invalid calendar date and reversed period', async () => {
    const { provider, getInsights } = fakeProvider([]);
    await expect(
      readAg09NativeMetaInsights(
        provider,
        { adAccountId: 'act_311793958882290', currency: 'BRL' },
        query,
      ),
    ).rejects.toThrow('AG09_META_AD_ACCOUNT_ID_INVALID');
    await expect(
      readAg09NativeMetaInsights(provider, account, { ...query, since: '2026-02-30' }),
    ).rejects.toThrow('AG09_META_INSIGHTS_DATE_INVALID');
    await expect(
      readAg09NativeMetaInsights(provider, account, {
        ...query,
        since: '2026-10-15',
        until: '2026-10-14',
      }),
    ).rejects.toThrow('AG09_META_INSIGHTS_WINDOW_REVERSED');
    expect(getInsights).not.toHaveBeenCalled();
  });

  it('propagates unavailable native provider without third-party fallback', async () => {
    const getInsights = vi.fn().mockRejectedValue(new Error('META_READ_UNAVAILABLE'));
    const provider = { getInsights } as unknown as Pick<MetaAdsReadProvider, 'getInsights'>;
    await expect(readAg09NativeMetaInsights(provider, account, query)).rejects.toThrow(
      'META_READ_UNAVAILABLE',
    );
    expect(getInsights).toHaveBeenCalledTimes(1);
  });
});
