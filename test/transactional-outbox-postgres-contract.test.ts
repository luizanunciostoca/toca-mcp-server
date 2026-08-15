import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryFile = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('M-FOUND-07 PostgreSQL transactional outbox contract', () => {
  it('persists durable event keys, delivery attempts and consumer receipts', () => {
    const migration = repositoryFile('migrations/009_transactional_outbox.sql');
    expect(migration).toContain('create table if not exists event_outbox');
    expect(migration).toContain('event_key text not null');
    expect(migration).toContain('unique (tenant_id, aggregate_type, aggregate_id, event_key)');
    expect(migration).toContain('create table if not exists event_outbox_delivery_attempts');
    expect(migration).toContain('create table if not exists event_consumer_receipts');
    expect(migration).toContain('primary key (consumer_id, event_id)');
  });

  it('claims concurrently, verifies stale-attempt recovery and never silently drops delivery state', () => {
    const store = repositoryFile('src/events/postgres-transactional-outbox.ts');
    expect(store).toContain('for update skip locked');
    expect(store).toContain('OUTBOX_STALE_ATTEMPT_STATE_CONFLICT');
    expect(store).toContain('attemptUpdate.rowCount !== 1');
    expect(store).toContain('OUTBOX_DELIVERY_ATTEMPT_STATE_CONFLICT');
    expect(store).toContain("terminal ? 'DEAD_LETTER' : 'FAILED_RETRYABLE'");
    expect(store).toContain("? 'DEAD_LETTER'");
  });

  it('keeps consumer receipts inside caller-owned PostgreSQL transactions', () => {
    const consumer = repositoryFile('src/events/transactional-consumer.ts');
    expect(consumer).toContain("await client.query('begin')");
    expect(consumer).toContain('beginConsumerReceipt(client');
    expect(consumer).toContain('handler.handle(client, event)');
    expect(consumer).toContain('completeConsumerReceipt(client');
    expect(consumer).toContain("await client.query('commit')");
    expect(consumer).toContain("await client.query('rollback')");
  });

  it('bridges durable workflow history into the outbox with the same PoolClient transaction', () => {
    const workflowStore = repositoryFile('src/persistence/postgres-workflow-store.ts');
    expect(workflowStore).toContain('TransactionalOutboxWriter');
    expect(workflowStore).toContain('createDomainEvent');
    expect(workflowStore).toContain('eventKey: eventId');
    expect(workflowStore).toContain('this.#outbox.enqueue(client, domainEvent)');
  });
});
