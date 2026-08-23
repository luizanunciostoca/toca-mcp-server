import { describe, expect, it } from 'vitest';
import { InMemorySecretStore } from '../src/core/secrets.js';
import { GoogleAdsRestApiClient } from '../src/providers/google-ads/google-ads-api-client.js';

async function clientWithFetch(
  fetchImpl: typeof fetch,
  overrides: {
    readonly requestTimeoutMs?: number;
    readonly maxSafeAttempts?: number;
    readonly retryBaseDelayMs?: number;
  } = {},
) {
  const secrets = new InMemorySecretStore();
  const accessTokenRef = await secrets.put('access-token', 'fake-access-token');
  const developerTokenRef = await secrets.put('developer-token', 'fake-developer-token');
  return new GoogleAdsRestApiClient(
    {
      customerId: '1234567890',
      accessTokenRef,
      developerTokenRef,
      requestTimeoutMs: 20,
      maxSafeAttempts: 3,
      retryBaseDelayMs: 0,
      ...overrides,
    },
    secrets,
    fetchImpl,
  );
}

describe('Google Ads REST resilience without real provider calls', () => {
  it('retries a safe search after fake 429 and honors bounded attempts', async () => {
    let calls = 0;
    const client = await clientWithFetch(async () => {
      await Promise.resolve();
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED' } }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '0' },
        });
      }
      return new Response(JSON.stringify({ results: [{ campaign: { id: '1' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'request-id': 'req-recovered' },
      });
    });

    const result = await client.search('SELECT campaign.id FROM campaign LIMIT 1');

    expect(calls).toBe(2);
    expect(result.requestId).toBe('req-recovered');
  });

  it('does not retry fake permission denied', async () => {
    let calls = 0;
    const client = await clientWithFetch(async () => {
      await Promise.resolve();
      calls += 1;
      return new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED' } }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(client.search('SELECT campaign.id FROM campaign LIMIT 1')).rejects.toThrow(
      'GOOGLE_ADS_PROVIDER_ERROR:PERMISSION_DENIED',
    );
    expect(calls).toBe(1);
  });

  it('times out and retries a safe read without falling back to a real fetch', async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = (input, init) => {
      void input;
      calls += 1;
      if (calls > 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ results: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const abort = () => reject(new DOMException('fake timeout', 'AbortError'));
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
      });
    };
    const client = await clientWithFetch(fakeFetch, { requestTimeoutMs: 1, maxSafeAttempts: 2 });

    await expect(client.search('SELECT campaign.id FROM campaign LIMIT 1')).resolves.toMatchObject({
      body: { results: [] },
    });
    expect(calls).toBe(2);
  });

  it('never retries a real mutation after fake 429', async () => {
    let calls = 0;
    const client = await clientWithFetch(async () => {
      await Promise.resolve();
      calls += 1;
      return new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED' } }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '0' },
      });
    });

    await expect(
      client.mutate('/customers/1234567890/campaigns:mutate', {
        operations: [{ create: { status: 'PAUSED' } }],
      }),
    ).rejects.toThrow('GOOGLE_ADS_PROVIDER_ERROR:RESOURCE_EXHAUSTED');
    expect(calls).toBe(1);
  });

  it('may retry validateOnly because the request is side-effect free', async () => {
    let calls = 0;
    const client = await clientWithFetch(async () => {
      await Promise.resolve();
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { status: 'UNAVAILABLE' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(
      client.mutate('/customers/1234567890/googleAds:mutate', {
        validateOnly: true,
        mutateOperations: [],
      }),
    ).resolves.toMatchObject({ body: {} });
    expect(calls).toBe(2);
  });
});
