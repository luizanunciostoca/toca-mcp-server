import * as z from 'zod/v4';

const booleanFromEnv = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TOCA_OS_MEDIA_SPREADSHEET_ID: z.string().trim().min(1).optional(),
  GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY: z.string().trim().min(1).optional(),
  INSTAGRAM_READ_ENABLED: booleanFromEnv,
  INSTAGRAM_BUSINESS_ACCOUNT_ID: z.string().trim().min(1).optional(),
  META_GRAPH_BASE_URL: z.string().url().default('https://graph.facebook.com'),
  META_GRAPH_API_VERSION: z.string().trim().min(1).default('v24.0'),
  META_ACCESS_TOKEN_ENV_KEY: z.string().trim().min(1).optional(),
});

export type RuntimeConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const config = configSchema.parse(env);
  const hasSpreadsheet = config.TOCA_OS_MEDIA_SPREADSHEET_ID !== undefined;
  const hasGoogleTokenReference = config.GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY !== undefined;

  if (hasSpreadsheet !== hasGoogleTokenReference) {
    throw new Error(
      'TOCA_OS_MEDIA_SPREADSHEET_ID and GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY must be configured together',
    );
  }

  if (config.GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY) {
    assertReferencedSecret(env, config.GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY, 'GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY');
  }

  if (config.INSTAGRAM_READ_ENABLED) {
    if (!config.INSTAGRAM_BUSINESS_ACCOUNT_ID) {
      throw new Error('INSTAGRAM_BUSINESS_ACCOUNT_ID is required when INSTAGRAM_READ_ENABLED=true');
    }
    if (!config.META_ACCESS_TOKEN_ENV_KEY) {
      throw new Error('META_ACCESS_TOKEN_ENV_KEY is required when INSTAGRAM_READ_ENABLED=true');
    }
    assertReferencedSecret(env, config.META_ACCESS_TOKEN_ENV_KEY, 'META_ACCESS_TOKEN_ENV_KEY');
  }

  return config;
}

function assertReferencedSecret(env: NodeJS.ProcessEnv, key: string, source: string): void {
  const secretValue = env[key];
  if (!secretValue?.trim()) {
    throw new Error(`Missing environment secret referenced by ${source}: ${key}`);
  }
}
