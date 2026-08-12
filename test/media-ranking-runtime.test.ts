import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { EnvironmentSecretResolver } from '../src/core/secrets.js';
import { createToolRegistry } from '../src/registry.js';
import { createTocaServer } from '../src/server.js';

const configuredEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'info',
  TOCA_OS_MEDIA_SPREADSHEET_ID: 'sheet-id',
  GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY: 'TEST_GOOGLE_SHEETS_TOKEN',
  TEST_GOOGLE_SHEETS_TOKEN: 'access-token',
};

const instagramEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  INSTAGRAM_READ_ENABLED: 'true',
  INSTAGRAM_BUSINESS_ACCOUNT_ID: '17841402033495654',
  META_ACCESS_TOKEN_ENV_KEY: 'TEST_META_TOKEN',
  TEST_META_TOKEN: 'meta-access-token',
};

describe('TOCA MCP execution-layer boundary', () => {
  it('keeps external provider configuration optional for bootstrap runtimes', () => {
    expect(loadConfig({ NODE_ENV: 'test' })).toMatchObject({
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      INSTAGRAM_READ_ENABLED: false,
      META_GRAPH_BASE_URL: 'https://graph.facebook.com',
      META_GRAPH_API_VERSION: 'v24.0',
    });

    const registry = createToolRegistry();
    expect(
      registry
        .list()
        .filter((tool) => tool.capabilityStatus !== 'PLANNED')
        .map((tool) => tool.name),
    ).toEqual(['system.capabilities', 'system.health']);
    expect(registry.get('instagram.publish.image')?.capabilityStatus).toBe('PLANNED');
  });

  it('requires spreadsheet and token reference configuration together when present', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        TOCA_OS_MEDIA_SPREADSHEET_ID: 'sheet-id',
      }),
    ).toThrow(/must be configured together/);
  });

  it('fails closed when a referenced environment secret is missing', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        TOCA_OS_MEDIA_SPREADSHEET_ID: 'sheet-id',
        GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY: 'MISSING_TOKEN',
      }),
    ).toThrow(/Missing environment secret/);
  });

  it('requires Instagram account and secret reference when reads are enabled', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', INSTAGRAM_READ_ENABLED: 'true' })).toThrow(
      /INSTAGRAM_BUSINESS_ACCOUNT_ID/,
    );
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        INSTAGRAM_READ_ENABLED: 'true',
        INSTAGRAM_BUSINESS_ACCOUNT_ID: 'account-id',
      }),
    ).toThrow(/META_ACCESS_TOKEN_ENV_KEY/);
  });

  it('resolves only explicit env secret references', async () => {
    const resolver = new EnvironmentSecretResolver(configuredEnv);

    await expect(
      resolver.resolve({ provider: 'env', key: 'TEST_GOOGLE_SHEETS_TOKEN' }),
    ).resolves.toBe('access-token');
    await expect(resolver.resolve({ provider: 'vault', key: 'secret' })).rejects.toThrow(
      /Unsupported secret provider/,
    );
  });

  it('does not expose creative ranking as an MCP capability', () => {
    expect(createToolRegistry().get('media.assets.rank')).toBeUndefined();
  });

  it('exposes implemented read-only Instagram capabilities only when explicitly enabled', () => {
    const registry = createToolRegistry({ instagramReadsEnabled: true });
    expect(
      registry
        .list()
        .filter((tool) => tool.capabilityStatus === 'IMPLEMENTED')
        .map((tool) => tool.name),
    ).toEqual([
      'instagram.insights.account',
      'instagram.insights.media',
      'instagram.media.list',
      'system.capabilities',
      'system.health',
    ]);
    expect(registry.get('instagram.publication.schedule')?.capabilityStatus).toBe('PLANNED');
  });

  it('constructs configured bootstrap and Instagram read runtimes', () => {
    expect(createTocaServer({ env: configuredEnv })).toBeDefined();
    expect(createTocaServer({ env: instagramEnv })).toBeDefined();
  });
});
