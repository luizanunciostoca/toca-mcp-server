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

describe('media ranking runtime configuration', () => {
  it('keeps Google provider configuration optional for bootstrap runtimes', () => {
    expect(loadConfig({ NODE_ENV: 'test' })).toEqual({
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
    });
    expect(
      createToolRegistry()
        .list()
        .map((tool) => tool.name),
    ).toEqual(['system.capabilities', 'system.health']);
  });

  it('requires spreadsheet and token reference configuration together', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        TOCA_OS_MEDIA_SPREADSHEET_ID: 'sheet-id',
      }),
    ).toThrow(/must be configured together/);
  });

  it('fails closed when the referenced environment secret is missing', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        TOCA_OS_MEDIA_SPREADSHEET_ID: 'sheet-id',
        GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY: 'MISSING_TOKEN',
      }),
    ).toThrow(/Missing environment secret/);
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

  it('exposes media.assets.rank as implemented READ capability when configured', () => {
    const config = loadConfig(configuredEnv);
    expect(config.TOCA_OS_MEDIA_SPREADSHEET_ID).toBe('sheet-id');

    const tool = createToolRegistry({ mediaAssetsRankEnabled: true }).get('media.assets.rank');
    expect(tool).toMatchObject({
      provider: 'google-sheets',
      riskClass: 'READ',
      capabilityStatus: 'IMPLEMENTED',
      sideEffects: false,
      idempotent: true,
    });
  });

  it('constructs a configured server without contacting Google during bootstrap', () => {
    const server = createTocaServer({ env: configuredEnv });
    expect(server).toBeDefined();
  });
});
