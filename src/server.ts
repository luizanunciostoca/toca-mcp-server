import { McpServer } from '@modelcontextprotocol/server';
import { PostgresVideoContentRuntime } from './content/runtime.js';
import { loadConfig, type RuntimeConfig } from './config.js';
import {
  createTrustedServiceExecutionIdentity,
  resolveExecutionIdentityFromMcpContext,
  type ExecutionIdentity,
  type ExecutionIdentityResolver,
} from './core/identity.js';
import { EnvironmentSecretResolver } from './core/secrets.js';
import { registerTocaCoreSurface } from './mcp/core-surface.js';
import { createRuntimeCapabilityResolver } from './mcp/runtime-capability-resolver.js';
import { PostgresApprovalStore } from './persistence/postgres-approval-store.js';
import { PostgresAuditSink } from './persistence/postgres-audit-sink.js';
import { PostgresEventRecordStore } from './persistence/postgres-event-record-store.js';
import { PostgresMetaAdsGeoAudienceStore } from './persistence/postgres-meta-ads-geo-audience-store.js';
import { PostgresWorkflowStore } from './persistence/postgres-workflow-store.js';
import { createPostgresPool } from './persistence/postgres.js';
import { GoogleAdsRestApiClient } from './providers/google-ads/google-ads-api-client.js';
import { GoogleAdsPaidMediaProvider } from './providers/google-ads/google-ads-paid-media.js';
import { InstagramHistoryProvider } from './providers/instagram/instagram-history-provider.js';
import { MetaAdsControlledGraphProvider } from './providers/meta-ads/meta-ads-controlled-graph-provider.js';
import { MetaAdsControlledWriteService } from './providers/meta-ads/meta-ads-controlled-write.js';
import { MetaAdsDemandIntelligenceService } from './providers/meta-ads/meta-ads-demand-intelligence.js';
import { MetaAdsReadProvider } from './providers/meta-ads/meta-ads-read-provider.js';
import { MetaApiClient } from './providers/meta/meta-api-client.js';
import { createToolRegistry } from './registry.js';
import { PostgresScheduler } from './scheduler/postgres-scheduler.js';
import { TocaManagedInstagramScheduler } from './scheduler/toca-managed-instagram-scheduler.js';

export const SERVER_NAME = 'toca-mcp-server';
export const SERVER_VERSION = '0.2.0';
const TOCA_TENANT_ID = 'toca-do-morcego';

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
    description: 'Deterministic TOCA Core execution facade for ChatGPT governed by TOCA_OS.',
  });
  const secrets = new EnvironmentSecretResolver(env);
  const pool = config.DATABASE_URL
    ? createPostgresPool({ connectionString: config.DATABASE_URL })
    : undefined;
  const registry = createToolRegistry({
    instagramReadsEnabled: config.INSTAGRAM_READ_ENABLED,
    metaAdsReadsEnabled: config.META_ADS_READ_ENABLED,
    metaAdsWritesEnabled: config.META_ADS_WRITE_ENABLED,
    googleAdsPhase: config.GOOGLE_ADS_PHASE,
    tocaManagedInstagramSchedulerEnabled: config.TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED,
    videoContentRuntimeEnabled: Boolean(pool),
  });
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

  const instagramScheduler =
    config.TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED && pool
      ? new TocaManagedInstagramScheduler(new PostgresScheduler(pool))
      : undefined;
  const instagramHistory =
    config.INSTAGRAM_READ_ENABLED &&
    config.INSTAGRAM_BUSINESS_ACCOUNT_ID &&
    config.META_ACCESS_TOKEN_ENV_KEY
      ? new InstagramHistoryProvider(createMetaClient(), config.INSTAGRAM_BUSINESS_ACCOUNT_ID)
      : undefined;
  const metaAdsRead =
    config.META_ADS_READ_ENABLED && config.META_ACCESS_TOKEN_ENV_KEY
      ? new MetaAdsReadProvider(createMetaClient())
      : undefined;
  const metaAdsDemand = metaAdsRead
    ? new MetaAdsDemandIntelligenceService(
        metaAdsRead,
        pool ? new PostgresMetaAdsGeoAudienceStore(pool) : undefined,
        {
          tenantId: TOCA_TENANT_ID,
          maxRecommendationChangePercent: 20,
          ...(config.META_ADS_ALLOWED_CURRENCY && config.META_ADS_MAX_DAILY_BUDGET_MINOR
            ? {
                budgetPolicy: {
                  currency: config.META_ADS_ALLOWED_CURRENCY.toUpperCase(),
                  maxDailyBudgetMinor: config.META_ADS_MAX_DAILY_BUDGET_MINOR,
                  maxLifetimeBudgetMinor: Number.MAX_SAFE_INTEGER,
                  maxSingleIncreasePercent: 20,
                },
              }
            : {}),
        },
      )
    : undefined;

  let metaAdsWrite: MetaAdsControlledWriteService | undefined;
  let metaAdsWriteProvider: MetaAdsControlledGraphProvider | undefined;
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

    metaAdsWriteProvider = new MetaAdsControlledGraphProvider(createMetaClient());
    metaAdsWrite = new MetaAdsControlledWriteService(metaAdsWriteProvider, {
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
  }

  let googleAds: GoogleAdsPaidMediaProvider | undefined;
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
    googleAds = new GoogleAdsPaidMediaProvider(api, {
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
  }

  const videoContent = pool ? new PostgresVideoContentRuntime(pool) : undefined;

  const runtimeResolver = createRuntimeCapabilityResolver({
    ...(instagramHistory ? { instagramHistory } : {}),
    ...(metaAdsRead ? { metaAdsRead } : {}),
    ...(metaAdsDemand ? { metaAdsDemand } : {}),
    ...(metaAdsWrite ? { metaAdsWrite } : {}),
    ...(metaAdsWriteProvider ? { metaAdsWriteProvider } : {}),
    ...(googleAds ? { googleAds } : {}),
    ...(googleAds && config.GOOGLE_ADS_ALLOWED_CUSTOMER_ID
      ? { googleAdsTargetAccount: config.GOOGLE_ADS_ALLOWED_CUSTOMER_ID.replaceAll('-', '') }
      : {}),
    ...(googleAds && config.GOOGLE_ADS_ALLOWED_CURRENCY
      ? { googleAdsCurrency: config.GOOGLE_ADS_ALLOWED_CURRENCY.toUpperCase() }
      : {}),
    ...(instagramScheduler ? { instagramScheduler } : {}),
    ...(videoContent ? { videoContent } : {}),
  });

  registerTocaCoreSurface(server, {
    serviceName: SERVER_NAME,
    serviceVersion: SERVER_VERSION,
    registry,
    runtimeResolver,
    resolveIdentity,
    ...(pool
      ? {
          workflowStore: new PostgresWorkflowStore(pool),
          approvalStore: new PostgresApprovalStore(pool),
          auditStore: new PostgresAuditSink(pool, registry),
          eventStore: new PostgresEventRecordStore(pool),
        }
      : {}),
  });

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
