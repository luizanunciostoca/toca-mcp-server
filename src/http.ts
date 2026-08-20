import { loadConfig } from './config.js';
import { EnvSecretResolver } from './core/secrets.js';
import { createRuntimeReadinessChecks } from './health/runtime-readiness.js';
import { createTocaHttpServer, type MetaWebhookHttpBoundary } from './http-server.js';
import { PostgresMetaWebhookEventStore } from './persistence/meta-webhook-event-store.js';
import { createPostgresPool } from './persistence/postgres.js';
import { createMetaHttpRuntime } from './providers/meta/meta-http-runtime.js';
import { SERVER_NAME } from './server.js';

const config = loadConfig();
const metaRuntime = createMetaHttpRuntime(config, process.env);
const host =
  process.env.MCP_HOST ?? (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const port = Number.parseInt(process.env.MCP_PORT ?? process.env.PORT ?? '3000', 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('MCP_PORT/PORT must be an integer between 1 and 65535');
}

const databasePool = config.DATABASE_URL
  ? createPostgresPool({
      connectionString: config.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true',
    })
  : undefined;
const readinessChecks = createRuntimeReadinessChecks({
  config,
  env: process.env,
  ...(databasePool ? { pool: databasePool } : {}),
});
const metaWebhook = createMetaWebhookBoundary(databasePool);

const server = createTocaHttpServer({
  onError: (error) => {
    console.error('HTTP request failed', error instanceof Error ? error.message : 'unknown error');
  },
  readinessChecks,
  mcpEnabled: config.MCP_ENABLED,
  ...(metaRuntime
    ? {
        metaOAuth: metaRuntime.oauth,
        metaAssetDiscovery: (result) => metaRuntime.discoverAssets(result),
      }
    : {}),
  ...(metaWebhook ? { metaWebhook } : {}),
});

server.listen(port, host, () => {
  console.log(`${SERVER_NAME} HTTP runtime listening on http://${host}:${port}`);
});

function createMetaWebhookBoundary(
  pool: ReturnType<typeof createPostgresPool> | undefined,
): MetaWebhookHttpBoundary | undefined {
  if (!config.META_WEBHOOK_ENABLED) return undefined;

  if (
    !config.META_APP_SECRET_PROVIDER ||
    !config.META_APP_SECRET_KEY ||
    !config.META_WEBHOOK_VERIFY_TOKEN_KEY
  ) {
    throw new Error('Meta webhook configuration is incomplete');
  }

  if (config.META_APP_SECRET_PROVIDER !== 'env') {
    throw new Error(`Unsupported Meta webhook secret provider: ${config.META_APP_SECRET_PROVIDER}`);
  }

  const resolver = new EnvSecretResolver(process.env, config.META_APP_SECRET_PROVIDER);
  const appSecretReference = {
    provider: config.META_APP_SECRET_PROVIDER,
    key: config.META_APP_SECRET_KEY,
  };
  const verifyTokenReference = {
    provider: config.META_APP_SECRET_PROVIDER,
    key: config.META_WEBHOOK_VERIFY_TOKEN_KEY,
  };

  if (config.META_WEBHOOK_PERSISTENCE_ENABLED && !pool) {
    throw new Error('Meta webhook persistence requires the shared database pool');
  }
  const eventStore =
    config.META_WEBHOOK_PERSISTENCE_ENABLED && pool
      ? new PostgresMetaWebhookEventStore(pool)
      : undefined;

  return {
    resolveAppSecret: () => resolver.resolve(appSecretReference),
    resolveVerifyToken: () => resolver.resolve(verifyTokenReference),
    onEvents: async (events) => {
      const persistence = eventStore
        ? await eventStore.persist(events)
        : { accepted: events, duplicates: [] as typeof events };
      const channels = [...new Set(persistence.accepted.map((event) => event.channel))];
      console.log(
        'Meta webhook events accepted',
        JSON.stringify({
          count: persistence.accepted.length,
          duplicateCount: persistence.duplicates.length,
          channels,
          eventIds: persistence.accepted.map((event) => event.eventId),
        }),
      );
    },
  };
}
