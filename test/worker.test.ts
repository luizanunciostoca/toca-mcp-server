import { describe, expect, it } from 'vitest';
import { NoopTelemetry } from '../src/core/observability.js';
import { InMemoryScheduler } from '../src/scheduler/in-memory-scheduler.js';
import {
  MapJobHandlerRegistry,
  SchedulerWorker,
  type DeadLetterRecord,
  type DeadLetterSink,
  type WorkerLogger,
} from '../src/worker/worker.js';

class MemoryDeadLetters implements DeadLetterSink {
  readonly records: DeadLetterRecord[] = [];
  put(record: DeadLetterRecord): Promise<void> {
    this.records.push(record);
    return Promise.resolve();
  }
}

const logger: WorkerLogger = {
  info: () => undefined,
  error: () => undefined,
};

function createWorker(
  scheduler: InMemoryScheduler,
  deadLetters: MemoryDeadLetters,
  maxAttempts: number,
) {
  return new SchedulerWorker({
    scheduler,
    handlers: new MapJobHandlerRegistry(
      new Map([
        [
          'test.fail',
          {
            execute: () => Promise.reject(new Error('boom')),
          },
        ],
      ]),
    ),
    deadLetters,
    telemetry: new NoopTelemetry(),
    logger,
    retry: { maxAttempts, baseDelayMs: 1_000, maxDelayMs: 10_000 },
    now: () => new Date('2026-08-09T12:00:00.000Z'),
    createId: () => 'retry-id',
  });
}

describe('SchedulerWorker', () => {
  it('schedules a retry before the maximum attempt count', async () => {
    const scheduler = new InMemoryScheduler();
    const deadLetters = new MemoryDeadLetters();
    await scheduler.schedule({
      id: 'job-1',
      toolName: 'test.fail',
      payload: { x: 1 },
      runAt: '2026-08-09T11:59:00.000Z',
      timezone: 'America/Bahia',
      idempotencyKey: 'key-1',
    });

    const worker = createWorker(scheduler, deadLetters, 3);
    expect(await worker.runOnce()).toBe(1);
    expect((await scheduler.get('job-1'))?.status).toBe('FAILED');
    expect(await scheduler.get('retry-id')).toMatchObject({
      status: 'SCHEDULED',
      idempotencyKey: 'key-1:retry:1',
      runAt: '2026-08-09T12:00:01.000Z',
    });
    expect(deadLetters.records).toHaveLength(0);
  });

  it('dead-letters a job when attempts reach the maximum', async () => {
    const scheduler = new InMemoryScheduler();
    const deadLetters = new MemoryDeadLetters();
    await scheduler.schedule({
      id: 'job-2',
      toolName: 'test.fail',
      payload: { x: 2 },
      runAt: '2026-08-09T11:59:00.000Z',
      timezone: 'America/Bahia',
      idempotencyKey: 'key-2',
    });
    await scheduler.claimDue('2026-08-09T12:00:00.000Z', 1);
    await scheduler.markFailed('job-2', 'first failure');
    await scheduler.schedule({
      id: 'job-3',
      toolName: 'test.fail',
      payload: { x: 2 },
      runAt: '2026-08-09T11:59:00.000Z',
      timezone: 'America/Bahia',
      idempotencyKey: 'key-2:retry:1',
    });
    await scheduler.claimDue('2026-08-09T12:00:00.000Z', 1);
    await scheduler.markFailed('job-3', 'second failure');
    await scheduler.schedule({
      id: 'job-final',
      toolName: 'test.fail',
      payload: { x: 2 },
      runAt: '2026-08-09T11:59:00.000Z',
      timezone: 'America/Bahia',
      idempotencyKey: 'key-2:retry:2',
    });

    const worker = createWorker(scheduler, deadLetters, 1);
    expect(await worker.runOnce()).toBe(1);
    expect(deadLetters.records).toHaveLength(1);
    expect(deadLetters.records[0]).toMatchObject({
      originalJobId: 'job-final',
      toolName: 'test.fail',
      lastError: 'Error: boom',
    });
  });

  it('claims only the configured tool name for a dedicated worker', async () => {
    const scheduler = new InMemoryScheduler();
    const deadLetters = new MemoryDeadLetters();
    const executed: string[] = [];
    await scheduler.schedule({
      id: 'publication-job',
      toolName: 'internal.instagram.publication.execute',
      payload: {},
      runAt: '2026-08-09T11:59:00.000Z',
      timezone: 'America/Bahia',
      idempotencyKey: 'publication-key',
    });
    await scheduler.schedule({
      id: 'other-job',
      toolName: 'internal.other.execute',
      payload: {},
      runAt: '2026-08-09T11:58:00.000Z',
      timezone: 'America/Bahia',
      idempotencyKey: 'other-key',
    });

    const worker = new SchedulerWorker({
      scheduler,
      handlers: new MapJobHandlerRegistry(
        new Map([
          [
            'internal.instagram.publication.execute',
            {
              execute: (_payload, job) =>
                Promise.resolve(executed.push(job.id)).then(() => undefined),
            },
          ],
        ]),
      ),
      deadLetters,
      telemetry: new NoopTelemetry(),
      logger,
      retry: { maxAttempts: 1, baseDelayMs: 1_000, maxDelayMs: 10_000 },
      claimToolName: 'internal.instagram.publication.execute',
      now: () => new Date('2026-08-09T12:00:00.000Z'),
    });

    expect(await worker.runOnce()).toBe(1);
    expect(executed).toEqual(['publication-job']);
    expect((await scheduler.get('publication-job'))?.status).toBe('SUCCEEDED');
    expect((await scheduler.get('other-job'))?.status).toBe('SCHEDULED');
  });
});
