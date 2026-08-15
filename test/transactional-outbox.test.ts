import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { createDomainEvent } from '../src/events/domain-events.js';
import {
  OutboxDispatcher,
  type EventTransport,
  type OutboxDispatcherLogger,
} from '../src/events/outbox-dispatcher.js';
import type {
  ClaimedOutboxEvent,
  DomainEventEnvelope,
  EventOutboxStore,
  OutboxRecord,
} from '../src/events/transactional-outbox.js';

const baseEvent = (eventKey: string): DomainEventEnvelope =>
  createDomainEvent({
    eventKey,
    eventType: 'workflow.step_succeeded',
    aggregateType: 'workflow',
    aggregateId: 'workflow-1',
    aggregateVersion: 7,
    tenantId: 'toca-do-morcego',
    workspaceId: 'toca-do-morcego',
    organizationId: 'toca-do-morcego',
    correlationId: 'corr-1',
    occurredAt: '2026-08-15T03:00:00Z',
    payload: { stepId: 'step-1' },
    evidence: ['workflow-event:source-1'],
  });

const claimedEvent = (): ClaimedOutboxEvent => {
  const event = baseEvent('source-1');
  const record: OutboxRecord = {
    ...event,
    status: 'CLAIMED',
    availableAt: event.occurredAt,
    attempts: 1,
    maxAttempts: 3,
    claimedBy: 'worker-1',
    claimExecutionId: 'delivery-1',
    claimedAt: event.occurredAt,
    deliveredAt: null,
    lastErrorCode: null,
    version: 2,
  };
  return {
    record,
    delivery: {
      executionId: 'delivery-1',
      eventId: event.eventId,
      workerId: 'worker-1',
      attemptNumber: 1,
      status: 'CLAIMED',
      claimedAt: event.occurredAt,
      completedAt: null,
      errorCode: null,
      evidence: [],
    },
  };
};

class FakeOutboxStore implements EventOutboxStore {
  delivered = 0;
  failed = 0;
  nextAttemptAt: string | undefined;
  readonly claimed = claimedEvent();

  enqueue(client: pg.PoolClient, event: DomainEventEnvelope): Promise<void> {
    void client;
    void event;
    return Promise.resolve();
  }

  get(eventId: string): Promise<OutboxRecord | undefined> {
    return Promise.resolve(eventId === this.claimed.record.eventId ? this.claimed.record : undefined);
  }

  claimAvailable(): Promise<readonly ClaimedOutboxEvent[]> {
    return Promise.resolve([this.claimed]);
  }

  markDelivered(): Promise<OutboxRecord> {
    this.delivered += 1;
    return Promise.resolve({
      ...this.claimed.record,
      status: 'DELIVERED',
      deliveredAt: '2026-08-15T03:00:01Z',
    });
  }

  markFailed(input: {
    readonly nextAttemptAt?: string;
  }): Promise<OutboxRecord> {
    this.failed += 1;
    this.nextAttemptAt = input.nextAttemptAt;
    return Promise.resolve({
      ...this.claimed.record,
      status: 'FAILED_RETRYABLE',
      lastErrorCode: 'NETWORK_DOWN',
    });
  }

  recoverStaleClaims(): Promise<readonly string[]> {
    return Promise.resolve([]);
  }

  beginConsumerReceipt(): Promise<'CLAIMED' | 'ALREADY_PROCESSED' | 'IN_PROGRESS'> {
    return Promise.resolve('CLAIMED');
  }

  completeConsumerReceipt(): Promise<void> {
    return Promise.resolve();
  }
}

const logger: OutboxDispatcherLogger = {
  info: () => undefined,
  error: () => undefined,
};

describe('M-FOUND-07 domain event identity', () => {
  it('uses the durable eventKey so same-type/version workflow events never collide', () => {
    const first = baseEvent('workflow-event-a');
    const same = baseEvent('workflow-event-a');
    const second = baseEvent('workflow-event-b');

    expect(first.eventId).toBe(same.eventId);
    expect(first.eventId).not.toBe(second.eventId);
    expect(first.eventKey).toBe('workflow-event-a');
  });

  it('includes tenant identity in deterministic event IDs', () => {
    const first = baseEvent('workflow-event-a');
    const otherTenant = createDomainEvent({
      eventKey: 'workflow-event-a',
      eventType: first.eventType,
      aggregateType: first.aggregateType,
      aggregateId: first.aggregateId,
      aggregateVersion: first.aggregateVersion,
      tenantId: 'other-tenant',
      workspaceId: 'other-workspace',
      organizationId: 'other-org',
      correlationId: first.correlationId,
      occurredAt: first.occurredAt,
      payload: first.payload,
      evidence: ['workflow-event:source-2'],
    });
    expect(otherTenant.eventId).not.toBe(first.eventId);
  });
});

describe('M-FOUND-07 outbox dispatcher', () => {
  it('marks a claimed event delivered only after transport evidence returns', async () => {
    const store = new FakeOutboxStore();
    const transport: EventTransport = {
      deliver: () => Promise.resolve({ evidence: ['transport://delivered/message-1'] }),
    };
    const dispatcher = new OutboxDispatcher({
      store,
      transport,
      workerId: 'worker-1',
      logger,
      retry: { baseDelayMs: 1_000, maxDelayMs: 60_000 },
      now: () => new Date('2026-08-15T03:00:01Z'),
    });

    await expect(dispatcher.runOnce()).resolves.toBe(1);
    expect(store.delivered).toBe(1);
    expect(store.failed).toBe(0);
  });

  it('turns transport failure into a bounded retry instead of dropping the event', async () => {
    const store = new FakeOutboxStore();
    const transport: EventTransport = {
      deliver: () => Promise.reject(new Error('NETWORK_DOWN')),
    };
    const dispatcher = new OutboxDispatcher({
      store,
      transport,
      workerId: 'worker-1',
      logger,
      retry: { baseDelayMs: 2_000, maxDelayMs: 60_000 },
      now: () => new Date('2026-08-15T03:00:01Z'),
    });

    await expect(dispatcher.runOnce()).resolves.toBe(1);
    expect(store.delivered).toBe(0);
    expect(store.failed).toBe(1);
    expect(store.nextAttemptAt).toBe('2026-08-15T03:00:03.000Z');
  });
});
