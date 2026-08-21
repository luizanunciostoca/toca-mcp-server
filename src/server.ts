import { McpServer } from '@modelcontextprotocol/server';
import { PostgresVideoContentRuntime } from './content/runtime.js';
import { loadConfig, type RuntimeConfig } from './config.js';
import {
  createTrustedServiceExecutionIdentity,
  type ExecutionIdentity,
  type ExecutionIdentityResolver,
} from './core/identity.js';
import { EnvironmentSecretResolver } from './core/secrets.js';
import { registerTocaCoreSurface } from './mcp/core-surface.js';
import { registerTocaControlCenterSurface } from './mcp/human-control-center.js';
import type { InstagramCorePublicationRuntime } from './mcp/instagram-publication-runtime.js';
import { resolvePaidMediaRuntimeBinding } from './mcp/paid-media-runtime.js';
import { createRuntimeCapabilityResolver } from './mcp/runtime-capability-resolver.js';
import { PostgresApprovalStore } from './persistence/postgres-approval-store.js';
import { PostgresCrmCoreStore } from './persistence/postgres-crm-core-store.js';
import { PostgresCrmSalesStore } from './persistence/postgres-crm-sales-store.js';
import { PostgresCrmSalesPersistenceReadback } from './persistence/postgres-crm-sales-readback.js';
import { PostgresAuditSink } from './persistence/postgres-audit-sink.js';
import { PostgresEventRecordStore } from './persistence/postgres-event-record-store.js';
import { PostgresMetaAdsGeoAudienceStore } from './persistence/postgres-meta-ads-geo-audience-store.js';
import { PostgresPublicationExecutionStore } from './persistence/postgres-publication-store.js';
import { PostgresWorkflowStore } from './persistence/postgres-workflow-store.js';
import { createPostgresPool } from './persistence/postgres.js';
import { GoogleAdsAccountVerifier } from './providers/google-ads/google-ads-account-verifier.js';
import { GoogleAdsRestApiClient } from './providers/google-ads/google-ads-api-client.js';
import { GoogleAdsPaidMediaProvider } from './providers/google-ads/google-ads-paid-media.js';
import { InstagramHistoryProvider } from './providers/instagram/instagram-history-provider.js';
import { InstagramPublicationExecutor } from './providers/instagram/instagram-publication-executor.js';
import { MetaInstagramPublicationTransport } from './providers/instagram/meta-instagram-publication-transport.js';
import { MetaAdsControlledGraphProvider } from './providers/meta-ads/meta-ads-controlled-graph-provider.js';
import { MetaAdsControlledWriteService } from './providers/meta-ads/meta-ads-controlled-write.js';
import { MetaAdsDemandIntelligenceService } from './providers/meta-ads/meta-ads-demand-intelligence.js';
import { MetaAdsReadProvider } from './providers/meta-ads/meta-ads-read-provider.js';
import { MetaApiClient } from './providers/meta/meta-api-client.js';
import { createToolRegistry } from './registry.js';
import { isTenantScopedApprovalStore } from './governance/approval-scope.js';
import { resolveRuntimeTenantIdentity } from './runtime/tenant-identity.js';
import { PostgresScheduler } from './scheduler/postgres-scheduler.js';
import { TocaManagedInstagramScheduler } from './scheduler/toca-managed-instagram-scheduler.js';

export const SERVER_NAME = 'toca-mcp-server';
export const SERVER_VERSION = '0.2.0';
export const DEFAULT_TOCA_TENANT_ID = 'toca';
const DIRECT_INSTAGRAM_PUBLICATION_CAPABILITIES = [
  'instagram.publish.image',
  'instagram.publish.carousel',
  'instagram.publish.reel',
  'instagram.publish.story',
] as const;

export interface TocaRuntimeComposition {
  readonly config: RuntimeConfig;
  readonly registry: ReturnType<typeof createToolRegistry>;
  readonly runtimeResolver: ReturnType<typeof createRuntimeCapabilityResolver>;
  readonly resolveIdentity: ExecutionIdentityResolver;
  readonly pool: ReturnType<typeof createPostgresPool> | undefined;
  readonly workflowStore: PostgresWorkflowStore | undefined;
  readonly approvalStore: PostgresApprovalStore | undefined;
  readonly auditStore: PostgresAuditSink | undefined;
  readonly eventStore: PostgresEventRecordStore | undefined;
}

export interface TocaServerOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly executionIdentity?: ExecutionIdentity;
  readonly defaultTenantId?: string;
  readonly defaultWorkspaceId?: string;
  readonly defaultOrganizationId?: string;
  readonly onRuntimeComposition?: (composition: TocaRuntimeComposition) => void;
}

export function createTocaRuntimeComposition(
  options: Omit<TocaServerOptions, 'onRuntimeComposition'> = {},
): TocaRuntimeComposition {
  let composition: TocaRuntimeComposition | undefined;
  createTocaServer({
    ...options,
    onRuntimeComposition: (value) => {
      composition = value;
    },
  });
  if (!composition) throw new Error('TOCA_RUNTIME_COMPOSITION_UNAVAILABLE');
  return composition;
}

export function createTocaServer(options: TocaServerOptions = {}): McpServer {
  const env = options.env ?? process.env;
  const config = loadConfig(env);
  const defaultTenantId =
    options.defaultTenantId?.trim() || env.TOCA_DEFAULT_TENANT_ID?.trim() || DEFAULT_TOCA_TENANT_ID;
  const defaultWorkspaceId =
    options.defaultWorkspaceId?.trim() || env.TOCA_DEFAULT_WORKSPACE_ID?.trim() || defaultTenantId;
  const defaultOrganizationId =
    options.defaultOrganizationId?.trim() ||
    env.TOCA_DEFAULT_ORGANIZATION_ID?.trim() ||
    defaultTenantId;
  const defaultScope = {
    tenantId: defaultTenantId,
    workspaceId: defaultWorkspaceId,
    organizationId: defaultOrganizationId,
  };
  const fallbackIdentity =
    options.executionIdentity ?? runtimeServiceIdentity(env, config, defaultScope);
  const resolveIdentity: ExecutionIdentityResolver = (context) =>
    resolveRuntimeTenantIdentity(context, {
      ...defaultScope,
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
    paidMediaDecisionEnabled: true,
    googleAdsPhase: config.GOOGLE_ADS_PHASE,
    googleAdsActivateEnabled: config.GOOGLE_ADS_ACTIVATE_ENABLED,
    tocaManagedInstagramSchedulerEnabled: config.TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED,
    videoContentRuntimeEnabled: Boolean(pool),
    crmSalesRuntimeEnabled: Boolean(pool),
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
  const metaAdsDemand = metaAdsRead
    ? new MetaAdsDemandIntelligenceService(
        metaAdsRead,
        pool ? new PostgresMetaAdsGeoAudienceStore(pool) : undefined,
        {
          tenantId: defaultTenantId,
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
  let googleAdsAccountVerifier: GoogleAdsAccountVerifier | undefined;
  if (config.GOOGLE_ADS_PHASE !== 'OFF') {
    const {
      GOOGLE_ADS_CUSTOMER_ID: customerId,
      GOOGLE_ADS_LOGIN_CUSTOMER_ID: loginCustomerId,
      GOOGLE_ADS_ACCESS_TOKEN_ENV_KEY: accessTokenEnvKey,
      GOOGLE_ADS_OAUTH_CLIENT_ID_ENV_KEY: oauthClientIdEnvKey,
      GOOGLE_ADS_OAUTH_CLIENT_SECRET_ENV_KEY: oauthClientSecretEnvKey,
      GOOGLE_ADS_OAUTH_REFRESH_TOKEN_ENV_KEY: oauthRefreshTokenEnvKey,
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
      !developerTokenEnvKey ||
      !allowedCustomerId ||
      !allowedCurrency ||
      !maxDailyBudgetMicros ||
      !currencyMinorUnitMicros ||
      !allowedLocationIdsRaw
    ) {
      throw new Error('GOOGLE_ADS_RUNTIME_GUARDRAILS_REQUIRED');
    }

    const authConfig = accessTokenEnvKey
      ? { accessTokenRef: { provider: 'env' as const, key: accessTokenEnvKey } }
      : (() => {
          if (!oauthClientIdEnvKey || !oauthClientSecretEnvKey || !oauthRefreshTokenEnvKey) {
            throw new Error('GOOGLE_ADS_OAUTH_REFRESH_CONFIG_REQUIRED');
          }
          return {
            oauthRefresh: {
              clientIdRef: { provider: 'env' as const, key: oauthClientIdEnvKey },
              clientSecretRef: { provider: 'env' as const, key: oauthClientSecretEnvKey },
              refreshTokenRef: { provider: 'env' as const, key: oauthRefreshTokenEnvKey },
              tokenEndpoint: config.GOOGLE_ADS_OAUTH_TOKEN_ENDPOINT,
            },
          };
        })();

    const api = new GoogleAdsRestApiClient(
      {
        apiVersion: config.GOOGLE_ADS_API_VERSION,
        customerId,
        ...(loginCustomerId ? { loginCustomerId } : {}),
        ...authConfig,
        developerTokenRef: { provider: 'env', key: developerTokenEnvKey },
      },
      secrets,
    );
    googleAdsAccountVerifier = new GoogleAdsAccountVerifier(api, {
      customerId: allowedCustomerId,
      allowedCurrency,
    });
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
  const crmCore = pool ? new PostgresCrmCoreStore(pool) : undefined;
  const crmSales = pool ? new PostgresCrmSalesStore(pool) : undefined;
  const crmSalesReadback = pool ? new PostgresCrmSalesPersistenceReadback(pool) : undefined;
  const googleAdsTargetAccount =
    googleAds && config.GOOGLE_ADS_ALLOWED_CUSTOMER_ID
      ? config.GOOGLE_ADS_ALLOWED_CUSTOMER_ID.replaceAll('-', '')
      : undefined;
  const standardRuntimeResolver = createRuntimeCapabilityResolver({
    ...(instagramHistory ? { instagramHistory } : {}),
    ...(instagramPublication ? { instagramPublication } : {}),
    ...(metaAdsRead ? { metaAdsRead } : {}),
    ...(metaAdsDemand ? { metaAdsDemand } : {}),
    ...(metaAdsWrite ? { metaAdsWrite } : {}),
    ...(metaAdsWriteProvider ? { metaAdsWriteProvider } : {}),
    ...(googleAds ? { googleAds } : {}),
    ...(googleAdsTargetAccount ? { googleAdsTargetAccount } : {}),
    ...(googleAds && config.GOOGLE_ADS_ALLOWED_CURRENCY
      ? { googleAdsCurrency: config.GOOGLE_ADS_ALLOWED_CURRENCY.toUpperCase() }
      : {}),
    ...(instagramScheduler ? { instagramScheduler } : {}),
    ...(videoContent ? { videoContent } : {}),
    ...(crmCore && crmSales && crmSalesReadback
      ? { crmSales: { core: crmCore, sales: crmSales, persistenceReadback: crmSalesReadback } }
      : {}),
  });
  const runtimeResolver = (capabilityId: string) =>
    resolvePaidMediaRuntimeBinding(capabilityId, {
      ...(googleAdsAccountVerifier ? { googleAdsAccountVerifier } : {}),
      ...(googleAdsTargetAccount ? { googleAdsTargetAccount } : {}),
    }) ?? standardRuntimeResolver(capabilityId);

  const workflowStore = pool ? new PostgresWorkflowStore(pool) : undefined;
  const approvalStore = pool ? new PostgresApprovalStore(pool) : undefined;
  const auditStore = pool ? new PostgresAuditSink(pool, registry) : undefined;
  const eventStore = pool ? new PostgresEventRecordStore(pool) : undefined;

  options.onRuntimeComposition?.({
    config,
    registry,
    runtimeResolver,
    resolveIdentity,
    pool,
    workflowStore,
    approvalStore,
    auditStore,
    eventStore,
  });

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
    approvalStoreAvailable: Boolean(approvalStore),
    approvalListAvailable: isTenantScopedApprovalStore(approvalStore),
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
  scope: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly organizationId: string;
  },
): ExecutionIdentity | undefined {
  const cloudRunService = env.K_SERVICE?.trim();
  if (config.NODE_ENV !== 'production' || !config.MCP_ENABLED || !cloudRunService) return undefined;

  const directPublicationEnabled = directPublicationRuntimeConfigured(config);
  return createTrustedServiceExecutionIdentity({
    principalId: `cloud-run-service:${cloudRunService}`,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    organizationId: scope.organizationId,
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
      `runtime:tenant:${scope.tenantId}`,
      'deployment-contract:cloud-run-authenticated-boundary',
    ],
  });
}
