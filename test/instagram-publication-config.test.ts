import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const approvedRequestSha256 = 'a'.repeat(64);

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
  META_REQUESTED_SCOPES: 'pages_show_list,instagram_basic,instagram_content_publish',
  META_GRAPH_BASE_URL: 'https://graph.facebook.com',
  META_GRAPH_API_VERSION: 'v24.0',
} satisfies NodeJS.ProcessEnv;

describe('Instagram publication runtime configuration', () => {
  it('keeps publication writes disabled by default', () => {
    expect(loadConfig({ NODE_ENV: 'test', META_ENABLED: 'false' })).toMatchObject({
      INSTAGRAM_PUBLICATION_WRITES_ENABLED: false,
    });
  });

  it('rejects publication writes when Meta is disabled', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        META_ENABLED: 'false',
        INSTAGRAM_PUBLICATION_WRITES_ENABLED: 'true',
        INSTAGRAM_PUBLICATION_APPROVED_REQUEST_SHA256: approvedRequestSha256,
        DATABASE_URL: 'postgres://example',
      }),
    ).toThrow('META_ENABLED must be true');
  });

  it('requires persistent storage before publication writes can be enabled', () => {
    expect(() =>
      loadConfig({
        ...completeMetaEnv,
        INSTAGRAM_PUBLICATION_WRITES_ENABLED: 'true',
        INSTAGRAM_PUBLICATION_APPROVED_REQUEST_SHA256: approvedRequestSha256,
      }),
    ).toThrow('DATABASE_URL is required');
  });

  it('requires the persistent OAuth Secret Manager token store', () => {
    expect(() =>
      loadConfig({
        ...completeMetaEnv,
        INSTAGRAM_PUBLICATION_WRITES_ENABLED: 'true',
        INSTAGRAM_PUBLICATION_APPROVED_REQUEST_SHA256: approvedRequestSha256,
        DATABASE_URL: 'postgres://example',
      }),
    ).toThrow('META_TOKEN_STORE_PROVIDER must be gcp-secret-manager');
  });

  it('requires a pre-approved request hash before publication writes can be enabled', () => {
    expect(() =>
      loadConfig({
        ...completeMetaEnv,
        INSTAGRAM_PUBLICATION_WRITES_ENABLED: 'true',
        DATABASE_URL: 'postgres://example',
        META_TOKEN_STORE_PROVIDER: 'gcp-secret-manager',
        GCP_PROJECT_ID: 'toca-mcp-production',
        META_TOKEN_SECRET_ID: 'toca-meta-oauth-token',
      }),
    ).toThrow('INSTAGRAM_PUBLICATION_APPROVED_REQUEST_SHA256 is required');
  });

  it('accepts publication enablement only with Meta, database, token secret and approval configured', () => {
    expect(
      loadConfig({
        ...completeMetaEnv,
        INSTAGRAM_PUBLICATION_WRITES_ENABLED: 'true',
        INSTAGRAM_PUBLICATION_APPROVED_REQUEST_SHA256: approvedRequestSha256,
        DATABASE_URL: 'postgres://example',
        META_TOKEN_STORE_PROVIDER: 'gcp-secret-manager',
        GCP_PROJECT_ID: 'toca-mcp-production',
        META_TOKEN_SECRET_ID: 'toca-meta-oauth-token',
      }),
    ).toMatchObject({
      META_ENABLED: true,
      INSTAGRAM_PUBLICATION_WRITES_ENABLED: true,
      INSTAGRAM_PUBLICATION_APPROVED_REQUEST_SHA256: approvedRequestSha256,
      DATABASE_URL: 'postgres://example',
      META_TOKEN_STORE_PROVIDER: 'gcp-secret-manager',
      GCP_PROJECT_ID: 'toca-mcp-production',
      META_TOKEN_SECRET_ID: 'toca-meta-oauth-token',
    });
  });
});
