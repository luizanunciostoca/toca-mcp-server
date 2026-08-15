import { describe, expect, it } from 'vitest';
import { InMemorySecretStore } from '../src/core/secrets.js';
import { GoogleAdsRestApiClient } from '../src/providers/google-ads/google-ads-api-client.js';

describe('Google Ads REST adapter', () => {
  it('uses v25, OAuth bearer, developer token and manager login headers without real network access', async () => {
    const secrets = new InMemorySecretStore();
    const accessTokenRef = await secrets.put('access-token', 'oauth-test-token');
    const developerTokenRef = await secrets.put('developer-token', 'developer-test-token');
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'request-id': 'req-123', 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new GoogleAdsRestApiClient(
      {
        customerId: '123-456-7890',
        loginCustomerId: '999-888-7777',
        accessTokenRef,
        developerTokenRef,
      },
      secrets,
      fakeFetch,
    );

    const response = await client.search('SELECT campaign.id FROM campaign LIMIT 1');

    expect(response.requestId).toBe('req-123');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'https://googleads.googleapis.com/v25/customers/1234567890/googleAds:search',
    );
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get('authorization')).toBe('Bearer oauth-test-token');
    expect(headers.get('developer-token')).toBe('developer-test-token');
    expect(headers.get('login-customer-id')).toBe('9998887777');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      query: 'SELECT campaign.id FROM campaign LIMIT 1',
    });
  });

  it('fails closed when a mutation attempts to cross the configured customer boundary', async () => {
    const secrets = new InMemorySecretStore();
    const accessTokenRef = await secrets.put('access-token', 'oauth-test-token');
    const developerTokenRef = await secrets.put('developer-token', 'developer-test-token');
    const client = new GoogleAdsRestApiClient(
      {
        customerId: '1234567890',
        accessTokenRef,
        developerTokenRef,
      },
      secrets,
      (async () => new Response('{}', { status: 200 })) as typeof fetch,
    );

    await expect(
      client.mutate('/customers/9999999999/campaigns:mutate', { operations: [] }),
    ).rejects.toThrow('GOOGLE_ADS_CUSTOMER_BOUNDARY_VIOLATION');
  });
});
