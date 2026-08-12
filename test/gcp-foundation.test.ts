import { afterEach, describe, expect, it } from 'vitest';
import { EnvironmentSecretResolver } from '../src/core/environment-secret-resolver.js';

const previous = process.env.TOCA_SECRET_META_APP_SECRET;

afterEach(() => {
  if (previous === undefined) delete process.env.TOCA_SECRET_META_APP_SECRET;
  else process.env.TOCA_SECRET_META_APP_SECRET = previous;
});

describe('Google Cloud production foundation', () => {
  it('resolves a Secret Manager binding from the Cloud Run environment', async () => {
    process.env.TOCA_SECRET_META_APP_SECRET = 'bound-secret';
    const resolver = new EnvironmentSecretResolver();
    await expect(
      resolver.resolve({ provider: 'gcp-secret-manager', key: 'meta-app-secret' }),
    ).resolves.toBe('bound-secret');
  });

  it('rejects provider mismatches instead of falling back to arbitrary environment variables', async () => {
    const resolver = new EnvironmentSecretResolver();
    await expect(resolver.resolve({ provider: 'memory', key: 'meta-app-secret' })).rejects.toThrow(
      'Secret provider mismatch',
    );
  });
});
