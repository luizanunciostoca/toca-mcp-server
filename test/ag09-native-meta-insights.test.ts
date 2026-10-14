import { describe, expect, it, vi } from 'vitest';
import { InMemoryAuditSink } from '../src/core/audit.js';
import { createTrustedServiceExecutionIdentity } from '../src/core/identity.js';
import { executeCoreCapability } from '../src/mcp/core-execution.js';
import { createRuntimeCapabilityResolver } from '../src/mcp/runtime-capability-resolver.js';
import { createToolRegistry } from '../src/registry.js';
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

    expect(getInsights).toHaveBeenCalledTimes(1);
    expect(getInsights).toHaveBeenCalledWith(account, query);
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
  it('preserves projected identical metrics when campaign IDs were not requested', async () => {
    const projected = { date_start: '2026-10-08', date_stop: '2026-10-08', spend: '0' };
    const { provider } = fakeProvider([projected, { ...projected }]);
    const report = await readAg09NativeMetaInsights(provider, account, {
      ...query,
      fields: ['spend', 'date_start', 'date_stop'],
    });
    expect(report.data).toHaveLength(2);
    expect(report.identicalRowsDiscarded).toBe(0);
  });

  it('preserves equal projected rows without dates even when campaign ID is present', async () => {
    const projected = { campaign_id: 'campaign-a', spend: '0' };
    const { provider } = fakeProvider([projected, { ...projected }]);
    const report = await readAg09NativeMetaInsights(provider, account, {
      ...query,
      fields: ['campaign_id', 'spend'],
    });
    expect(report.data).toHaveLength(2);
    expect(report.identicalRowsDiscarded).toBe(0);
  });

  it('deduplicates key-order variants of the same fully identified Meta observation', async () => {
    const first = {
      campaign_id: 'campaign-a',
      date_start: '2026-10-08',
      date_stop: '2026-10-08',
      spend: '10.00',
      nested: { details: { action: 'lead', value: '2' }, breakdown: 'feed' },
    };
    const equivalent = {
      nested: { breakdown: 'feed', details: { value: '2', action: 'lead' } },
      spend: '10.00',
      date_stop: '2026-10-08',
      date_start: '2026-10-08',
      campaign_id: 'campaign-a',
    };
    const { provider } = fakeProvider([first, equivalent]);
    const report = await readAg09NativeMetaInsights(provider, account, query);
    expect(report.data).toEqual([first]);
    expect(report.identicalRowsDiscarded).toBe(1);
  });

  it('exposes the native provenance through the governed TOCA Core execute path', async () => {
    const { provider, getInsights } = fakeProvider([
      { campaign_id: 'campaign-a', date_start: '2026-10-08', date_stop: '2026-10-08', spend: '0' },
    ]);
    const identity = createTrustedServiceExecutionIdentity({
      principalId: 'test:ag09-native-reader',
      tenantId: 'toca-do-morcego',
      roles: ['READER'],
      allowedCapabilityIds: ['meta_ads.insights.get'],
      allowedTargetAccounts: [account.adAccountId],
      evidence: ['test:ag09-native-meta-core'],
      now: new Date().toISOString(),
    });
    const deps = {
      registry: createToolRegistry({ metaAdsReadsEnabled: true }),
      runtimeResolver: createRuntimeCapabilityResolver({
        metaAdsRead: provider as MetaAdsReadProvider,
      }),
      auditSink: new InMemoryAuditSink(),
    };
    const result = await executeCoreCapability(
      {
        capabilityId: 'meta_ads.insights.get',
        payload: { ...account, ...query },
        correlationId: 'test:ag09-core-read',
      },
      identity,
      deps,
    );
    expect(getInsights).toHaveBeenCalledTimes(1);
    expect(result.capabilityId).toBe('meta_ads.insights.get');
    expect(result.result).toMatchObject({
      source: AG09_NATIVE_META_ANALYTICS_SOURCE,
      observationState: 'ROWS_RETURNED',
      accountId: account.adAccountId,
      data: [{ spend: '0' }],
    });

    await expect(
      executeCoreCapability(
        {
          capabilityId: 'meta_ads.insights.get',
          payload: { ...account, adAccountId: '999888777', ...query },
          correlationId: 'test:ag09-wrong-target',
        },
        identity,
        deps,
      ),
    ).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
    expect(getInsights).toHaveBeenCalledTimes(1);
  });

});
