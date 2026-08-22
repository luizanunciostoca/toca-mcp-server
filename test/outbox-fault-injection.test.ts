import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { OutboxDispatcher, type EventTransport } from '../src/events/outbox-dispatcher.js';
import { createDomainEvent } from '../src/events/domain-events.js';
import type {
  ClaimedOutboxEvent,
  DomainEventEnvelope,
  EventOutboxStore,
  OutboxRecord,
} from '../src/events/transactional-outbox.js';

const BASE = '2026-08-22T18:10:00.000Z';

function event(index: number): DomainEventEnvelope {
  return createDomainEvent({
    eventKey: `fault-${index}`,
    eventType: 'workflow.step_succeeded',
    aggregateType: 'workflow',
    aggregateId: `workflow-${index}`,
    aggregateVersion: 1,
    tenantId: 'tenant-fault',
    workspaceId: 'workspace-fault',
    organizationId: 'organization-fault',
    correlationId: `corr-${index}`,
    occurredAt: BASE,
    payload: { index },
    evidence: [`fault:event:${index}`],
  });
}

type Mutable = {
  record: OutboxRecord;
  executionId: string | null;
};

class FaultStore implements EventOutboxStore {
  readonly rows = new Map<string, Mutable>();
  claimFailures = 0;
  claimCalls = 0;
  staleRecoveries = 0;

  constructor(count: number, private readonly maxAttempts = 3) {
    for (let index = 0; index < count; index += 1) {
      const envelope = event(index);
      this.rows.set(envelope.eventId, {
        record: {
          ...envelope,
          status: 'PENDING',
          availableAt: BASE,
          attempts: 0,
          maxAttempts,
          claimedBy: null,
          claimExecutionId: null,
          claimedAt: null,
          deliveredAt: null,
          lastErrorCode: null,
          version: 1,
        },
        executionId: null,
      });
    }
  }

  enqueue(_client: pg.PoolClient, _event: DomainEventEnvelope): Promise<void> {
    return Promise.resolve();
  }

  get(eventId: string): Promise<OutboxRecord | undefined> {
    return Promise.resolve(this.rows.get(eventId)?.record);
  }

  claimAvailable(input: {
    readonly workerId: string;
    readonly now: string;
    readonly limit: number;
  }): Promise<readonly ClaimedOutboxEvent[]> {
    this.claimCalls += 1;
    if (this.claimFailures > 0) {
      this.claimFailures -= 1;
      const error = new Error('connection reset by peer');
      error.name = 'ECONNRESET';
      return Promise.reject(error);
    }
    const claims: ClaimedOutboxEvent[] = [];
    for (const mutable of this.rows.values()) {
      if (claims.length >= input.limit) break;
      if (!['PENDING', 'FAILED_RETRYABLE'].includes(mutable.record.status)) continue;
      if (mutable.record.attempts >= mutable.record.maxAttempts) continue;
      const attemptNumber = mutable.record.attempts + 1;
      const executionId = `delivery:${mutable.record.eventId}:${attemptNumber}`;
      mutable.executionId = executionId;
      mutable.record = {
        ...mutable.record,
        status: 'CLAIMED',
        attempts: attemptNumber,
        claimedBy: input.workerId,
        claimExecutionId: executionId,
        claimedAt: input.now,
        version: mutable.record.version + 1,
      };
      claims.push({
        record: mutable.record,
        delivery: {
          executionId,
          eventId: mutable.record.eventId,
          workerId: input.workerId,
          attemptNumber,
          status: 'CLAIMED',
          claimedAt: input.now,
          completedAt: null,
          errorCode: null,
          evidence: [],
        },
      });
    }
    return Promise.resolve(claims);
  }

  markDelivered(input: {
    readonly eventId: string;
    readonly executionId: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<OutboxRecord> {
    const mutable = this.requireClaim(input.eventId, input.executionId);
    mutable.record = {
      ...mutable.record,
      status: 'DELIVERED',
      deliveredAt: input.now,
      claimedBy: null,
      claimExecutionId: null,
      claimedAt: null,
      version: mutable.record.version + 1,
    };
    mutable.executionId = null;
    return Promise.resolve(mutable.record);
  }

  markFailed(input: {
    readonly eventId: string;
    readonly executionId: string;
    readonly errorCode: string;
    readonly evidence: readonly string[];
    readonly now: string;
    readonly nextAttemptAt?: string;
  }): Promise<OutboxRecord> {
    const mutable = this.requireClaim(input.eventId, input.executionId);
    const terminal = mutable.record.attempts >= mutable.record.maxAttempts;
    mutable.record = {
      ...mutable.record,
      status: terminal ? 'DEAD_LETTER' : 'FAILED_RETRYABLE',
      availableAt: input.nextAttemptAt ?? input.now,
      claimedBy: null,
      claimExecutionId: null,
      claimedAt: null,
      lastErrorCode: input.errorCode,
      version: mutable.record.version + 1,
    };
    mutable.executionId = null;
    return Promise.resolve(mutable.record);
  }

  recoverStaleClaims(): Promise<readonly string[]> {
    this.staleRecoveries += 1;
    return Promise.resolve([]);
  }

  beginConsumerReceipt(): Promise<'CLAIMED' | 'ALREADY_PROCESSED' | 'IN_PROGRESS'> {
    return Promise.resolve('CLAIMED');
  }

  completeConsumerReceipt(): Promise<void> {
    return Promise.resolve();
  }

  private requireClaim(eventId: string, executionId: string): Mutable {
    const mutable = this.rows.get(eventId);
    if (!mutable || mutable.record.status !== 'CLAIMED' || mutable.executionId !== executionId) {
      throw new Error('TEST_CLAIM_MISMATCH');
    }
    return mutable;
  }
}

function dispatcher(store: EventOutboxStore, transport: EventTransport, batchSize = 10) {
  let tick = 0;
  return new OutboxDispatcher({
    store,
    transport,
    workerId: 'fault-worker',
    logger: { info: () => undefined, error: () => undefined },
    retry: { baseDelayMs: 0, maxDelayMs: 0 },
    batchSize,
    now: () => new Date(Date.parse(BASE) + tick++ * 1000),
  });
}

describe('Outbox fault injection', () => {
  it('recovers a lost acknowledgement without a second logical effect', async () => {
    const store = new FaultStore(1);
    const logicalEffects = new Set<string>();
    let deliveries = 0;
    const transport: EventTransport = {
      async deliver(record) {
        deliveries += 1;
        const firstLogicalApplication = !logicalEffects.has(record.eventId);
        logicalEffects.add(record.eventId);
        if (deliveries === 1 && firstLogicalApplication) {
          throw new Error('LOST_ACK_AFTER_LOGICAL_EFFECT');
        }
        return { evidence: [`fake-transport:dedup:${record.eventId}`] };
      },
    };
    const worker = dispatcher(store, transport);

    expect(await worker.runOnce()).toBe(1);
    expect([...store.rows.values()][0]?.record.status).toBe('FAILED_RETRYABLE');
    expect(await worker.runOnce()).toBe(1);
    expect([...store.rows.values()][0]?.record.status).toBe('DELIVERED');
    expect(deliveries).toBe(2);
    expect(logicalEffects.size).toBe(1);
  });

  it('survives a simulated DB connection reset before claim without corrupting state', async () => {
    const store = new FaultStore(1);
    store.claimFailures = 1;
    let deliveries = 0;
    const worker = dispatcher(store, {
      deliver(record) {
        deliveries += 1;
        return Promise.resolve({ evidence: [`fake-transport:ok:${record.eventId}`] });
      },
    });

    await expect(worker.runOnce()).rejects.toThrow('connection reset by peer');
    expect(deliveries).toBe(0);
    expect([...store.rows.values()][0]?.record.status).toBe('PENDING');
    expect(await worker.runOnce()).toBe(1);
    expect(deliveries).toBe(1);
    expect([...store.rows.values()][0]?.record.status).toBe('DELIVERED');
  });

  it('drains a backlog in bounded batches with zero duplicate logical effects', async () => {
    const store = new FaultStore(37);
    const logicalEffects = new Set<string>();
    let deliveries = 0;
    const worker = dispatcher(
      store,
      {
        deliver(record) {
          deliveries += 1;
          logicalEffects.add(record.eventId);
          return Promise.resolve({ evidence: [`fake-transport:backlog:${record.eventId}`] });
        },
      },
      8,
    );

    const batchSizes: number[] = [];
    for (;;) {
      const claimed = await worker.runOnce();
      batchSizes.push(claimed);
      if (claimed === 0) break;
    }
    expect(batchSizes).toEqual([8, 8, 8, 8, 5, 0]);
    expect(deliveries).toBe(37);
    expect(logicalEffects.size).toBe(37);
    expect([...store.rows.values()].every((row) => row.record.status === 'DELIVERED')).toBe(true);
  });

  it('bounds a retry storm and ends in DEAD_LETTER without extra attempts', async () => {
    const store = new FaultStore(1, 3);
    let deliveries = 0;
    const worker = dispatcher(store, {
      deliver() {
        deliveries += 1;
        return Promise.reject(new Error('TRANSIENT_FOREVER'));
      },
    });

    expect(await worker.runOnce()).toBe(1);
    expect(await worker.runOnce()).toBe(1);
    expect(await worker.runOnce()).toBe(1);
    expect(await worker.runOnce()).toBe(0);
    expect(deliveries).toBe(3);
    expect([...store.rows.values()][0]?.record).toMatchObject({
      status: 'DEAD_LETTER',
      attempts: 3,
      lastErrorCode: 'TRANSIENT_FOREVER',
    });
  });
});
