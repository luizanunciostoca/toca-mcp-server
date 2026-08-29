import { describe, expect, it } from 'vitest';
import { createInstagramEngagementGoogleSheetsAuth } from '../src/instagram-engagement/google-sheets-auth.js';
import { GOOGLE_WORKSPACE_SCOPED_TOKEN_PROVIDER } from '../src/providers/gcp/google-workspace-token-resolver.js';

describe('Instagram engagement Google Sheets auth', () => {
  it('keeps env auth available for local and test usage', async () => {
    const env = {
      INSTAGRAM_ENGAGEMENT_GOOGLE_SHEETS_AUTH_MODE: 'env',
      INSTAGRAM_ENGAGEMENT_GOOGLE_SHEETS_TOKEN_ENV_KEY: 'SHEETS_TOKEN',
      SHEETS_TOKEN: 'local-token',
    } as NodeJS.ProcessEnv;
    const auth = createInstagramEngagementGoogleSheetsAuth(env);

    expect(auth.mode).toBe('env');
    expect(auth.tokenReference).toEqual({ provider: 'env', key: 'SHEETS_TOKEN' });
    await expect(auth.resolver.resolve(auth.tokenReference)).resolves.toBe('local-token');
  });

  it('uses GCP IAM scoped tokens without requiring a static Sheets token', () => {
    const env = {
      INSTAGRAM_ENGAGEMENT_GOOGLE_SHEETS_AUTH_MODE: 'gcp-iam',
      INSTAGRAM_ENGAGEMENT_GOOGLE_SERVICE_ACCOUNT_EMAIL: 'runtime@example.iam.gserviceaccount.com',
    } as NodeJS.ProcessEnv;
    const auth = createInstagramEngagementGoogleSheetsAuth(env);

    expect(auth.mode).toBe('gcp-iam');
    expect(auth.tokenReference.provider).toBe(GOOGLE_WORKSPACE_SCOPED_TOKEN_PROVIDER);
  });

  it('fails closed for an unsupported mode', () => {
    expect(() =>
      createInstagramEngagementGoogleSheetsAuth({
        INSTAGRAM_ENGAGEMENT_GOOGLE_SHEETS_AUTH_MODE: 'public',
      }),
    ).toThrow('INSTAGRAM_ENGAGEMENT_GOOGLE_SHEETS_AUTH_MODE_INVALID');
  });
});
