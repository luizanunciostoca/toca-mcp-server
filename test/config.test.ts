import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const completeMetaEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'info',
  META_ENABLED: 'true',
  META_APP_ID: 'app-123',
  META_APP_SECRET_PROVIDER: 'secret-manager',
  META_APP_SECRET_KEY: 'toca/meta/app-secret',
  META_AUTHORIZATION_ENDPOINT: 'https://www.facebook.com/dialog/oauth',
  META_TOKEN_ENDPOINT: 'https://graph.facebook.com/oauth/access_token',
  META_REDIRECT_URI: 'https://example.com/oauth/meta/callback',
  META_REQUESTED_SCOPES: 'pages_show_list,instagram_basic',
  META_GRAPH_BASE_URL: 'https://graph.facebook.com',
  META_GRAPH_API_VERSION: 'v1.0',
} satisfies NodeJS.ProcessEnv;

describe('runtime configuration', () => {
  it('starts with Meta and TOCA-managed scheduling disabled without requiring provider settings', () => {
    expect(loadConfig({ NODE_ENV: 'test', META_ENABLED: 'false' })).toMatchObject({
      NODE_ENV: 'test',
      META_ENABLED: false,
      META_WEBHOOK_ENABLED: false,
      TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED: false,
    });
  });

  it('requires Postgres when TOCA-managed scheduling is enabled', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED: 'true',
      }),
    ).toThrow('DATABASE_URL is required when TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED=true');

    expect(
      loadConfig({
        NODE_ENV: 'test',
        TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED: 'true',
        DATABASE_URL: 'postgres://localhost/toca-test',
      }),
    ).toMatchObject({
      TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED: true,
      DATABASE_URL: 'postgres://localhost/toca-test',
    });
  });

  it('rejects a partially configured Meta integration when enabled', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        META_ENABLED: 'true',
        META_APP_ID: 'app-123',
      }),
    ).toThrow();
  });

  it('accepts a complete Meta configuration using only a secret reference', () => {
    const config = loadConfig(completeMetaEnv);

    expect(config).toMatchObject({
      META_ENABLED: true,
      META_APP_ID: 'app-123',
      META_APP_SECRET_PROVIDER: 'secret-manager',
      META_APP_SECRET_KEY: 'toca/meta/app-secret',
      META_GRAPH_API_VERSION: 'v1.0',
      META_TOKEN_STORE_PROVIDER: 'memory',
    });
    expect(JSON.stringify(config)).not.toContain('APP_SECRET_VALUE');
  });

  it('does not allow the webhook boundary unless Meta is enabled', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        META_ENABLED: 'false',
        META_WEBHOOK_ENABLED: 'true',
      }),
    ).toThrow('META_ENABLED must be true');
  });

  it('requires only a verify-token secret key when the webhook boundary is enabled', () => {
    expect(() =>
      loadConfig({
        ...completeMetaEnv,
        META_WEBHOOK_ENABLED: 'true',
      }),
    ).toThrow('META_WEBHOOK_VERIFY_TOKEN_KEY is required');

    const config = loadConfig({
      ...completeMetaEnv,
      META_WEBHOOK_ENABLED: 'true',
      META_WEBHOOK_VERIFY_TOKEN_KEY: 'META_WEBHOOK_VERIFY_TOKEN',
    });

    expect(config).toMatchObject({
      META_WEBHOOK_ENABLED: true,
      META_WEBHOOK_VERIFY_TOKEN_KEY: 'META_WEBHOOK_VERIFY_TOKEN',
    });
    expect(JSON.stringify(config)).not.toContain('verify-token-value');
  });

  it('requires a GCP project for the persistent Secret Manager token store', () => {
    expect(() =>
      loadConfig({
        ...completeMetaEnv,
        META_TOKEN_STORE_PROVIDER: 'gcp-secret-manager',
        META_TOKEN_SECRET_ID: 'toca-meta-oauth-token',
      }),
    ).toThrow('GCP_PROJECT_ID is required');
  });

  it('requires a dedicated secret ID for the persistent Secret Manager token store', () => {
    expect(() =>
      loadConfig({
        ...completeMetaEnv,
        META_TOKEN_STORE_PROVIDER: 'gcp-secret-manager',
        GCP_PROJECT_ID: 'toca-mcp-production',
      }),
    ).toThrow('META_TOKEN_SECRET_ID is required');
  });

  it('accepts the persistent Secret Manager token store with project and dedicated secret', () => {
    expect(
      loadConfig({
        ...completeMetaEnv,
        META_TOKEN_STORE_PROVIDER: 'gcp-secret-manager',
        GCP_PROJECT_ID: 'toca-mcp-production',
        META_TOKEN_SECRET_ID: 'toca-meta-oauth-token',
      }),
    ).toMatchObject({
      META_TOKEN_STORE_PROVIDER: 'gcp-secret-manager',
      GCP_PROJECT_ID: 'toca-mcp-production',
      META_TOKEN_SECRET_ID: 'toca-meta-oauth-token',
    });
  });
});
