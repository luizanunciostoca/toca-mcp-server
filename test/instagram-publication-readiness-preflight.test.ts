import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { MetaApiClient } from '../src/providers/meta/meta-api-client.js';
import { checkInstagramPublicationReadiness } from '../src/providers/instagram/instagram-publication-readiness-preflight.js';

function createPool() {
  const query = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
  return { pool: { query } as unknown as pg.Pool, query };
}

function createMetaClient(responses: Readonly<Record<string, unknown>>) {
  const get = vi.fn((path: string) => Promise.resolve(responses[path]));
  const post = vi.fn();
  return {
    client: { get, post } as unknown as MetaApiClient,
    get,
    post,
  };
}

const grantedPermissions = {
  data: [{ permission: 'instagram_content_publish', status: 'granted' }],
};

const matchingAccounts = {
  data: [
    {
      id: 'page-123',
      tasks: ['CREATE_CONTENT'],
      instagram_business_account: { id: 'ig-123' },
    },
  ],
};

describe('Instagram publication readiness preflight', () => {
  it('proves database, permission, and unique linked Instagram account using GET-only checks', async () => {
    const { pool, query } = createPool();
    const { client, get, post } = createMetaClient({
      'me/permissions': grantedPermissions,
      'me/accounts': matchingAccounts,
    });

    await expect(
      checkInstagramPublicationReadiness({
        pool,
        metaClient: client,
        instagramBusinessAccountId: 'ig-123',
      }),
    ).resolves.toEqual({
      databaseReady: true,
      permissionReady: true,
      accountReady: true,
      pageId: 'page-123',
      instagramBusinessAccountId: 'ig-123',
    });

    expect(query).toHaveBeenCalledWith('select 1');
    expect(get).toHaveBeenNthCalledWith(1, 'me/permissions');
    expect(get).toHaveBeenNthCalledWith(2, 'me/accounts', {
      fields: 'id,tasks,instagram_business_account',
      limit: '100',
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('fails closed when instagram_content_publish is not granted', async () => {
    const { pool } = createPool();
    const { client, get } = createMetaClient({
      'me/permissions': {
        data: [{ permission: 'instagram_content_publish', status: 'declined' }],
      },
    });

    await expect(
      checkInstagramPublicationReadiness({
        pool,
        metaClient: client,
        instagramBusinessAccountId: 'ig-123',
      }),
    ).rejects.toThrow('INSTAGRAM_CONTENT_PUBLISH_PERMISSION_NOT_GRANTED');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the configured Instagram account is not uniquely linked', async () => {
    const { pool } = createPool();
    const { client } = createMetaClient({
      'me/permissions': grantedPermissions,
      'me/accounts': { data: [] },
    });

    await expect(
      checkInstagramPublicationReadiness({
        pool,
        metaClient: client,
        instagramBusinessAccountId: 'ig-123',
      }),
    ).rejects.toThrow('INSTAGRAM_PUBLICATION_ACCOUNT_MATCH_COUNT_0');
  });

  it('fails closed on malformed Meta responses', async () => {
    const { pool } = createPool();
    const { client } = createMetaClient({ 'me/permissions': { unexpected: true } });

    await expect(
      checkInstagramPublicationReadiness({
        pool,
        metaClient: client,
        instagramBusinessAccountId: 'ig-123',
      }),
    ).rejects.toThrow('INSTAGRAM_PUBLICATION_PERMISSIONS_RESPONSE_INVALID');
  });
});
