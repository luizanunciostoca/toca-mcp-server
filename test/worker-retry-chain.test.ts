import { describe, expect, it } from 'vitest';
import { NoopTelemetry } from '../src/core/observability.js';
import { InMemoryScheduler } from '../src/scheduler/in-memory-scheduler.js';
import {
  MapJobHandlerRegistry,
  SchedulerWorker,
  type DeadLetterRecord,
  type DeadLetterSink,
} from '../src/worker/worker.js';

class MemoryDeadLetters implements DeadLetterSink {
  readonly records: DeadLetterRecord[] = [];
  put(record: DeadLetterRecord): Promise<void> {
    this.records.push(record);
    return Promise.resolve();
  }
}

describe('worker retry chain', () => {
  it('stops after the configured logical attempt count without creating retry rows', async () => {
    const scheduler = new InMemoryScheduler();
    const deadLetters = new MemoryDeadLetters();
    let now = new Date('2026-08-09T12:00:00.000Z');
    let sequence = 0;

    await scheduler.schedule({
      id: 'original',
      toolName: 'test.fail',
      payload: { x: 1 },
      runAt: now.toISOString(),
      timezone: 'America/Bahia',
      idempotencyKey: 'publication-1',
    });

    const worker = new SchedulerWorker({
      scheduler,
      handlers: new MapJobHandlerRegistry(
        new Map([['test.fail', { execute: () => Promise.reject(new Error('boom')) }]]),
      ),
      deadLetters,
      telemetry: new NoopTelemetry(),
      logger: { info: () => undefined, error: () => undefined },
      retry: { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 10_000 },
      batchSize: 1,
      now: () => now,
      createId: () => `generated-${++sequence}`,
    });

    expect(await worker.runOnce()).toBe(1);
    expect(await scheduler.list()).toHaveLength(1);
    now = new Date('2026-08-09T12:00:02.000Z');
    expect(await worker.runOnce()).toBe(1);
    expect(await scheduler.list()).toHaveLength(1);
    now = new Date('2026-08-09T12:00:05.000Z');
    expect(await worker.runOnce()).toBe(1);

    expect(deadLetters.records).toHaveLength(1);
    expect(deadLetters.records[0]).toMatchObject({
      attempts: 3,
      originalJobId: 'original',
      toolName: 'test.fail',
    });
    expect(await scheduler.get('original')).toMatchObject({ status: 'FAILED', attempts: 3 });
    expect(await scheduler.list()).toHaveLength(1);
    expect(await worker.runOnce()).toBe(0);
  });
});
