import { createHash } from 'node:crypto';
import type pg from 'pg';
import { PostgresTransactionalOutbox } from '../events/postgres-transactional-outbox.js';
import type { TransactionalOutboxWriter } from '../events/transactional-outbox.js';
import {
  createInstagramEngagementInboundEnvelope,
  type InstagramEngagementScope,
} from '../instagram-engagement/events.js';
import type { InstagramWebhookEvent } from '../providers/instagram/instagram-engagement-contracts.js';

export interface MetaWebhookPersistResult {
  readonly accepted: readonly InstagramWebhookEvent[];
  readonly duplicates: readonly InstagramWebhookEvent[];
}

export interface PostgresMetaWebhookEventStoreOptions {
  readonly outbox?: TransactionalOutboxWriter;
  readonly engagementScope?: InstagramEngagementScope;
}

export class PostgresMetaWebhookEventStore {
  private readonly options: PostgresMetaWebhookEventStoreOptions;

  constructor(
    private readonly pool: pg.Pool,
    options?: PostgresMetaWebhookEventStoreOptions,
  ) {
    this.options = options ?? defaultOptions(pool, process.env);
    if (Boolean(this.options.outbox) !== Boolean(this.options.engagementScope)) {
      throw new Error('META_WEBHOOK_ENGAGEMENT_OUTBOX_SCOPE_REQUIRED');
    }
  }

  async persist(events: readonly InstagramWebhookEvent[]): Promise<MetaWebhookPersistResult> {
    if (events.length === 0) return { accepted: [], duplicates: [] };

    const client = await this.pool.connect();
    const accepted: InstagramWebhookEvent[] = [];
    const duplicates: InstagramWebhookEvent[] = [];

    try {
      await client.query('begin');
      for (const event of events) {
        const occurredAt = event.occurredAt ?? new Date().toISOString();
        const normalizedEvent: InstagramWebhookEvent = { ...event, occurredAt };
        const textSha256 = event.text
          ? createHash('sha256').update(event.text, 'utf8').digest('hex')
          : null;
        const result = await client.query(
          `insert into meta_webhook_events
             (event_id, channel, occurred_at, sender_scoped_id, provider_message_id, text_sha256)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (event_id) do nothing
           returning event_id`,
          [
            event.eventId,
            event.channel,
            occurredAt,
            event.senderId ?? null,
            event.messageId ?? null,
            textSha256,
          ],
        );

        if (result.rowCount === 1) {
          accepted.push(normalizedEvent);
          await client.query(
            `insert into audit_events
               (correlation_id, tool_name, risk_class, decision, normalized_payload, provider_result)
             values ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
            [
              event.eventId,
              'instagram.engagement.webhook.receive',
              'READ',
              'ACCEPTED',
              JSON.stringify({
                channel: event.channel,
                occurredAt,
                hasSenderScopedId: Boolean(event.senderId),
                hasProviderMessageId: Boolean(event.messageId),
                hasTextHash: Boolean(textSha256),
              }),
              JSON.stringify({ provider: 'meta', deduplicated: false }),
            ],
          );

          if (this.options.outbox && this.options.engagementScope) {
            await this.options.outbox.enqueue(
              client,
              createInstagramEngagementInboundEnvelope(
                normalizedEvent,
                this.options.engagementScope,
                occurredAt,
              ),
              { maxAttempts: 5 },
            );
          }
        } else {
          duplicates.push(normalizedEvent);
        }
      }
      await client.query('commit');
      return { accepted, duplicates };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}

function defaultOptions(
  pool: pg.Pool,
  env: NodeJS.ProcessEnv,
): PostgresMetaWebhookEventStoreOptions {
  if (!isTrue(env.INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED)) return {};
  const tenantId = requiredEnv(env, 'INSTAGRAM_ENGAGEMENT_TENANT_ID');
  const workspaceId = env.INSTAGRAM_ENGAGEMENT_WORKSPACE_ID?.trim() || tenantId;
  const organizationId = env.INSTAGRAM_ENGAGEMENT_ORGANIZATION_ID?.trim() || tenantId;
  return {
    outbox: new PostgresTransactionalOutbox(pool),
    engagementScope: { tenantId, workspaceId, organizationId },
  };
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key}_REQUIRED`);
  return value;
}

function isTrue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}
