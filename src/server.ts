import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { loadConfig, type RuntimeConfig } from './config.js';
import {
  createTrustedServiceExecutionIdentity,
  resolveExecutionIdentityFromMcpContext,
  type ExecutionIdentity,
  type ExecutionIdentityResolver,
} from './core/identity.js';
import { EnvironmentSecretResolver } from './core/secrets.js';
import { PostgresApprovalStore } from './persistence/postgres-approval-store.js';
import { PostgresAuditSink } from './persistence/postgres-audit-sink.js';
import { createPostgresPool } from './persistence/postgres.js';
import { GoogleAdsRestApiClient } from './providers/google-ads/google-ads-api-client.js';
import { GoogleAdsPaidMediaProvider } from './providers/google-ads/google-ads-paid-media.js';
import { InstagramHistoryProvider } from './providers/instagram/instagram-history-provider.js';
import { MetaAdsControlledGraphProvider } from './providers/meta-ads/meta-ads-controlled-graph-provider.js';
import { MetaAdsControlledWriteService } from './providers/meta-ads/meta-ads-controlled-write.js';
import { MetaAdsReadProvider } from './providers/meta-ads/meta-ads-read-provider.js';
import { MetaApiClient } from './providers/meta/meta-api-client.js';
import { createToolRegistry } from './registry.js';
import { PostgresScheduler } from './scheduler/postgres-scheduler.js';
import { TocaManagedInstagramScheduler } from './scheduler/toca-managed-instagram-scheduler.js';
import { registerGoogleAdsTools } from './tools/register-google-ads.js';
import { registerInstagramHistoryTools } from './tools/register-instagram-history.js';
import { registerInstagramManagedSchedulerTools } from './tools/register-instagram-managed-scheduler.js';
import { registerMetaAdsReadTools } from './tools/register-meta-ads-read.js';
import { registerMetaAdsWriteTools } from './tools/register-meta-ads-write.js';

export const SERVER_NAME = 'toca-mcp-server';
export const SERVER_VERSION = '0.2.0';
const TOCA_TENANT_ID = 'toca-do-morcego';

const capabilityStatusSchema = z.enum([
  'PLANNED',
  'SPECIFIED',
  'IMPLEMENTED',
  'CONNECTED',
  'INTEGRATION_VALIDATED',
  'PRODUCTION_VALIDATED',
  'DEGRADED',
  'DISABLED',
  'BLOCKED',
  'SUSPENDED',
  'DEPRECATED',
  'RETIRED',
  'REMOVED',
]);

const riskClassSchema = z.enum([
  'READ',
  'WRITE_REVERSIBLE',
  'WRITE_EXTERNAL',
  'FINANCIAL_IMPACT',
  'DESTRUCTIVE',
]);

export interface TocaServerOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly executionIdentity?: ExecutionIdentity;
}

export function createTocaServer(options: TocaServerOptions = {}): McpServer {
  const env = options.env ?? process.env;
  const config = loadConfig(env);
  const fallbackIdentity = options.executionIdentity ?? runtimeServiceIdentity(env, config);
  const resolveIdentity: ExecutionIdentityResolver = (context) =>
    resolveExecutionIdentityFromMcpContext(context, {
      tenantId: TOCA_TENANT_ID,
      ...(fallbackIdentity ? { fallbackIdentity } : {}),
    });

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    description: 'Deterministic execution tools for ChatGPT governed by TOCA_OS.',
  });
  const registry = createToolRegistry({
    instagramReadsEnabled: config.INSTAGRAM_READ_ENABLED,
    metaAdsReadsEnabled: config.META_ADS_READ_ENABLED,
    metaAdsWritesEnabled: config.META_ADS_WRITE_ENABLED,
    googleAdsPhase: config.GOOGLE_ADS_PHASE,
    tocaManagedInstagramSchedulerEnabled: config.TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED,
  });

  server.registerTool(
    'system.health',
    {
      title: 'TOCA MCP Health',
      description:
        'Return the health and active production-foundation state of the TOCA MCP server.',
      inputSchema: z.object({}),
      outputSchema: z.object({
        status: z.literal('ok'),
        service: z.string(),
        version: z.string(),
        phase: z.literal('production-foundation'),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    () => {
      const output = {
        status: 'ok' as const,
        service: SERVER_NAME,
        version: SERVER_VERSION,
        phase: 'production-foundation' as const,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    'system.capabilities',
    {
      title: 'TOCA MCP Capabilities',
      description:
        'List deterministic execution tools registered in this runtime and their declared lifecycle status. Provider connectivity still requires environment/provider evidence.',
      inputSchema: z.object({}),
      outputSchema: z.object({
        tools: z.array(
          z.object({
            name: z.string(),
            version: z.string(),
            provider: z.string(),
            riskClass: riskClassSchema,
            requiredScopes: z.array(z.string()),
            capabilityStatus: capabilityStatusSchema,
            sideEffects: z.boolean(),
            idempotent: z.boolean(),
          }),
        ),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    () => {
      const output = {
        tools: registry.list().map((tool) => ({
          ...tool,
          requiredScopes: [...tool.requiredScopes],
        })),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  const secrets = new EnvironmentSecretResolver(env);
  const pool = config.DATABASE_URL
    ? createPostgresPool({ connectionString: config.DATABASE_URL })
    : undefined;
  const createMetaClient = () => {
    if (!config.META_ACCESS_TOKEN_ENV_KEY) {
      throw new Error('META_ACCESS_TOKEN_ENV_KEY_REQUIRED');
    }
    return new MetaApiClient(
      {
        graphBaseUrl: config.META_GRAPH_BASE_URL,
        apiVersion: config.META_GRAPH_API_VERSION,
      },
      secrets,
      { provider: 'env', key: config.META_ACCESS_TOKEN_ENV_KEY },
    );
  };

  if (config.TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED && pool) {
    const scheduler = new TocaManagedInstagramScheduler(new PostgresScheduler(pool));
    registerInstagramManagedSchedulerTools(server, scheduler, {
      registry,
      auditSink: new PostgresAuditSink(pool, registry),
      resolveIdentity,
    });
  }

  if (
    config.INSTAGRAM_READ_ENABLED &&
    config.INSTAGRAM_BUSINESS_ACCOUNT_ID &&
    config.META_ACCESS_TOKEN_ENV_KEY
  ) {
    const provider = new InstagramHistoryProvider(
      createMetaClient(),
      config.INSTAGRAM_BUSINESS_ACCOUNT_ID,
    );
    registerInstagramHistoryTools(server, provider);
  }

  if (config.META_ADS_READ_ENABLED && config.META_ACCESS_TOKEN_ENV_KEY) {
    registerMetaAdsReadTools(server, new MetaAdsReadProvider(createMetaClient()));
  }

  if (config.META_ADS_WRITE_ENABLED && config.META_ACCESS_TOKEN_ENV_KEY && pool) {
    const {
      META_ADS_ALLOWED_ACCOUNT_ID: allowedAccountId,
      META_ADS_ALLOWED_CURRENCY: allowedCurrency,
      META_ADS_MAX_DAILY_BUDGET_MINOR: maxDailyBudgetMinor,
      META_ADS_ALLOWED_GEO_KEYS: allowedGeoKeysRaw,
      META_ADS_ALLOWED_PIXEL_ID: allowedPixelId,
      META_ADS_ALLOWED_PAGE_ID: allowedPageId,
      META_ADS_ALLOWED_INSTAGRAM_ACTOR_ID: allowedInstagramActorId,
      META_ADS_APPROVED_REQUEST_SHA256: approvedRequestSha256,
    } = config;
    if (
      !allowedAccountId ||
      !allowedCurrency ||
      !maxDailyBudgetMinor ||
      !allowedGeoKeysRaw ||
      !allowedPixelId ||
      !allowedPageId ||
      !allowedInstagramActorId ||
      !approvedRequestSha256
    ) {
      throw new Error('META_ADS_WRITE_GUARDRAILS_REQUIRED');
    }

    const provider = new MetaAdsControlledGraphProvider(createMetaClient());
    const service = new MetaAdsControlledWriteService(provider, {
      allowedAccountId,
      allowedCurrency,
      maxDailyBudgetMinor,
      allowedGeoKeys: allowedGeoKeysRaw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      allowedPixelId,
      allowedPageId,
      allowedInstagramActorId,
      approvedRequestSha256,
    });
    registerMetaAdsWriteTools(server, service, {
      registry,
      auditSink: new PostgresAuditSink(pool, registry),
      resolveIdentity,
    });
  }

  if (config.GOOGLE_ADS_PHASE !== 'OFF') {
    const {
      GOOGLE_ADS_CUSTOMER_ID: customerId,
      GOOGLE_ADS_LOGIN_CUSTOMER_ID: loginCustomerId,
      GOOGLE_ADS_ACCESS_TOKEN_ENV_KEY: accessTokenEnvKey,
      GOOGLE_ADS_DEVELOPER_TOKEN_ENV_KEY: developerTokenEnvKey,
      GOOGLE_ADS_ALLOWED_CUSTOMER_ID: allowedCustomerId,
      GOOGLE_ADS_ALLOWED_CURRENCY: allowedCurrency,
      GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS: maxDailyBudgetMicros,
      GOOGLE_ADS_CURRENCY_MINOR_UNIT_MICROS: currencyMinorUnitMicros,
      GOOGLE_ADS_ALLOWED_LOCATION_CRITERION_IDS: allowedLocationIdsRaw,
      GOOGLE_ADS_ALLOWED_LANGUAGE_CRITERION_IDS: allowedLanguageIdsRaw,
    } = config;
    if (
      !customerId ||
      !accessTokenEnvKey ||
      !developerTokenEnvKey ||
      !allowedCustomerId ||
      !allowedCurrency ||
      !maxDailyBudgetMicros ||
      !currencyMinorUnitMicros ||
      !allowedLocationIdsRaw
    ) {
      throw new Error('GOOGLE_ADS_RUNTIME_GUARDRAILS_REQUIRED');
    }

    const api = new GoogleAdsRestApiClient(
      {
        apiVersion: config.GOOGLE_ADS_API_VERSION,
        customerId,
        ...(loginCustomerId ? { loginCustomerId } : {}),
        accessTokenRef: { provider: 'env', key: accessTokenEnvKey },
        developerTokenRef: { provider: 'env', key: developerTokenEnvKey },
      },
      secrets,
    );
    const provider = new GoogleAdsPaidMediaProvider(api, {
      allowedCustomerId,
      allowedCurrency,
      maxDailyBudgetMicros,
      currencyMinorUnitMicros,
      allowedLocationCriterionIds: csvValues(allowedLocationIdsRaw),
      ...(allowedLanguageIdsRaw
        ? { allowedLanguageCriterionIds: csvValues(allowedLanguageIdsRaw) }
        : {}),
      allowedAdvertisingChannelTypes: ['SEARCH'],
    });
    const execution = pool
      ? {
          registry,
          auditSink: new PostgresAuditSink(pool, registry),
          approvalStore: new PostgresApprovalStore(pool),
          resolveIdentity,
          customerId: allowedCustomerId,
          currencyCode: allowedCurrency.toUpperCase(),
        }
      : undefined;
    registerGoogleAdsTools(server, provider, config.GOOGLE_ADS_PHASE, execution);
  }

  return server;
}

function csvValues(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function runtimeServiceIdentity(
  env: NodeJS.ProcessEnv,
  config: RuntimeConfig,
): ExecutionIdentity | undefined {
  const cloudRunService = env.K_SERVICE?.trim();
  if (config.NODE_ENV !== 'production' || !config.MCP_ENABLED || !cloudRunService) return undefined;

  return createTrustedServiceExecutionIdentity({
    principalId: `cloud-run-service:${cloudRunService}`,
    tenantId: TOCA_TENANT_ID,
    roles: ['OPERATOR'],
    allowedCapabilityIds: [
      'instagram.toca_schedule.create',
      'instagram.toca_schedule.reschedule',
      'instagram.toca_schedule.cancel',
    ],
    allowedTargetAccounts: [],
    evidence: [
      `runtime:cloud-run:${cloudRunService}`,
      'deployment-contract:cloud-run-authenticated-boundary',
    ],
  });
}
