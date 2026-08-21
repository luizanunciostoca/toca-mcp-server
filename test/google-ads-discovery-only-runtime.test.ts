import { describe, expect, it } from 'vitest';
import { resolvePaidMediaRuntimeBinding } from '../src/mcp/paid-media-runtime.js';
import type { GoogleAdsApiClient } from '../src/providers/google-ads/google-ads-api-client.js';
import { createTocaRuntimeComposition } from '../src/server.js';

class DiscoveryOnlyGoogleAdsApi implements GoogleAdsApiClient {
  listCalls = 0;
  searchCalls = 0;
  mutateCalls = 0;

  async listAccessibleCustomers(): ReturnType<GoogleAdsApiClient['listAccessibleCustomers']> {
    await Promise.resolve();
    this.listCalls += 1;
    return {
      body: {
        resourceNames: ['customers/1234567890', 'invalid/resource', 'customers/123'],
      },
      requestId: 'request-discovery-1',
    };
  }

  async search(): ReturnType<GoogleAdsApiClient['search']> {
    await Promise.resolve();
    this.searchCalls += 1;
    return { body: { results: [] } };
  }

  async mutate(): ReturnType<GoogleAdsApiClient['mutate']> {
    await Promise.resolve();
    this.mutateCalls += 1;
    return { body: {} };
  }
}

const discoveryEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  GOOGLE_ADS_PHASE: 'OFF',
  GOOGLE_ADS_DEVELOPER_TOKEN_ENV_KEY: 'GOOGLE_ADS_DEVELOPER_TOKEN',
  GOOGLE_ADS_ACCESS_TOKEN_ENV_KEY: 'GOOGLE_ADS_ACCESS_TOKEN',
  GOOGLE_ADS_DEVELOPER_TOKEN: 'test-developer-token',
  GOOGLE_ADS_ACCESS_TOKEN: 'test-access-token',
});

describe('Google Ads credential-only discovery composition', () => {
  it('exposes only customer discovery while the operational phase remains OFF', () => {
    const composition = createTocaRuntimeComposition({ env: discoveryEnv() });

    expect(composition.config.GOOGLE_ADS_PHASE).toBe('OFF');
    expect(composition.registry.get('google_ads.customers.discover')).toBeDefined();
    expect(composition.runtimeResolver('google_ads.customers.discover')).toBeDefined();

    for (const capabilityId of [
      'google_ads.account.verify',
      'google_ads.account.inspect',
      'google_ads.campaigns.list',
      'google_ads.campaign.prepare',
      'google_ads.campaign.create_paused',
      'google_ads.campaign.activate',
    ]) {
      expect(composition.registry.get(capabilityId), capabilityId).toBeUndefined();
      expect(composition.runtimeResolver(capabilityId), capabilityId).toBeUndefined();
    }
  });

  it('fails closed when static and OAuth credential references are ambiguous', () => {
    const composition = createTocaRuntimeComposition({
      env: {
        ...discoveryEnv(),
        GOOGLE_ADS_OAUTH_CLIENT_ID_ENV_KEY: 'GOOGLE_ADS_OAUTH_CLIENT_ID',
        GOOGLE_ADS_OAUTH_CLIENT_SECRET_ENV_KEY: 'GOOGLE_ADS_OAUTH_CLIENT_SECRET',
        GOOGLE_ADS_OAUTH_REFRESH_TOKEN_ENV_KEY: 'GOOGLE_ADS_OAUTH_REFRESH_TOKEN',
        GOOGLE_ADS_OAUTH_CLIENT_ID: 'test-client-id',
        GOOGLE_ADS_OAUTH_CLIENT_SECRET: 'test-client-secret',
        GOOGLE_ADS_OAUTH_REFRESH_TOKEN: 'test-refresh-token',
      },
    });

    expect(composition.registry.get('google_ads.customers.discover')).toBeUndefined();
    expect(composition.runtimeResolver('google_ads.customers.discover')).toBeUndefined();
  });

  it('executes discovery without constructing a target-bound verifier or issuing search/mutate', async () => {
    const api = new DiscoveryOnlyGoogleAdsApi();
    const binding = resolvePaidMediaRuntimeBinding('google_ads.customers.discover', {
      googleAdsDiscoveryClient: api,
    });

    expect(binding).toBeDefined();
    await expect(binding!.execute({})).resolves.toEqual({
      resourceNames: ['customers/1234567890'],
      requestId: 'request-discovery-1',
    });
    expect(api.listCalls).toBe(1);
    expect(api.searchCalls).toBe(0);
    expect(api.mutateCalls).toBe(0);
    expect(
      resolvePaidMediaRuntimeBinding('google_ads.account.verify', {
        googleAdsDiscoveryClient: api,
      }),
    ).toBeUndefined();
  });
});
