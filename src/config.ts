import * as z from 'zod/v4';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TOCA_OS_MEDIA_SPREADSHEET_ID: z.string().trim().min(1).optional(),
  GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY: z.string().trim().min(1).optional(),
});

export type RuntimeConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const config = configSchema.parse(env);
  const hasSpreadsheet = config.TOCA_OS_MEDIA_SPREADSHEET_ID !== undefined;
  const hasTokenReference = config.GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY !== undefined;

  if (hasSpreadsheet !== hasTokenReference) {
    throw new Error(
      'TOCA_OS_MEDIA_SPREADSHEET_ID and GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY must be configured together',
    );
  }

  if (config.GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY) {
    const secretValue = env[config.GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY];
    if (!secretValue?.trim()) {
      throw new Error(
        `Missing environment secret referenced by GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY: ${config.GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY}`,
      );
    }
  }

  return config;
}
