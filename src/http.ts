import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadConfig } from './config.js';
import { EnvSecretResolver } from './core/secrets.js';
import { createRuntimeReadinessChecks } from './health/runtime-readiness.js';
import { createTocaHttpServer, type MetaWebhookHttpBoundary } from './http-server.js';
import { PostgresMetaWebhookEventStore } from './persistence/meta-webhook-event-store.js';
import { createPostgresPool } from './persistence/postgres.js';
import { createMetaHttpRuntime } from './providers/meta/meta-http-runtime.js';
import {
  createSendGridEventHttpRuntime,
  type SendGridEventHttpRuntime,
} from './providers/sendgrid/email-event-http-runtime.js';
import {
  createWhatsAppHttpComposition,
  type WhatsAppHttpComposition,
} from './omnichannel/whatsapp-http-composition.js';
import { SERVER_NAME } from './server.js';

const SENDGRID_EVENT_WEBHOOK_PATH = '/webhooks/sendgrid/events';
const SENDGRID_MAX_EVENT_WEBHOOK_BYTES = 2 * 1024 * 1024;
const WEBHOOK_SERVICE_ALLOWED_PATHS = new Set([
  '/health',
  '/healthz',
  '/readyz',
  '/webhooks/meta',
  SENDGRID_EVENT_WEBHOOK_PATH,
]);

const config = loadConfig();
const metaRuntime = createMetaHttpRuntime(config, process.env);
const readinessPool = config.DATABASE_URL
  ? createPostgresPool({ connectionString: config.DATABASE_URL })
  : undefined;
const readinessChecks = createRuntimeReadinessChecks({
  config,
  env: process.env,
  ...(readinessPool ? { pool: readinessPool } : {}),
});
const host =
  process.env.MCP_HOST ?? (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const port = Number.parseInt(process.env.MCP_PORT ?? process.env.PORT ?? '3000', 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('MCP_PORT/PORT must be an integer between 1 and 65535');
}

const whatsappRuntime = await createWhatsAppWebhookRuntime();
const metaWebhook = createMetaWebhookBoundary(whatsappRuntime);
const sendGridEventRuntime = await createEmailWebhookRuntime();

const baseServer = createTocaHttpServer({
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

const server = sendGridEventRuntime || isWebhookService()
  ? createServer((request, response) => {
      void handleComposedHttpRequest(request, response, sendGridEventRuntime, baseServer);
    })
  : baseServer;

server.listen(port, host, () => {
  console.log(`${SERVER_NAME} HTTP runtime listening on http://${host}:${port}`);
});

async function createWhatsAppWebhookRuntime(): Promise<WhatsAppHttpComposition | undefined> {
  if (!isTrue(process.env.WHATSAPP_RUNTIME_ENABLED)) return undefined;
  if (!config.DATABASE_URL?.trim()) throw new Error('WHATSAPP_DATABASE_URL_REQUIRED');
  return createWhatsAppHttpComposition({
    pool: createPostgresPool({ connectionString: config.DATABASE_URL }),
    env: process.env,
  });
}

async function createEmailWebhookRuntime(): Promise<SendGridEventHttpRuntime | undefined> {
  if (!isTrue(process.env.EMAIL_SENDGRID_ENABLED)) return undefined;
  if (!config.DATABASE_URL?.trim()) throw new Error('EMAIL_SENDGRID_DATABASE_URL_REQUIRED');
  const pool = createPostgresPool({ connectionString: config.DATABASE_URL });
  const runtime = await createSendGridEventHttpRuntime({ pool, env: process.env });
  if (!runtime) throw new Error('EMAIL_SENDGRID_RUNTIME_ENABLED_BUT_NOT_COMPOSED');
  return runtime;
}

async function handleComposedHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  sendGrid: SendGridEventHttpRuntime | undefined,
  baseServer: ReturnType<typeof createTocaHttpServer>,
): Promise<void> {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;

  if (isWebhookService() && !WEBHOOK_SERVICE_ALLOWED_PATHS.has(pathname)) {
    sendJson(response, 404, { error: 'not_found' });
    return;
  }

  if (pathname !== SENDGRID_EVENT_WEBHOOK_PATH || !sendGrid) {
    baseServer.emit('request', request, response);
    return;
  }

  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
    return;
  }

  try {
    const rawBody = await readRawRequestBody(request, SENDGRID_MAX_EVENT_WEBHOOK_BYTES);
    const result = await sendGrid.handleEventWebhook(rawBody, {
      'x-twilio-email-event-webhook-timestamp':
        request.headers['x-twilio-email-event-webhook-timestamp'],
      'x-twilio-email-event-webhook-signature':
        request.headers['x-twilio-email-event-webhook-signature'],
    });
    sendJson(response, 202, { ok: true, ...result });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'SENDGRID_EVENT_WEBHOOK_FAILED';
    console.error('SendGrid Event Webhook failed', code);
    sendJson(response, webhookErrorStatus(code), { ok: false, error: safeErrorCode(code) });
  }
}

function createMetaWebhookBoundary(
  whatsappRuntime: WhatsAppHttpComposition | undefined,
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

  const eventStore = config.META_WEBHOOK_PERSISTENCE_ENABLED
    ? new PostgresMetaWebhookEventStore(
        createPostgresPool({ connectionString: config.DATABASE_URL as string }),
      )
    : undefined;

  return {
    resolveAppSecret: () => resolver.resolve(appSecretReference),
    resolveVerifyToken: () => resolver.resolve(verifyTokenReference),
    ...(whatsappRuntime ? { onWhatsAppEvents: (events) => whatsappRuntime.ingest(events) } : {}),
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

async function readRawRequestBody(request: IncomingMessage, maximumBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > maximumBytes) throw new Error('SENDGRID_EVENT_WEBHOOK_BODY_TOO_LARGE');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function webhookErrorStatus(code: string): number {
  if (code.includes('SIGNATURE') || code.includes('TIMESTAMP')) return 401;
  if (code.includes('BODY_TOO_LARGE')) return 413;
  if (code.includes('BODY_INVALID') || code.includes('EVENT_TYPE_REQUIRED')) return 400;
  return 500;
}

function safeErrorCode(value: string): string {
  const code = value.split(':', 1)[0]?.trim();
  return code && /^[A-Z0-9_]+$/.test(code) ? code : 'SENDGRID_EVENT_WEBHOOK_FAILED';
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
  });
  response.end(payload);
}

function isWebhookService(): boolean {
  return process.env.TOCA_SERVICE_ROLE?.trim() === 'webhook';
}

function isTrue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}
