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
import { registerTocaControlCenterSurface } from './mcp/control-center-surface.js';
import type { InstagramCorePublicationRuntime } from './mcp/instagram-publication-runtime.js';
import { registerTocaCoreSurface } from './mcp/core-surface.js';
import { createRuntimeCapabilityResolver } from './mcp/runtime-capability-resolver.js';
import { PostgresApprovalStore } from './persistence/postgres-approval-store.js';
import { PostgresAuditSink } from './persistence/postgres-audit-sink.js';
import { PostgresEventRecordStore } from './persistence/postgres-event-record-store.js';
import { PostgresPublicationExecutionStore } from './persistence/postgres-publication-store.js';
import { PostgresWorkflowStore } from './persistence/postgres-workflow-store.js';
import { GoogleAdsRestApiClient } from './providers/google-ads/google-ads-api-client.js';
import { GoogleAdsPaidMediaProvider } from './providers/google-ads/google-ads-paid-media.js';
import { createPostgresPool } from './persistence/postgres.js';
import { InstagramHistoryProvider } from './providers/instagram/instagram-history-provider.js';
import { InstagramPublicationExecutor } from './providers/instagram/instagram-publication-executor.js';
import { MetaInstagramPublicationTransport } from './providers/instagram/meta-instagram-publication-transport.js';
import { MetaAdsControlledGraphProvider } from './providers/meta-ads/meta-ads-controlled-graph-provider.js';
import { MetaAdsControlledWriteService } from './providers/meta-ads/meta-ads-controlled-write.js';
import { MetaAdsReadProvider } from './providers/meta-ads/meta-ads-read-provider.js';
import { MetaApiClient } from './providers/meta/meta-api-client.js';
import { createToolRegistry } from './registry.js';
import { PostgresScheduler } from './scheduler/postgres-scheduler.js';
import { TocaManagedInstagramScheduler } from './scheduler/toca-managed-instagram-scheduler.js';

export const SERVER_NAME = 'toca-mcp-server';
export const SERVER_VERSION = '0.2.0';
const TOCA_TENANT_ID = 'toca-do-morcego';
const DIRECT_INSTAGRAM_PUBLICATION_CAPABILITIES = [
  'instagram.publish.image',
  'instagram.publish.carousel',
  'instagram.publish.reel',
  'instagram.publish.story',
] as const;

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
  const instagramDirectPublicationEnabled = directPublicationRuntimeConfigured(config);
  const registry = createToolRegistry({
    instagramReadsEnabled: config.INSTAGRAM_READ_ENABLED,
    instagramPublicationWritesEnabled: instagramDirectPublicationEnabled,
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

  let instagramPublication: InstagramCorePublicationRuntime | undefined;
  if (
    instagramDirectPublicationEnabled &&
    pool &&
    config.META_ACCESS_TOKEN_ENV_KEY &&
    config.INSTAGRAM_BUSINESS_ACCOUNT_ID
  ) {
    const store = new PostgresPublicationExecutionStore(pool);
    const transport = new MetaInstagramPublicationTransport(createMetaClient());
    instagramPublication = {
      executor: new InstagramPublicationExecutor(store, transport),
      transport,
      allowedInstagramAccountId: config.INSTAGRAM_BUSINESS_ACCOUNT_ID,
    };
  }

  const metaAdsRead =
    config.META_ADS_READ_ENABLED && config.META_ACCESS_TOKEN_ENV_KEY
      ? new MetaAdsReadProvider(createMetaClient())
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
    ...(instagramPublication ? { instagramPublication } : {}),
    ...(metaAdsRead ? { metaAdsRead } : {}),
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

  const workflowStore = pool ? new PostgresWorkflowStore(pool) : undefined;
  const approvalStore = pool ? new PostgresApprovalStore(pool) : undefined;
  const auditStore = pool ? new PostgresAuditSink(pool, registry) : undefined;
  const eventStore = pool ? new PostgresEventRecordStore(pool) : undefined;

  registerTocaCoreSurface(server, {
    serviceName: SERVER_NAME,
    serviceVersion: SERVER_VERSION,
    registry,
    runtimeResolver,
    resolveIdentity,
    ...(workflowStore ? { workflowStore } : {}),
    ...(approvalStore ? { approvalStore } : {}),
    ...(auditStore ? { auditStore } : {}),
    ...(eventStore ? { eventStore } : {}),
  });

  registerTocaControlCenterSurface(server, {
    registry,
    runtimeResolver,
    resolveIdentity,
    ...(approvalStore ? { approvalStore } : {}),
    workflowStoreAvailable: Boolean(workflowStore),
    auditStoreAvailable: Boolean(auditStore),
    eventStoreAvailable: Boolean(eventStore),
  });

  return server;
}

function csvValues(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function directPublicationRuntimeConfigured(config: RuntimeConfig): boolean {
  return Boolean(
    config.INSTAGRAM_PUBLICATION_WRITES_ENABLED &&
    config.DATABASE_URL &&
    config.META_ACCESS_TOKEN_ENV_KEY &&
    config.INSTAGRAM_BUSINESS_ACCOUNT_ID,
  );
}

function runtimeServiceIdentity(
  env: NodeJS.ProcessEnv,
  config: RuntimeConfig,
): ExecutionIdentity | undefined {
  const cloudRunService = env.K_SERVICE?.trim();
  if (config.NODE_ENV !== 'production' || !config.MCP_ENABLED || !cloudRunService) return undefined;

  const directPublicationEnabled = directPublicationRuntimeConfigured(config);
  return createTrustedServiceExecutionIdentity({
    principalId: `cloud-run-service:${cloudRunService}`,
    tenantId: TOCA_TENANT_ID,
    roles: directPublicationEnabled ? ['OPERATOR', 'EXTERNAL_WRITER'] : ['OPERATOR'],
    allowedCapabilityIds: [
      'instagram.toca_schedule.create',
      'instagram.toca_schedule.reschedule',
      'instagram.toca_schedule.cancel',
      ...(directPublicationEnabled ? DIRECT_INSTAGRAM_PUBLICATION_CAPABILITIES : []),
    ],
    allowedTargetAccounts:
      directPublicationEnabled && config.INSTAGRAM_BUSINESS_ACCOUNT_ID
        ? [config.INSTAGRAM_BUSINESS_ACCOUNT_ID]
        : [],
    evidence: [
      `runtime:cloud-run:${cloudRunService}`,
      'deployment-contract:cloud-run-authenticated-boundary',
    ],
  });
}
