import { describe, expect, it, vi } from 'vitest';
import { GcpSecretManagerStore } from '../src/core/gcp-secret-manager-store.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function inputUrl(input: URL | RequestInfo): string {
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  return input;
}

describe('GcpSecretManagerStore', () => {
  it('creates a secret, adds a version, resolves it and deletes it without exposing the token', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
      const url = inputUrl(input);
      calls.push(init ? { url, init } : { url });

      if (url.includes(':addVersion')) return Promise.resolve(jsonResponse({ name: 'version-1' }));
      if (url.endsWith('/versions/latest:access')) {
        return Promise.resolve(
          jsonResponse({
            payload: { data: Buffer.from('SENSITIVE_TOKEN').toString('base64') },
          }),
        );
      }
      if (init?.method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(jsonResponse({ name: 'secret' }));
    });

    const store = new GcpSecretManagerStore({
      projectId: 'toca-project',
      accessToken: () => Promise.resolve('GCP_ACCESS_TOKEN'),
      fetchImpl,
    });

    const reference = await store.put('meta/access token', 'SENSITIVE_TOKEN');
    expect(reference).toEqual({ provider: 'gcp-secret-manager', key: 'meta-access-token' });
    await expect(store.resolve(reference)).resolves.toBe('SENSITIVE_TOKEN');
    await expect(store.delete(reference)).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const serializedCalls = JSON.stringify(calls);
    expect(serializedCalls).not.toContain('SENSITIVE_TOKEN');
    expect(serializedCalls).toContain(Buffer.from('SENSITIVE_TOKEN').toString('base64'));
  });

  it('accepts an existing secret and only adds a new version', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(jsonResponse({ name: 'version-2' }));

    const store = new GcpSecretManagerStore({
      projectId: 'toca-project',
      accessToken: () => Promise.resolve('GCP_ACCESS_TOKEN'),
      fetchImpl,
    });

    await expect(store.put('meta-token', 'NEW_TOKEN')).resolves.toEqual({
      provider: 'gcp-secret-manager',
      key: 'meta-token',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects references from another provider', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const store = new GcpSecretManagerStore({
      projectId: 'toca-project',
      accessToken: () => Promise.resolve('GCP_ACCESS_TOKEN'),
      fetchImpl,
    });

    await expect(store.resolve({ provider: 'memory', key: 'meta-token' })).rejects.toThrow(
      'Secret provider mismatch',
    );
  });
});
