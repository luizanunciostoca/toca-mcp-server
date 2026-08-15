import { McpServer } from '@modelcontextprotocol/server';
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
import { PostgresWorkflowStore } from './persistence/postgres-workflow-store.js';
import { createPostgresPool } from './persistence/postgres.js';
import { InstagramHistoryProvider } from './providers/instagram/instagram-history-provider.js';
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
  const registry = createToolRegistry({
    instagramReadsEnabled: config.INSTAGRAM_READ_ENABLED,
    metaAdsReadsEnabled: config.META_ADS_READ_ENABLED,
    metaAdsWritesEnabled: config.META_ADS_WRITE_ENABLED,
    tocaManagedInstagramSchedulerEnabled: config.TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED,
  });

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

  const runtimeResolver = createRuntimeCapabilityResolver({
    ...(instagramHistory ? { instagramHistory } : {}),
    ...(metaAdsRead ? { metaAdsRead } : {}),
    ...(metaAdsWrite ? { metaAdsWrite } : {}),
    ...(metaAdsWriteProvider ? { metaAdsWriteProvider } : {}),
    ...(instagramScheduler ? { instagramScheduler } : {}),
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
