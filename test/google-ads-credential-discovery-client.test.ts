import { describe, expect, it } from 'vitest';
import { InMemorySecretStore } from '../src/core/secrets.js';
import { GoogleAdsRestApiClient } from '../src/providers/google-ads/google-ads-api-client.js';

describe('Google Ads credential-only discovery client', () => {
  it('lists accessible customers without a configured customer id', async () => {
    const secrets = new InMemorySecretStore();
    await secrets.put('access-token', 'access-token-value');
    await secrets.put('developer-token', 'developer-token-value');
    const requests: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({ resourceNames: ['customers/1234567890'] }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'request-id': 'request-1' },
      });
    };

    const client = new GoogleAdsRestApiClient(
      {
        accessTokenRef: { provider: 'memory', key: 'access-token' },
        developerTokenRef: { provider: 'memory', key: 'developer-token' },
      },
      secrets,
      fetchImpl,
    );

    const result = await client.listAccessibleCustomers();
    expect(result.body.resourceNames).toEqual(['customers/1234567890']);
    expect(result.requestId).toBe('request-1');
    expect(requests[0]?.url).toContain('/v25/customers:listAccessibleCustomers');
  });

  it('keeps customer-bound calls fail-closed until a customer is selected', async () => {
    const secrets = new InMemorySecretStore();
    await secrets.put('access-token', 'access-token-value');
    await secrets.put('developer-token', 'developer-token-value');
    const client = new GoogleAdsRestApiClient(
      {
        accessTokenRef: { provider: 'memory', key: 'access-token' },
        developerTokenRef: { provider: 'memory', key: 'developer-token' },
      },
      secrets,
      async () => new Response('{}', { status: 200 }),
    );

    await expect(client.search('SELECT customer.id FROM customer')).rejects.toThrow(
      'GOOGLE_ADS_CUSTOMER_ID_REQUIRED',
    );
    await expect(client.mutate('/customers/1234567890/campaigns:mutate', {})).rejects.toThrow(
      'GOOGLE_ADS_CUSTOMER_ID_REQUIRED',
    );
  });
});
