import { describe, expect, it } from 'vitest';
import type { SecretReference, SecretResolver } from '../src/core/secrets.js';
import { MetaApiClient, type MetaApiTransport } from '../src/providers/meta/meta-api-client.js';
import { InMemoryScheduler } from '../src/scheduler/in-memory-scheduler.js';

class StaticSecrets implements SecretResolver {
  async resolve(_reference: SecretReference): Promise<string> {
    return 'test-token';
  }
}

describe('preconnection runtime support', () => {
  it('keeps provider tokens in authorization headers instead of query parameters', async () => {
    let observedUrl = '';
    let observedAuthorization = '';
    const transport: MetaApiTransport = {
      async request(url, init) {
        observedUrl = url;
        observedAuthorization = new Headers(init.headers).get('authorization') ?? '';
        return { ok: true, status: 200, async json() { return { data: [] }; } };
      },
    };
    const client = new MetaApiClient(
      { graphBaseUrl: 'https://graph.facebook.com', apiVersion: 'v-test' },
      new StaticSecrets(),
      { provider: 'test', key: 'meta-token' },
      transport,
    );

    await client.get('me', { fields: 'id' });
    expect(observedUrl).not.toContain('test-token');
    expect(observedAuthorization).toBe('Bearer test-token');
  });

  it('deduplicates scheduled jobs by idempotency key', async () => {
    const scheduler = new InMemoryScheduler();
    const first = await scheduler.schedule({
      id: 'job-1',
      toolName: 'instagram.publish.image',
      payload: { publicationId: 'pub-1' },
      runAt: '2026-08-10T18:00:00-03:00',
      timezone: 'America/Bahia',
      idempotencyKey: 'pub-1',
    });
    const duplicate = await scheduler.schedule({
      id: 'job-2',
      toolName: 'instagram.publish.image',
      payload: { publicationId: 'pub-1' },
      runAt: '2026-08-10T18:00:00-03:00',
      timezone: 'America/Bahia',
      idempotencyKey: 'pub-1',
    });
    expect(duplicate.id).toBe(first.id);
  });
});
