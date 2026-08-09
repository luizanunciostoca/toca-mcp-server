import { describe, expect, it } from 'vitest';
import { InMemorySecretStore, serializeSecretReference } from '../src/core/secrets.js';

describe('SecretStore boundary', () => {
  it('persists values behind opaque references and supports revocation', async () => {
    const store = new InMemorySecretStore('test-secrets');
    const reference = await store.put('meta/user-token', 'SENSITIVE_TOKEN');

    expect(reference).toEqual({ provider: 'test-secrets', key: 'meta/user-token' });
    expect(serializeSecretReference(reference)).toBe('test-secrets:meta/user-token');
    await expect(store.resolve(reference)).resolves.toBe('SENSITIVE_TOKEN');

    await store.delete(reference);
    await expect(store.resolve(reference)).rejects.toThrow('Secret not found');
  });

  it('rejects references owned by another secret provider', async () => {
    const store = new InMemorySecretStore('provider-a');
    await expect(store.resolve({ provider: 'provider-b', key: 'meta/token' })).rejects.toThrow(
      'Secret provider mismatch',
    );
  });
});
