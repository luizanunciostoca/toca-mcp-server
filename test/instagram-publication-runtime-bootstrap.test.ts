import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { loadConfig } from '../src/config.js';
import { createInstagramPublicationRuntimeHandlers } from '../src/worker/instagram-publication-runtime-bootstrap.js';
import { INSTAGRAM_PUBLICATION_JOB } from '../src/worker/instagram-publication-job.js';

const completePublicationEnv = {
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
  META_APP_SECRET: 'secret-value',
} satisfies NodeJS.ProcessEnv;

function createPool(): { pool: pg.Pool; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn();
  return { pool: { query } as unknown as pg.Pool, query };
}

describe('Instagram publication runtime bootstrap', () => {
  it('registers no publication handler when Meta is disabled', () => {
    const { pool } = createPool();
    const config = loadConfig({ NODE_ENV: 'test', META_ENABLED: 'false' });

    expect(createInstagramPublicationRuntimeHandlers(config, pool).size).toBe(0);
  });

  it('registers no publication handler without the persistent OAuth token store', () => {
    const { pool } = createPool();
    const config = loadConfig({
      ...completePublicationEnv,
      META_TOKEN_STORE_PROVIDER: 'memory',
    });

    expect(createInstagramPublicationRuntimeHandlers(config, pool).size).toBe(0);
  });

  it('mounts the publication pipeline but blocks execution while writes are disabled', async () => {
    const { pool, query } = createPool();
    const config = loadConfig(completePublicationEnv);
    const handlers = createInstagramPublicationRuntimeHandlers(config, pool);
    const handler = handlers.get(INSTAGRAM_PUBLICATION_JOB);

    expect([...handlers.keys()]).toEqual([INSTAGRAM_PUBLICATION_JOB]);
    await expect(handler?.execute({ malformed: true }, {} as never)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_WRITES_DISABLED',
    );
    expect(query).not.toHaveBeenCalled();
  });
});
