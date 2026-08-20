import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createToolRegistry } from '../src/registry.js';

const oauthEnv = {
  NODE_ENV: 'test',
  GOOGLE_ADS_PHASE: 'READ_ONLY',
  GOOGLE_ADS_CUSTOMER_ID: '1234567890',
  GOOGLE_ADS_OAUTH_CLIENT_ID_ENV_KEY: 'GOOGLE_ADS_CLIENT_ID',
  GOOGLE_ADS_OAUTH_CLIENT_SECRET_ENV_KEY: 'GOOGLE_ADS_CLIENT_SECRET',
  GOOGLE_ADS_OAUTH_REFRESH_TOKEN_ENV_KEY: 'GOOGLE_ADS_REFRESH_TOKEN',
  GOOGLE_ADS_DEVELOPER_TOKEN_ENV_KEY: 'GOOGLE_ADS_DEVELOPER_TOKEN',
  GOOGLE_ADS_CLIENT_ID: 'client-id',
  GOOGLE_ADS_CLIENT_SECRET: 'client-secret',
  GOOGLE_ADS_REFRESH_TOKEN: 'refresh-token',
  GOOGLE_ADS_DEVELOPER_TOKEN: 'developer-token',
  GOOGLE_ADS_ALLOWED_CUSTOMER_ID: '1234567890',
  GOOGLE_ADS_ALLOWED_CURRENCY: 'BRL',
  GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS: '100000000',
  GOOGLE_ADS_CURRENCY_MINOR_UNIT_MICROS: '10000',
  GOOGLE_ADS_ALLOWED_LOCATION_CRITERION_IDS: '2076',
} satisfies NodeJS.ProcessEnv;

describe('Google Ads next-version configuration', () => {
  it('accepts OAuth refresh references without requiring a static access token', () => {
    expect(loadConfig(oauthEnv)).toMatchObject({
      GOOGLE_ADS_PHASE: 'READ_ONLY',
      GOOGLE_ADS_ACTIVATE_ENABLED: false,
      GOOGLE_ADS_OAUTH_CLIENT_ID_ENV_KEY: 'GOOGLE_ADS_CLIENT_ID',
      GOOGLE_ADS_OAUTH_CLIENT_SECRET_ENV_KEY: 'GOOGLE_ADS_CLIENT_SECRET',
      GOOGLE_ADS_OAUTH_REFRESH_TOKEN_ENV_KEY: 'GOOGLE_ADS_REFRESH_TOKEN',
    });
  });

  it('rejects simultaneous static and refresh auth modes', () => {
    expect(() =>
      loadConfig({
        ...oauthEnv,
        GOOGLE_ADS_ACCESS_TOKEN_ENV_KEY: 'GOOGLE_ADS_ACCESS_TOKEN',
        GOOGLE_ADS_ACCESS_TOKEN: 'static-access-token',
      }),
    ).toThrow('Configure exactly one Google Ads auth mode');
  });

  it('rejects partial OAuth refresh credential references', () => {
    expect(() =>
      loadConfig({
        ...oauthEnv,
        GOOGLE_ADS_OAUTH_REFRESH_TOKEN_ENV_KEY: undefined,
        GOOGLE_ADS_REFRESH_TOKEN: undefined,
      }),
    ).toThrow('Google Ads OAuth refresh credential references must be configured together');
  });

  it('keeps ACTIVATE independently disabled in runtime configuration even though MANAGE models the capability', () => {
    const manageCatalogModel = createToolRegistry({ googleAdsPhase: 'MANAGE' });
    const manageWithoutActivate = createToolRegistry({
      googleAdsPhase: 'MANAGE',
      googleAdsActivateEnabled: false,
    });
    const manageWithActivate = createToolRegistry({
      googleAdsPhase: 'MANAGE',
      googleAdsActivateEnabled: true,
    });

    expect(manageCatalogModel.get('google_ads.campaign.activate')).toBeDefined();
    expect(manageWithoutActivate.get('google_ads.campaign.activate')).toBeUndefined();
    expect(manageWithoutActivate.get('google_ads.campaign.pause')).toBeDefined();
    expect(manageWithActivate.get('google_ads.campaign.activate')).toBeDefined();
  });

  it('requires MANAGE before the independent ACTIVATE kill switch may be enabled', () => {
    expect(() =>
      loadConfig({
        ...oauthEnv,
        GOOGLE_ADS_ACTIVATE_ENABLED: 'true',
      }),
    ).toThrow('GOOGLE_ADS_ACTIVATE_ENABLED requires GOOGLE_ADS_PHASE=MANAGE');
  });
});
