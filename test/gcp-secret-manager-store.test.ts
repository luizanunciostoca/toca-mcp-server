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
  it('adds a version to one dedicated secret, resolves that exact version and destroys it', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
      const url = inputUrl(input);
      calls.push(init ? { url, init } : { url });

      if (url.endsWith('/secrets/toca-meta-oauth-token:addVersion')) {
        return Promise.resolve(
          jsonResponse({
            name: 'projects/toca-project/secrets/toca-meta-oauth-token/versions/7',
          }),
        );
      }
      if (url.endsWith('/secrets/toca-meta-oauth-token/versions/7:access')) {
        return Promise.resolve(
          jsonResponse({
            payload: { data: Buffer.from('SENSITIVE_TOKEN').toString('base64') },
          }),
        );
      }
      if (url.endsWith('/secrets/toca-meta-oauth-token/versions/7:destroy')) {
        return Promise.resolve(jsonResponse({ state: 'DESTROYED' }));
      }
      return Promise.resolve(jsonResponse({}, 404));
    });

    const store = new GcpSecretManagerStore({
      projectId: 'toca-project',
      secretId: 'toca-meta-oauth-token',
      accessToken: () => Promise.resolve('GCP_ACCESS_TOKEN'),
      fetchImpl,
    });

    const reference = await store.put('ignored-logical-key', 'SENSITIVE_TOKEN');
    expect(reference).toEqual({
      provider: 'gcp-secret-manager',
      key: 'toca-meta-oauth-token/versions/7',
    });
    await expect(store.resolve(reference)).resolves.toBe('SENSITIVE_TOKEN');
    await expect(store.delete(reference)).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const serializedCalls = JSON.stringify(calls);
    expect(serializedCalls).not.toContain('SENSITIVE_TOKEN');
    expect(serializedCalls).toContain(Buffer.from('SENSITIVE_TOKEN').toString('base64'));
    expect(serializedCalls).not.toContain('/secrets?secretId=');
    expect(serializedCalls).not.toContain('"method":"DELETE"');
  });

  it('rejects a reference for a different secret even with the same provider', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const store = new GcpSecretManagerStore({
      projectId: 'toca-project',
      secretId: 'toca-meta-oauth-token',
      accessToken: () => Promise.resolve('GCP_ACCESS_TOKEN'),
      fetchImpl,
    });

    await expect(
      store.resolve({
        provider: 'gcp-secret-manager',
        key: 'another-secret/versions/1',
      }),
    ).rejects.toThrow('Secret reference does not belong to the configured secret');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects references from another provider', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const store = new GcpSecretManagerStore({
      projectId: 'toca-project',
      secretId: 'toca-meta-oauth-token',
      accessToken: () => Promise.resolve('GCP_ACCESS_TOKEN'),
      fetchImpl,
    });

    await expect(
      store.resolve({ provider: 'memory', key: 'toca-meta-oauth-token/versions/1' }),
    ).rejects.toThrow('Secret provider mismatch');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
