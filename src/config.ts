import * as z from 'zod/v4';
import { googleAdsPhaseAtLeast } from './providers/google-ads/google-ads-phase.js';

const booleanFromEnv = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const enabledByDefaultFromEnv = z
  .enum(['true', 'false'])
  .default('true')
  .transform((value) => value === 'true');

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    MCP_ENABLED: enabledByDefaultFromEnv,
    DATABASE_URL: z.string().min(1).optional(),
    TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED: booleanFromEnv,
    TOCA_MANAGED_INSTAGRAM_EXECUTOR_ENABLED: booleanFromEnv,
    INSTAGRAM_PUBLICATION_ASSET_BUCKET: z.string().trim().min(1).optional(),
    TOCA_OS_MEDIA_SPREADSHEET_ID: z.string().trim().min(1).optional(),
    GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY: z.string().trim().min(1).optional(),
    INSTAGRAM_READ_ENABLED: booleanFromEnv,
    META_ADS_READ_ENABLED: booleanFromEnv,
    META_ADS_WRITE_ENABLED: booleanFromEnv,
    META_ADS_ALLOWED_ACCOUNT_ID: z.string().trim().min(1).optional(),
    META_ADS_ALLOWED_CURRENCY: z.string().trim().length(3).optional(),
    META_ADS_MAX_DAILY_BUDGET_MINOR: z.coerce.number().int().positive().optional(),
    META_ADS_ALLOWED_GEO_KEYS: z.string().trim().min(1).optional(),
    META_ADS_ALLOWED_PIXEL_ID: z.string().trim().min(1).optional(),
    META_ADS_ALLOWED_PAGE_ID: z.string().trim().min(1).optional(),
    META_ADS_ALLOWED_INSTAGRAM_ACTOR_ID: z.string().trim().min(1).optional(),
    META_ADS_APPROVED_REQUEST_SHA256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    GOOGLE_ADS_PHASE: z
      .enum(['OFF', 'READ_ONLY', 'PREPARE', 'CREATE_PAUSED', 'READBACK', 'MANAGE'])
      .default('OFF'),
    GOOGLE_ADS_API_VERSION: z
      .string()
      .trim()
      .regex(/^v\d+$/)
      .default('v25'),
    GOOGLE_ADS_CUSTOMER_ID: z
      .string()
      .trim()
      .regex(/^\d{3}-?\d{3}-?\d{4}$/)
      .optional(),
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: z
      .string()
      .trim()
      .regex(/^\d{3}-?\d{3}-?\d{4}$/)
      .optional(),
    GOOGLE_ADS_ACCESS_TOKEN_ENV_KEY: z.string().trim().min(1).optional(),
    GOOGLE_ADS_DEVELOPER_TOKEN_ENV_KEY: z.string().trim().min(1).optional(),
    GOOGLE_ADS_ALLOWED_CUSTOMER_ID: z
      .string()
      .trim()
      .regex(/^\d{3}-?\d{3}-?\d{4}$/)
      .optional(),
    GOOGLE_ADS_ALLOWED_CURRENCY: z.string().trim().length(3).optional(),
    GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS: z.coerce.number().int().positive().optional(),
    GOOGLE_ADS_CURRENCY_MINOR_UNIT_MICROS: z.coerce.number().int().positive().optional(),
    GOOGLE_ADS_ALLOWED_LOCATION_CRITERION_IDS: z.string().trim().min(1).optional(),
    GOOGLE_ADS_ALLOWED_LANGUAGE_CRITERION_IDS: z.string().trim().min(1).optional(),
    INSTAGRAM_BUSINESS_ACCOUNT_ID: z.string().trim().min(1).optional(),
    META_ACCESS_TOKEN_ENV_KEY: z.string().trim().min(1).optional(),
    META_ENABLED: booleanFromEnv,
    META_WEBHOOK_ENABLED: booleanFromEnv,
    META_WEBHOOK_PERSISTENCE_ENABLED: booleanFromEnv,
    INSTAGRAM_ENGAGEMENT_WRITES_ENABLED: booleanFromEnv,
    INSTAGRAM_PUBLICATION_WRITES_ENABLED: booleanFromEnv,
    INSTAGRAM_PUBLICATION_APPROVED_REQUEST_SHA256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    META_APP_ID: z.string().min(1).optional(),
    META_APP_SECRET_PROVIDER: z.string().min(1).optional(),
    META_APP_SECRET_KEY: z.string().min(1).optional(),
    META_WEBHOOK_VERIFY_TOKEN_KEY: z.string().min(1).optional(),
    META_AUTHORIZATION_ENDPOINT: z.string().url().optional(),
    META_TOKEN_ENDPOINT: z.string().url().optional(),
    META_REDIRECT_URI: z.string().url().optional(),
    META_REQUESTED_SCOPES: z.string().min(1).optional(),
    META_GRAPH_BASE_URL: z.string().url().default('https://graph.facebook.com'),
    META_GRAPH_API_VERSION: z.string().min(1).default('v24.0'),
    META_TOKEN_STORE_PROVIDER: z.enum(['memory', 'gcp-secret-manager']).default('memory'),
    META_TOKEN_SECRET_ID: z.string().min(1).optional(),
    GCP_PROJECT_ID: z.string().min(1).optional(),
  })
  .superRefine((config, context) => {
    if (config.TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED && !config.DATABASE_URL) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required when TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED=true',
      });
    }

    if (
      config.TOCA_MANAGED_INSTAGRAM_EXECUTOR_ENABLED &&
      !config.TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED
    ) {
      context.addIssue({
        code: 'custom',
        path: ['TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED'],
        message:
          'TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED must be true when TOCA_MANAGED_INSTAGRAM_EXECUTOR_ENABLED=true',
      });
    }

    if (config.TOCA_MANAGED_INSTAGRAM_EXECUTOR_ENABLED && !config.META_ENABLED) {
      context.addIssue({
        code: 'custom',
        path: ['META_ENABLED'],
        message: 'META_ENABLED must be true when TOCA_MANAGED_INSTAGRAM_EXECUTOR_ENABLED=true',
      });
    }

    if (
      config.TOCA_MANAGED_INSTAGRAM_EXECUTOR_ENABLED &&
      config.META_TOKEN_STORE_PROVIDER !== 'gcp-secret-manager'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['META_TOKEN_STORE_PROVIDER'],
        message:
          'META_TOKEN_STORE_PROVIDER must be gcp-secret-manager when TOCA_MANAGED_INSTAGRAM_EXECUTOR_ENABLED=true',
      });
    }

    if (
      config.TOCA_MANAGED_INSTAGRAM_EXECUTOR_ENABLED &&
      !config.INSTAGRAM_PUBLICATION_ASSET_BUCKET
    ) {
      context.addIssue({
        code: 'custom',
        path: ['INSTAGRAM_PUBLICATION_ASSET_BUCKET'],
        message:
          'INSTAGRAM_PUBLICATION_ASSET_BUCKET is required when TOCA_MANAGED_INSTAGRAM_EXECUTOR_ENABLED=true',
      });
    }

    if (config.META_ADS_WRITE_ENABLED) {
      if (!config.META_ENABLED) {
        context.addIssue({
          code: 'custom',
          path: ['META_ENABLED'],
          message: 'META_ENABLED must be true when META_ADS_WRITE_ENABLED=true',
        });
      }
      if (!config.DATABASE_URL) {
        context.addIssue({
          code: 'custom',
          path: ['DATABASE_URL'],
          message: 'DATABASE_URL is required when META_ADS_WRITE_ENABLED=true for persistent audit',
        });
      }
      const requiredWriteFields = [
        'META_ADS_ALLOWED_ACCOUNT_ID',
        'META_ADS_ALLOWED_CURRENCY',
        'META_ADS_MAX_DAILY_BUDGET_MINOR',
        'META_ADS_ALLOWED_GEO_KEYS',
        'META_ADS_ALLOWED_PIXEL_ID',
        'META_ADS_ALLOWED_PAGE_ID',
        'META_ADS_ALLOWED_INSTAGRAM_ACTOR_ID',
        'META_ADS_APPROVED_REQUEST_SHA256',
        'META_ACCESS_TOKEN_ENV_KEY',
      ] as const;
      for (const field of requiredWriteFields) {
        if (!config[field]) {
          context.addIssue({
            code: 'custom',
            path: [field],
            message: `${field} is required when META_ADS_WRITE_ENABLED=true`,
          });
        }
      }
    }

    if (config.GOOGLE_ADS_PHASE !== 'OFF') {
      const requiredGoogleAdsFields = [
        'GOOGLE_ADS_CUSTOMER_ID',
        'GOOGLE_ADS_ACCESS_TOKEN_ENV_KEY',
        'GOOGLE_ADS_DEVELOPER_TOKEN_ENV_KEY',
        'GOOGLE_ADS_ALLOWED_CUSTOMER_ID',
        'GOOGLE_ADS_ALLOWED_CURRENCY',
        'GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS',
        'GOOGLE_ADS_CURRENCY_MINOR_UNIT_MICROS',
        'GOOGLE_ADS_ALLOWED_LOCATION_CRITERION_IDS',
      ] as const;
      for (const field of requiredGoogleAdsFields) {
        if (!config[field]) {
          context.addIssue({
            code: 'custom',
            path: [field],
            message: `${field} is required when GOOGLE_ADS_PHASE is not OFF`,
          });
        }
      }
      if (
        config.GOOGLE_ADS_CUSTOMER_ID &&
        config.GOOGLE_ADS_ALLOWED_CUSTOMER_ID &&
        normalizeGoogleAdsCustomerId(config.GOOGLE_ADS_CUSTOMER_ID) !==
          normalizeGoogleAdsCustomerId(config.GOOGLE_ADS_ALLOWED_CUSTOMER_ID)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['GOOGLE_ADS_ALLOWED_CUSTOMER_ID'],
          message: 'GOOGLE_ADS_ALLOWED_CUSTOMER_ID must match GOOGLE_ADS_CUSTOMER_ID',
        });
      }
      if (
        config.GOOGLE_ADS_CURRENCY_MINOR_UNIT_MICROS &&
        1_000_000 % config.GOOGLE_ADS_CURRENCY_MINOR_UNIT_MICROS !== 0
      ) {
        context.addIssue({
          code: 'custom',
          path: ['GOOGLE_ADS_CURRENCY_MINOR_UNIT_MICROS'],
          message: 'GOOGLE_ADS_CURRENCY_MINOR_UNIT_MICROS must divide 1,000,000 exactly',
        });
      }
      if (googleAdsPhaseAtLeast(config.GOOGLE_ADS_PHASE, 'CREATE_PAUSED') && !config.DATABASE_URL) {
        context.addIssue({
          code: 'custom',
          path: ['DATABASE_URL'],
          message: 'DATABASE_URL is required from GOOGLE_ADS_PHASE=CREATE_PAUSED onward',
        });
      }
    }

    if (config.META_WEBHOOK_ENABLED && !config.META_ENABLED) {
      context.addIssue({
        code: 'custom',
        path: ['META_WEBHOOK_ENABLED'],
        message: 'META_ENABLED must be true when META_WEBHOOK_ENABLED=true',
      });
    }

    if (config.META_WEBHOOK_PERSISTENCE_ENABLED && !config.META_WEBHOOK_ENABLED) {
      context.addIssue({
        code: 'custom',
        path: ['META_WEBHOOK_PERSISTENCE_ENABLED'],
        message: 'META_WEBHOOK_ENABLED must be true when META_WEBHOOK_PERSISTENCE_ENABLED=true',
      });
    }

    if (config.META_WEBHOOK_PERSISTENCE_ENABLED && !config.DATABASE_URL) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required when META_WEBHOOK_PERSISTENCE_ENABLED=true',
      });
    }

    if (config.INSTAGRAM_ENGAGEMENT_WRITES_ENABLED && !config.META_ENABLED) {
      context.addIssue({
        code: 'custom',
        path: ['INSTAGRAM_ENGAGEMENT_WRITES_ENABLED'],
        message: 'META_ENABLED must be true when INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true',
      });
    }

    if (config.INSTAGRAM_PUBLICATION_WRITES_ENABLED && !config.META_ENABLED) {
      context.addIssue({
        code: 'custom',
        path: ['INSTAGRAM_PUBLICATION_WRITES_ENABLED'],
        message: 'META_ENABLED must be true when INSTAGRAM_PUBLICATION_WRITES_ENABLED=true',
      });
    }

    if (config.INSTAGRAM_PUBLICATION_WRITES_ENABLED && !config.DATABASE_URL) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required when INSTAGRAM_PUBLICATION_WRITES_ENABLED=true',
      });
    }

    if (
      config.INSTAGRAM_PUBLICATION_WRITES_ENABLED &&
      config.META_TOKEN_STORE_PROVIDER !== 'gcp-secret-manager'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['META_TOKEN_STORE_PROVIDER'],
        message:
          'META_TOKEN_STORE_PROVIDER must be gcp-secret-manager when INSTAGRAM_PUBLICATION_WRITES_ENABLED=true',
      });
    }

    if (
      config.INSTAGRAM_PUBLICATION_WRITES_ENABLED &&
      !config.INSTAGRAM_PUBLICATION_APPROVED_REQUEST_SHA256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['INSTAGRAM_PUBLICATION_APPROVED_REQUEST_SHA256'],
        message:
          'INSTAGRAM_PUBLICATION_APPROVED_REQUEST_SHA256 is required when INSTAGRAM_PUBLICATION_WRITES_ENABLED=true',
      });
    }

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

    if (config.META_WEBHOOK_ENABLED && !config.META_WEBHOOK_VERIFY_TOKEN_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['META_WEBHOOK_VERIFY_TOKEN_KEY'],
        message: 'META_WEBHOOK_VERIFY_TOKEN_KEY is required when META_WEBHOOK_ENABLED=true',
      });
    }

    if (config.META_TOKEN_STORE_PROVIDER === 'gcp-secret-manager') {
      if (!config.GCP_PROJECT_ID) {
        context.addIssue({
          code: 'custom',
          path: ['GCP_PROJECT_ID'],
          message: 'GCP_PROJECT_ID is required when META_TOKEN_STORE_PROVIDER=gcp-secret-manager',
        });
      }
      if (!config.META_TOKEN_SECRET_ID) {
        context.addIssue({
          code: 'custom',
          path: ['META_TOKEN_SECRET_ID'],
          message:
            'META_TOKEN_SECRET_ID is required when META_TOKEN_STORE_PROVIDER=gcp-secret-manager',
        });
      }
    }
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
    assertReferencedSecret(
      env,
      config.GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY,
      'GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY',
    );
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

  if (config.META_ADS_READ_ENABLED || config.META_ADS_WRITE_ENABLED) {
    if (!config.META_ACCESS_TOKEN_ENV_KEY) {
      throw new Error(
        'META_ACCESS_TOKEN_ENV_KEY is required when Meta Ads provider access is enabled',
      );
    }
    assertReferencedSecret(env, config.META_ACCESS_TOKEN_ENV_KEY, 'META_ACCESS_TOKEN_ENV_KEY');
  }

  if (config.GOOGLE_ADS_PHASE !== 'OFF') {
    if (!config.GOOGLE_ADS_ACCESS_TOKEN_ENV_KEY || !config.GOOGLE_ADS_DEVELOPER_TOKEN_ENV_KEY) {
      throw new Error('Google Ads secret references are required when GOOGLE_ADS_PHASE is not OFF');
    }
    assertReferencedSecret(
      env,
      config.GOOGLE_ADS_ACCESS_TOKEN_ENV_KEY,
      'GOOGLE_ADS_ACCESS_TOKEN_ENV_KEY',
    );
    assertReferencedSecret(
      env,
      config.GOOGLE_ADS_DEVELOPER_TOKEN_ENV_KEY,
      'GOOGLE_ADS_DEVELOPER_TOKEN_ENV_KEY',
    );
  }

  return config;
}

function normalizeGoogleAdsCustomerId(value: string): string {
  return value.replaceAll('-', '');
}

function assertReferencedSecret(env: NodeJS.ProcessEnv, key: string, source: string): void {
  const secretValue = env[key];
  if (!secretValue?.trim()) {
    throw new Error(`Missing environment secret referenced by ${source}: ${key}`);
  }
}
