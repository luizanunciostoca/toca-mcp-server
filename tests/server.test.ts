import { describe, expect, it } from 'vitest';
import { SERVER_NAME, SERVER_VERSION, createTocaServer } from '../src/server.js';

describe('TOCA MCP production foundation', () => {
  it('exposes stable server metadata', () => {
    expect(SERVER_NAME).toBe('toca-mcp-server');
    expect(SERVER_VERSION).toBe('0.2.0');
    expect(
      createTocaServer({
        env: {
          NODE_ENV: 'test',
          MCP_ENABLED: 'true',
        },
      }),
    ).toBeDefined();
  });
  it('does not rebind provider-write evidence for runtimes without direct Instagram writes', () => {
    expect(() =>
      createTocaServer({
        env: {
          NODE_ENV: 'test',
          MCP_ENABLED: 'true',
          TOCA_RELEASE_SHA: 'f'.repeat(40),
          INSTAGRAM_PUBLICATION_WRITES_ENABLED: 'false',
        },
      }),
    ).not.toThrow();
  });

  it('keeps provider-write evidence exact-head enforcement for direct Instagram writers', () => {
    expect(() =>
      createTocaServer({
        env: {
          NODE_ENV: 'test',
          MCP_ENABLED: 'true',
          TOCA_RELEASE_SHA: 'f'.repeat(40),
          INSTAGRAM_PUBLICATION_WRITES_ENABLED: 'true',
          DATABASE_URL: 'postgres://example',
          INSTAGRAM_BUSINESS_ACCOUNT_ID: '17841402033495654',
          META_ACCESS_TOKEN_ENV_KEY: 'TEST_META_ACCESS_TOKEN',
          TEST_META_ACCESS_TOKEN: 'test-token',
        },
      }),
    ).toThrow('CAPABILITY_EVIDENCE_MANIFEST_EXACT_HEAD_MISMATCH');
  });

});
