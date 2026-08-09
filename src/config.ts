import * as z from 'zod/v4';

const booleanFromEnv = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    META_ENABLED: booleanFromEnv,
    META_APP_ID: z.string().min(1).optional(),
    META_APP_SECRET_PROVIDER: z.string().min(1).optional(),
    META_APP_SECRET_KEY: z.string().min(1).optional(),
    META_AUTHORIZATION_ENDPOINT: z.string().url().optional(),
    META_TOKEN_ENDPOINT: z.string().url().optional(),
    META_REDIRECT_URI: z.string().url().optional(),
    META_REQUESTED_SCOPES: z.string().min(1).optional(),
    META_GRAPH_BASE_URL: z.string().url().optional(),
    META_GRAPH_API_VERSION: z.string().min(1).optional(),
  })
  .superRefine((config, context) => {
    if (!config.META_ENABLED) return;

    const required = [
      'META_APP_ID',
      'META_APP_SECRET_PROVIDER',
      'META_APP_SECRET_KEY',
      'META_AUTHORIZATION_ENDPOINT',
      'META_TOKEN_ENDPOINT',
      'META_REDIRECT_URI',
      'META_REQUESTED_SCOPES',
      'META_GRAPH_BASE_URL',
      'META_GRAPH_API_VERSION',
    ] as const;

    for (const field of required) {
      if (!config[field]) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} is required when META_ENABLED=true`,
        });
      }
    }
  });

export type RuntimeConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return configSchema.parse(env);
}
