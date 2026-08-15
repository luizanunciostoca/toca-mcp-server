import type pg from 'pg';
import type { DomainEventEnvelope, EventOutboxStore } from './transactional-outbox.js';

export interface TransactionalEventHandler {
  handle(client: pg.PoolClient, event: DomainEventEnvelope): Promise<readonly string[]>;
}

export interface TransactionalEventConsumerOptions {
  readonly pool: pg.Pool;
  readonly outbox: EventOutboxStore;
  readonly consumerId: string;
  readonly handler: TransactionalEventHandler;
  readonly now?: () => Date;
}

export type TransactionalConsumeResult = 'PROCESSED' | 'ALREADY_PROCESSED' | 'IN_PROGRESS';

export class TransactionalEventConsumer {
  readonly #now: () => Date;

  constructor(private readonly options: TransactionalEventConsumerOptions) {
    if (!options.consumerId.trim()) throw new Error('OUTBOX_CONSUMER_ID_REQUIRED');
    this.#now = options.now ?? (() => new Date());
  }

  async consume(
    event: DomainEventEnvelope,
    executionId: string,
  ): Promise<TransactionalConsumeResult> {
    if (!executionId.trim()) throw new Error('OUTBOX_CONSUMER_EXECUTION_ID_REQUIRED');
    const client = await this.options.pool.connect();
    try {
      await client.query('begin');
      const claimedAt = this.#now().toISOString();
      const receipt = await this.options.outbox.beginConsumerReceipt(client, {
        consumerId: this.options.consumerId,
        eventId: event.eventId,
        executionId,
        evidence: [`consumer:${this.options.consumerId}:claim:${executionId}`],
        now: claimedAt,
      });
      if (receipt === 'ALREADY_PROCESSED') {
        await client.query('commit');
        return 'ALREADY_PROCESSED';
      }
      if (receipt === 'IN_PROGRESS') {
        await client.query('rollback');
        return 'IN_PROGRESS';
      }

      const handlerEvidence = normalizeEvidence(await this.options.handler.handle(client, event));
      await this.options.outbox.completeConsumerReceipt(client, {
        consumerId: this.options.consumerId,
        eventId: event.eventId,
        executionId,
        evidence: handlerEvidence,
        now: this.#now().toISOString(),
      });
      await client.query('commit');
      return 'PROCESSED';
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}

function normalizeEvidence(evidence: readonly string[]): readonly string[] {
  const normalized = [...new Set(evidence.map((item) => item.trim()).filter(Boolean))].sort();
  if (normalized.length === 0) throw new Error('OUTBOX_CONSUMER_EVIDENCE_REQUIRED');
  return normalized;
}
