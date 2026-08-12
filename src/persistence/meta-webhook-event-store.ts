import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { InstagramWebhookEvent } from '../providers/instagram/instagram-engagement-contracts.js';

export interface MetaWebhookPersistResult {
  readonly accepted: readonly InstagramWebhookEvent[];
  readonly duplicates: readonly InstagramWebhookEvent[];
}

export class PostgresMetaWebhookEventStore {
  constructor(private readonly pool: pg.Pool) {}

  async persist(events: readonly InstagramWebhookEvent[]): Promise<MetaWebhookPersistResult> {
    if (events.length === 0) return { accepted: [], duplicates: [] };

    const client = await this.pool.connect();
    const accepted: InstagramWebhookEvent[] = [];
    const duplicates: InstagramWebhookEvent[] = [];

    try {
      await client.query('begin');
      for (const event of events) {
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
            event.occurredAt,
            event.senderId ?? null,
            event.messageId ?? null,
            textSha256,
          ],
        );

        if (result.rowCount === 1) {
          accepted.push(event);
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
                occurredAt: event.occurredAt,
                hasSenderScopedId: Boolean(event.senderId),
                hasProviderMessageId: Boolean(event.messageId),
                hasTextHash: Boolean(textSha256),
              }),
              JSON.stringify({ provider: 'meta', deduplicated: false }),
            ],
          );
        } else {
          duplicates.push(event);
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
