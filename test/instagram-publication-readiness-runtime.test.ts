import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { loadConfig } from '../src/config.js';
import type { MetaApiClient } from '../src/providers/meta/meta-api-client.js';
import { runInstagramPublicationReadinessPreflight } from '../src/providers/instagram/instagram-publication-readiness-runtime.js';

const completeEnv = {
  NODE_ENV: 'test',
  META_ENABLED: 'true',
  META_APP_ID: 'app-123',
  META_APP_SECRET_PROVIDER: 'env',
  META_APP_SECRET_KEY: 'META_APP_SECRET',
  META_AUTHORIZATION_ENDPOINT: 'https://www.facebook.com/dialog/oauth',
  META_TOKEN_ENDPOINT: 'https://graph.facebook.com/oauth/access_token',
  META_REDIRECT_URI: 'https://example.com/oauth/meta/callback',
  META_REQUESTED_SCOPES: 'pages_show_list,instagram_basic,instagram_content_publish',
  META_GRAPH_BASE_URL: 'https://graph.facebook.com',
  META_GRAPH_API_VERSION: 'v24.0',
  META_TOKEN_STORE_PROVIDER: 'gcp-secret-manager',
  META_TOKEN_SECRET_ID: 'toca-meta-oauth-token',
  GCP_PROJECT_ID: 'toca-mcp-production',
  INSTAGRAM_BUSINESS_ACCOUNT_ID: 'ig-123',
  INSTAGRAM_PUBLICATION_WRITES_ENABLED: 'false',
  META_APP_SECRET: 'secret-value',
} satisfies NodeJS.ProcessEnv;

function createPool(): pg.Pool {
  return { query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) } as unknown as pg.Pool;
}

function createMetaClient(): MetaApiClient {
  const get = vi.fn((path: string) => {
    if (path === 'me/permissions') {
      return Promise.resolve({
        data: [{ permission: 'instagram_content_publish', status: 'granted' }],
      });
    }
    return Promise.resolve({
      data: [
        {
          id: 'page-123',
          tasks: ['CREATE_CONTENT'],
          instagram_business_account: { id: 'ig-123' },
        },
      ],
    });
  });
  return { get } as unknown as MetaApiClient;
}

describe('Instagram publication readiness runtime', () => {
  it('runs the read-only preflight while publication writes remain disabled', async () => {
    const config = loadConfig(completeEnv);

    await expect(
      runInstagramPublicationReadinessPreflight({
        config,
        pool: createPool(),
        metaClient: createMetaClient(),
      }),
    ).resolves.toMatchObject({
      databaseReady: true,
      permissionReady: true,
      accountReady: true,
      pageId: 'page-123',
    });
    expect(config.INSTAGRAM_PUBLICATION_WRITES_ENABLED).toBe(false);
  });

  it('rejects non-persistent OAuth token configuration', async () => {
    const config = loadConfig({ ...completeEnv, META_TOKEN_STORE_PROVIDER: 'memory' });

    await expect(
      runInstagramPublicationReadinessPreflight({
        config,
        pool: createPool(),
        metaClient: createMetaClient(),
      }),
    ).rejects.toThrow('META_PUBLICATION_TOKEN_STORE_MUST_BE_GCP_SECRET_MANAGER');
  });
});
