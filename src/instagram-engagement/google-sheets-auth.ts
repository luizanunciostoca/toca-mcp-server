import { EnvSecretResolver, type SecretReference, type SecretResolver } from '../core/secrets.js';
import {
  GOOGLE_WORKSPACE_SCOPED_TOKEN_PROVIDER,
  GcpGoogleWorkspaceTokenResolver,
} from '../providers/gcp/google-workspace-token-resolver.js';

export type InstagramEngagementGoogleSheetsAuthMode = 'env' | 'gcp-iam';

export interface InstagramEngagementGoogleSheetsAuth {
  readonly resolver: SecretResolver;
  readonly tokenReference: SecretReference;
  readonly mode: InstagramEngagementGoogleSheetsAuthMode;
}

export function createInstagramEngagementGoogleSheetsAuth(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): InstagramEngagementGoogleSheetsAuth {
  const rawMode = env.INSTAGRAM_ENGAGEMENT_GOOGLE_SHEETS_AUTH_MODE?.trim().toLowerCase() || 'env';
  if (rawMode === 'env') {
    const key = required(env, 'INSTAGRAM_ENGAGEMENT_GOOGLE_SHEETS_TOKEN_ENV_KEY');
    return {
      resolver: new EnvSecretResolver(env, 'env'),
      tokenReference: { provider: 'env', key },
      mode: 'env',
    };
  }
  if (rawMode === 'gcp-iam') {
    const serviceAccountEmail = required(env, 'INSTAGRAM_ENGAGEMENT_GOOGLE_SERVICE_ACCOUNT_EMAIL');
    return {
      resolver: new GcpGoogleWorkspaceTokenResolver({ serviceAccountEmail, fetchImpl }),
      tokenReference: {
        provider: GOOGLE_WORKSPACE_SCOPED_TOKEN_PROVIDER,
        key: 'sheets-readonly',
      },
      mode: 'gcp-iam',
    };
  }
  throw new Error('INSTAGRAM_ENGAGEMENT_GOOGLE_SHEETS_AUTH_MODE_INVALID');
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key}_REQUIRED`);
  return value;
}
