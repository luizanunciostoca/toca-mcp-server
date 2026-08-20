import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createMetaPublicationTokenReference } from '../src/providers/meta/meta-publication-client.js';

const publicationEnv = {
  NODE_ENV: 'test',
  MCP_ENABLED: 'false',
  META_ENABLED: 'true',
  META_APP_ID: 'app-123',
  META_APP_SECRET_PROVIDER: 'env',
  META_APP_SECRET_KEY: 'META_APP_SECRET',
  META_AUTHORIZATION_ENDPOINT: 'https://www.facebook.com/dialog/oauth',
  META_TOKEN_ENDPOINT: 'https://graph.facebook.com/oauth/access_token',
  META_REDIRECT_URI: 'https://example.com/oauth/meta/callback',
  META_REQUESTED_SCOPES: 'pages_show_list,instagram_basic,instagram_content_publish',
  INSTAGRAM_PUBLICATION_WRITES_ENABLED: 'true',
  INSTAGRAM_PUBLICATION_APPROVED_REQUEST_SHA256: 'a'.repeat(64),
  DATABASE_URL: 'postgres://example',
  META_TOKEN_STORE_PROVIDER: 'gcp-secret-manager',
  GCP_PROJECT_ID: 'toca-mcp-production',
  META_TOKEN_SECRET_ID: 'toca-meta-oauth-token',
} satisfies NodeJS.ProcessEnv;

describe('Meta publication client token binding', () => {
  it('uses the latest version of the same Secret Manager secret populated by OAuth', () => {
    const config = loadConfig(publicationEnv);

    expect(createMetaPublicationTokenReference(config)).toEqual({
      provider: 'gcp-secret-manager',
      key: 'toca-meta-oauth-token/versions/latest',
    });
  });
});
