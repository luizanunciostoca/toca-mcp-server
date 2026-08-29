import { hostname } from 'node:os';
import { loadConfig } from './config.js';
import { EnvSecretResolver } from './core/secrets.js';
import { SocialEngagementLeadEngine } from './crm/social-engagement-lead-engine.js';
import { PostgresTransactionalOutbox } from './events/postgres-transactional-outbox.js';
import {
  INSTAGRAM_ENGAGEMENT_INBOUND_EVENT_TYPE,
  INSTAGRAM_ENGAGEMENT_REPLY_EVENT_TYPE,
} from './instagram-engagement/events.js';
import { GoogleSheetsInstagramEngagementKnowledgeSource } from './instagram-engagement/knowledge.js';
import { InstagramEngagementProcessor } from './instagram-engagement/processor.js';
import {
  claimInstagramEngagementEvents,
  recoverStaleInstagramEngagementClaims,
} from './instagram-engagement/typed-outbox.js';
import { PostgresCrmCoreStore } from './persistence/postgres-crm-core-store.js';
import { PostgresEventRecordStore } from './persistence/postgres-event-record-store.js';
import { createPostgresPool } from './persistence/postgres.js';
import { GoogleSheetsRestClient } from './providers/google-sheets/client.js';
import { InstagramGraphEngagementProvider } from './providers/instagram/instagram-engagement-provider.js';
import { MetaApiClient } from './providers/meta/meta-api-client.js';

const config = loadConfig();
if (!isTrue(process.env.INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED)) {
  throw new Error('INSTAGRAM_ENGAGEMENT_RUNTIME_DISABLED');
}
if (!config.DATABASE_URL) throw new Error('INSTAGRAM_ENGAGEMENT_DATABASE_URL_REQUIRED');

const pool = createPostgresPool({ connectionString: config.DATABASE_URL });
const outbox = new PostgresTransactionalOutbox(pool);
const tenantId = requiredEnv('INSTAGRAM_ENGAGEMENT_TENANT_ID');
const workspaceId = process.env.INSTAGRAM_ENGAGEMENT_WORKSPACE_ID?.trim() || tenantId;
const organizationId = process.env.INSTAGRAM_ENGAGEMENT_ORGANIZATION_ID?.trim() || tenantId;
const spreadsheetId = requiredEnv('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SPREADSHEET_ID');
const sheetsTokenKey = requiredEnv('INSTAGRAM_ENGAGEMENT_GOOGLE_SHEETS_TOKEN_ENV_KEY');
const pageId = requiredEnv('INSTAGRAM_ENGAGEMENT_PAGE_ID');
const instagramUserId =
  config.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? requiredEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID');
const workerId = `${process.env.K_REVISION?.trim() || hostname()}:instagram-engagement`;
const batchSize = boundedInteger(process.env.INSTAGRAM_ENGAGEMENT_BATCH_SIZE, 10, 1, 50);
const pollMs = boundedInteger(process.env.INSTAGRAM_ENGAGEMENT_POLL_MS, 1_000, 250, 60_000);
const staleMs = boundedInteger(
  process.env.INSTAGRAM_ENGAGEMENT_STALE_CLAIM_MS,
  300_000,
  60_000,
  3_600_000,
);
const eventTypes = [
  INSTAGRAM_ENGAGEMENT_INBOUND_EVENT_TYPE,
  INSTAGRAM_ENGAGEMENT_REPLY_EVENT_TYPE,
] as const;

const sheetsSecrets = new EnvSecretResolver(process.env, 'env');
const sheetsClient = new GoogleSheetsRestClient(sheetsSecrets, {
  tokenReference: { provider: 'env', key: sheetsTokenKey },
});
const knowledge = new GoogleSheetsInstagramEngagementKnowledgeSource({
  client: sheetsClient,
  spreadsheetId,
  range: process.env.INSTAGRAM_ENGAGEMENT_KNOWLEDGE_RANGE?.trim() || 'FAQ_IA!A:T',
  cacheMs: boundedInteger(
    process.env.INSTAGRAM_ENGAGEMENT_KNOWLEDGE_CACHE_MS,
    60_000,
    0,
    3_600_000,
  ),
});

const crm = new PostgresCrmCoreStore(pool, { outbox });
const events = new PostgresEventRecordStore(pool, { outbox });
const leadEngine = new SocialEngagementLeadEngine({
  crm,
  events,
  eventSeriesKeys: {
    sunset: process.env.INSTAGRAM_ENGAGEMENT_SUNSET_SERIES_KEY?.trim() || 'sunset',
    theParty: process.env.INSTAGRAM_ENGAGEMENT_THE_PARTY_SERIES_KEY?.trim() || 'the-party',
  },
});

const provider = config.INSTAGRAM_ENGAGEMENT_WRITES_ENABLED
  ? createLiveProvider()
  : {
      replyToComment(): Promise<{ readonly commentId: string }> {
        return Promise.reject(new Error('INSTAGRAM_ENGAGEMENT_WRITES_DISABLED'));
      },
      sendDirectReply(): Promise<{
        readonly recipientId: string;
        readonly messageId: string;
      }> {
        return Promise.reject(new Error('INSTAGRAM_ENGAGEMENT_WRITES_DISABLED'));
      },
    };

const processor = new InstagramEngagementProcessor({
  pool,
  knowledge,
  leadEngine,
  provider,
  pageId,
  instagramUserId,
  writesEnabled: config.INSTAGRAM_ENGAGEMENT_WRITES_ENABLED,
});

let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

console.log(
  'Instagram engagement worker started',
  JSON.stringify({
    workerId,
    writesEnabled: config.INSTAGRAM_ENGAGEMENT_WRITES_ENABLED,
    batchSize,
    knowledgeConfigured: true,
    scopeConfigured: Boolean(tenantId && workspaceId && organizationId),
  }),
);

while (!stopping) {
  const now = new Date();
  await recoverStaleInstagramEngagementClaims({
    pool,
    eventTypes,
    staleBefore: new Date(now.getTime() - staleMs).toISOString(),
    now: now.toISOString(),
    limit: batchSize,
  });
  const claimed = await claimInstagramEngagementEvents({
    pool,
    workerId,
    eventTypes,
    now: now.toISOString(),
    limit: batchSize,
  });

  if (claimed.length === 0) {
    await sleep(pollMs);
    continue;
  }

  for (const event of claimed) {
    if (stopping) break;
    try {
      await processor.process(event);
      console.log(
        'Instagram engagement event processed',
        JSON.stringify({ eventId: event.eventId, eventType: event.eventType }),
      );
    } catch (error) {
      const code = safeErrorCode(error);
      const nextAttemptAt = new Date(Date.now() + retryDelayMs(event.attemptNumber)).toISOString();
      await outbox.markFailed({
        eventId: event.eventId,
        executionId: event.executionId,
        errorCode: code,
        evidence: [`instagram:engagement:processing-error:${code}`],
        now: new Date().toISOString(),
        nextAttemptAt,
      });
      console.error(
        'Instagram engagement event failed',
        JSON.stringify({ eventId: event.eventId, eventType: event.eventType, errorCode: code }),
      );
    }
  }
}

await pool.end();
console.log('Instagram engagement worker stopped');

function createLiveProvider(): InstagramGraphEngagementProvider {
  if (!config.META_ENABLED) throw new Error('META_ENABLED_REQUIRED');
  if (!isTrue(process.env.META_PROVIDER_VERIFIED)) throw new Error('META_PROVIDER_NOT_VERIFIED');
  if (!config.META_ACCESS_TOKEN_ENV_KEY) throw new Error('META_ACCESS_TOKEN_ENV_KEY_REQUIRED');
  const secrets = new EnvSecretResolver(process.env, 'env');
  const client = new MetaApiClient(
    { graphBaseUrl: config.META_GRAPH_BASE_URL, apiVersion: config.META_GRAPH_API_VERSION },
    secrets,
    { provider: 'env', key: config.META_ACCESS_TOKEN_ENV_KEY },
  );
  return new InstagramGraphEngagementProvider(client);
}

function retryDelayMs(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempt - 1), 60_000);
}

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key}_REQUIRED`);
  return value;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!value?.trim()) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error('INSTAGRAM_ENGAGEMENT_RUNTIME_INTEGER_INVALID');
  }
  return parsed;
}

function safeErrorCode(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const candidate =
    raw.split('|', 1)[0]?.split(':', 1)[0]?.trim() || 'INSTAGRAM_ENGAGEMENT_PROCESSING_FAILED';
  return /^[A-Z0-9_]+$/.test(candidate)
    ? candidate.slice(0, 120)
    : 'INSTAGRAM_ENGAGEMENT_PROCESSING_FAILED';
}

function isTrue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
