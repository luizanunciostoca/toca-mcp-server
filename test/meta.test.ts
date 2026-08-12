import { describe, expect, it } from 'vitest';
import { InMemoryConnectedAccountStore } from '../src/core/connected-account-store.js';
import type { MetaConnectionState } from '../src/providers/meta/meta-connection.js';
import { toConnectionValidation } from '../src/providers/meta/meta-discovery.js';

const account = {
  id: 'meta-account-1',
  provider: 'meta',
  externalAccountId: '123',
  label: 'Toca Meta',
  scopes: ['pages_show_list'],
  status: 'CONNECTED' as const,
  tokenReference: 'secret-store:meta/account-1',
};

const connectionState: MetaConnectionState = {
  account,
  accessToken: { provider: 'secret-store', key: 'meta/account-1' },
  grantedScopes: ['pages_show_list'],
  connectedAt: '2026-08-09T02:00:00.000Z',
};

describe('ConnectedAccountStore', () => {
  it('persists and lists accounts deterministically by provider', async () => {
    const store = new InMemoryConnectedAccountStore();
    await store.save(account);

    await expect(store.get(account.id)).resolves.toEqual(account);
    await expect(store.listByProvider('meta')).resolves.toEqual([account]);
    await expect(store.listByProvider('other')).resolves.toEqual([]);
  });
});

describe('Meta capability discovery', () => {
  it('publishes only capabilities backed by positive provider evidence', () => {
    expect(
      toConnectionValidation({
        state: connectionState,
        providerAccountId: '123',
        checkedAt: '2026-08-09T02:10:00.000Z',
        evidence: [
          { capability: 'instagram.account.read', supported: true },
          { capability: 'instagram.publish.reel', supported: false, reason: 'not validated' },
        ],
      }),
    ).toEqual({
      healthy: true,
      providerAccountId: '123',
      grantedScopes: ['pages_show_list'],
      capabilities: ['instagram.account.read'],
      checkedAt: '2026-08-09T02:10:00.000Z',
      reason: undefined,
    });
  });

  it('marks validation unhealthy when the provider reports a failure reason', () => {
    expect(
      toConnectionValidation({
        state: connectionState,
        checkedAt: '2026-08-09T02:10:00.000Z',
        evidence: [],
        reason: 'TOKEN_EXPIRED',
      }),
    ).toMatchObject({ healthy: false, capabilities: [], reason: 'TOKEN_EXPIRED' });
  });
});
