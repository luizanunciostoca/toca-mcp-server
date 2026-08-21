import { describe, expect, it } from 'vitest';
import { InMemorySecretStore } from '../src/core/secrets.js';
import { GoogleAdsRestApiClient } from '../src/providers/google-ads/google-ads-api-client.js';

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe('Google Ads credential-only discovery client', () => {
  it('lists accessible customers without a configured customer id', async () => {
    const secrets = new InMemorySecretStore();
    await secrets.put('access-token', 'access-token-value');
    await secrets.put('developer-token', 'developer-token-value');
    const requests: Array<{
      readonly url: string;
      readonly init: RequestInit | undefined;
    }> = [];
    const fetchImpl: typeof fetch = (input, init) => {
      requests.push({ url: requestUrl(input), init });
      return Promise.resolve(
        new Response(JSON.stringify({ resourceNames: ['customers/1234567890'] }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'request-id': 'request-1' },
        }),
      );
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
      () => Promise.resolve(new Response('{}', { status: 200 })),
    );

    expect(() => client.search('SELECT customer.id FROM customer')).toThrow(
      'GOOGLE_ADS_CUSTOMER_ID_REQUIRED',
    );
    expect(() => client.mutate('/customers/1234567890/campaigns:mutate', {})).toThrow(
      'GOOGLE_ADS_CUSTOMER_ID_REQUIRED',
    );
  });
});
