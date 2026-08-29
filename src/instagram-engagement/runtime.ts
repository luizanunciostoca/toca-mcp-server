import { hostname } from 'node:os';
import type pg from 'pg';
import type { loadConfig } from '../config.js';
import { EnvSecretResolver } from '../core/secrets.js';
import { SocialEngagementLeadEngine } from '../crm/social-engagement-lead-engine.js';
import { PostgresTransactionalOutbox } from '../events/postgres-transactional-outbox.js';
import { PostgresCrmCoreStore } from '../persistence/postgres-crm-core-store.js';
import { PostgresEventRecordStore } from '../persistence/postgres-event-record-store.js';
import { GoogleSheetsRestClient } from '../providers/google-sheets/client.js';
import type { InstagramEngagementProvider } from '../providers/instagram/instagram-engagement-contracts.js';
import { InstagramGraphEngagementProvider } from '../providers/instagram/instagram-engagement-provider.js';
import { MetaApiClient } from '../providers/meta/meta-api-client.js';
import {
  INSTAGRAM_ENGAGEMENT_INBOUND_EVENT_TYPE,
  INSTAGRAM_ENGAGEMENT_REPLY_EVENT_TYPE,
} from './events.js';
import { createInstagramEngagementGoogleSheetsAuth } from './google-sheets-auth.js';
import {
  GoogleSheetsInstagramEngagementKnowledgeSource,
  type InstagramEngagementKnowledgeSource,
} from './knowledge.js';
import { PostgresInstagramEngagementKnowledgeSource } from './postgres-knowledge.js';
import { InstagramEngagementProcessor } from './processor.js';
import {
  claimInstagramEngagementEvents,
  recoverStaleInstagramEngagementClaims,
} from './typed-outbox.js';

type Config = ReturnType<typeof loadConfig>;
type KnowledgeRuntimeMode = 'google-sheets:env' | 'google-sheets:gcp-iam' | 'postgres';

export interface InstagramEngagementBatchRuntimeOptions {
  readonly config: Config;
  readonly pool: pg.Pool;
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  readonly workerId?: string;
}

export interface InstagramEngagementBatchResult {
  readonly claimed: number;
  readonly succeeded: number;
  readonly failed: number;
}

export interface InstagramEngagementBatchRuntime {
  readonly writesEnabled: boolean;
  readonly knowledgeAuthMode: KnowledgeRuntimeMode;
  runBatch(now?: Date): Promise<InstagramEngagementBatchResult>;
}

export function createInstagramEngagementBatchRuntime(
  options: InstagramEngagementBatchRuntimeOptions,
): InstagramEngagementBatchRuntime {
  const env = options.env ?? process.env;
  const config = options.config;
  if (!isTrue(env.INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED)) {
    throw new Error('INSTAGRAM_ENGAGEMENT_RUNTIME_DISABLED');
  }

  requiredEnv(env, 'INSTAGRAM_ENGAGEMENT_TENANT_ID');
  const spreadsheetId = requiredEnv(env, 'INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SPREADSHEET_ID');
  const pageId = requiredEnv(env, 'INSTAGRAM_ENGAGEMENT_PAGE_ID');
  const instagramUserId =
    config.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? requiredEnv(env, 'INSTAGRAM_BUSINESS_ACCOUNT_ID');
  const workerId =
    options.workerId ?? `${env.K_REVISION?.trim() || hostname()}:instagram-engagement`;
  const batchSize = boundedInteger(env.INSTAGRAM_ENGAGEMENT_BATCH_SIZE, 10, 1, 50);
  const staleMs = boundedInteger(
    env.INSTAGRAM_ENGAGEMENT_STALE_CLAIM_MS,
    300_000,
    60_000,
    3_600_000,
  );
  const eventTypes = [
    INSTAGRAM_ENGAGEMENT_INBOUND_EVENT_TYPE,
    INSTAGRAM_ENGAGEMENT_REPLY_EVENT_TYPE,
  ] as const;

  const outbox = new PostgresTransactionalOutbox(options.pool);
  const knowledgeRuntime = createKnowledgeSource(options.pool, spreadsheetId, env, options.fetchImpl);

  const crm = new PostgresCrmCoreStore(options.pool, { outbox });
  const events = new PostgresEventRecordStore(options.pool, { outbox });
  const leadEngine = new SocialEngagementLeadEngine({
    crm,
    events,
    eventSeriesKeys: {
      sunset: env.INSTAGRAM_ENGAGEMENT_SUNSET_SERIES_KEY?.trim() || 'sunset',
      theParty: env.INSTAGRAM_ENGAGEMENT_THE_PARTY_SERIES_KEY?.trim() || 'the-party',
    },
  });

  const provider: InstagramEngagementProvider = config.INSTAGRAM_ENGAGEMENT_WRITES_ENABLED
    ? createLiveProvider(config, env)
    : disabledProvider();
  const processor = new InstagramEngagementProcessor({
    pool: options.pool,
    knowledge: knowledgeRuntime.source,
    leadEngine,
    provider,
    pageId,
    instagramUserId,
    writesEnabled: config.INSTAGRAM_ENGAGEMENT_WRITES_ENABLED,
  });

  return {
    writesEnabled: config.INSTAGRAM_ENGAGEMENT_WRITES_ENABLED,
    knowledgeAuthMode: knowledgeRuntime.mode,
    async runBatch(now = new Date()) {
      await recoverStaleInstagramEngagementClaims({
        pool: options.pool,
        eventTypes,
        staleBefore: new Date(now.getTime() - staleMs).toISOString(),
        now: now.toISOString(),
        limit: batchSize,
      });
      const claimed = await claimInstagramEngagementEvents({
        pool: options.pool,
        workerId,
        eventTypes,
        now: now.toISOString(),
        limit: batchSize,
      });

      let succeeded = 0;
      let failed = 0;
      for (const event of claimed) {
        try {
          await processor.process(event);
          succeeded += 1;
        } catch (error) {
          failed += 1;
          const code = safeErrorCode(error);
          const nextAttemptAt = new Date(
            Date.now() + retryDelayMs(event.attemptNumber),
          ).toISOString();
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
      return { claimed: claimed.length, succeeded, failed };
    },
  };
}

function createKnowledgeSource(
  pool: pg.Pool,
  spreadsheetId: string,
  env: NodeJS.ProcessEnv,
  fetchImpl?: typeof fetch,
): { readonly source: InstagramEngagementKnowledgeSource; readonly mode: KnowledgeRuntimeMode } {
  const kind = env.INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SOURCE?.trim().toLowerCase() || 'google-sheets';
  if (kind === 'postgres') {
    return {
      source: new PostgresInstagramEngagementKnowledgeSource(pool, spreadsheetId),
      mode: 'postgres',
    };
  }
  if (kind !== 'google-sheets') throw new Error('INSTAGRAM_ENGAGEMENT_KNOWLEDGE_SOURCE_INVALID');

  const sheetsAuth = createInstagramEngagementGoogleSheetsAuth(env, fetchImpl ?? fetch);
  const sheetsClient = new GoogleSheetsRestClient(sheetsAuth.resolver, {
    tokenReference: sheetsAuth.tokenReference,
  });
  return {
    source: new GoogleSheetsInstagramEngagementKnowledgeSource({
      client: sheetsClient,
      spreadsheetId,
      range: env.INSTAGRAM_ENGAGEMENT_KNOWLEDGE_RANGE?.trim() || 'FAQ_IA!A:T',
      cacheMs: boundedInteger(env.INSTAGRAM_ENGAGEMENT_KNOWLEDGE_CACHE_MS, 60_000, 0, 3_600_000),
    }),
    mode: `google-sheets:${sheetsAuth.mode}`,
  };
}

function createLiveProvider(
  config: Config,
  env: NodeJS.ProcessEnv,
): InstagramGraphEngagementProvider {
  if (!config.META_ENABLED) throw new Error('META_ENABLED_REQUIRED');
  if (!isTrue(env.META_PROVIDER_VERIFIED)) throw new Error('META_PROVIDER_NOT_VERIFIED');
  if (!config.META_ACCESS_TOKEN_ENV_KEY) throw new Error('META_ACCESS_TOKEN_ENV_KEY_REQUIRED');
  const secrets = new EnvSecretResolver(env, 'env');
  const client = new MetaApiClient(
    { graphBaseUrl: config.META_GRAPH_BASE_URL, apiVersion: config.META_GRAPH_API_VERSION },
    secrets,
    { provider: 'env', key: config.META_ACCESS_TOKEN_ENV_KEY },
  );
  return new InstagramGraphEngagementProvider(client);
}

function disabledProvider(): InstagramEngagementProvider {
  return {
    replyToComment(): Promise<{ readonly commentId: string }> {
      return Promise.reject(new Error('INSTAGRAM_ENGAGEMENT_WRITES_DISABLED'));
    },
    sendDirectReply(): Promise<{ readonly recipientId: string; readonly messageId: string }> {
      return Promise.reject(new Error('INSTAGRAM_ENGAGEMENT_WRITES_DISABLED'));
    },
  };
}

function retryDelayMs(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempt - 1), 60_000);
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
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
