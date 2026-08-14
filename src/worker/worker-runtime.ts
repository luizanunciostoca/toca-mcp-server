import type pg from 'pg';
import { RuntimeTelemetry, type Telemetry } from '../core/observability.js';
import { JsonConsoleLogger, type StructuredLogger } from '../core/structured-logger.js';
import { PostgresScheduler } from '../scheduler/postgres-scheduler.js';
import { PostgresDeadLetterSink } from './postgres-dead-letter.js';
import {
  MapJobHandlerRegistry,
  SchedulerWorker,
  type JobHandler,
  type RetryPolicy,
} from './worker.js';

export interface WorkerRuntimeOptions {
  readonly pool: pg.Pool;
  readonly handlers: ReadonlyMap<string, JobHandler>;
  readonly telemetry?: Telemetry;
  readonly logger?: StructuredLogger;
  readonly retry?: RetryPolicy;
  readonly batchSize?: number;
  readonly claimToolName?: string;
}

export async function runWorkerBatch(options: WorkerRuntimeOptions): Promise<number> {
  const logger = options.logger ?? new JsonConsoleLogger();
  const telemetry = options.telemetry ?? new RuntimeTelemetry(logger);
  const worker = new SchedulerWorker({
    scheduler: new PostgresScheduler(options.pool),
    handlers: new MapJobHandlerRegistry(options.handlers),
    deadLetters: new PostgresDeadLetterSink(options.pool),
    telemetry,
    logger,
    retry: options.retry ?? {
      maxAttempts: 5,
      baseDelayMs: 30_000,
      maxDelayMs: 30 * 60_000,
    },
    ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize }),
    ...(options.claimToolName === undefined ? {} : { claimToolName: options.claimToolName }),
  });

  const started = Date.now();
  try {
    const claimed = await worker.runOnce();
    telemetry.increment('worker.batch.succeeded');
    telemetry.record('worker.batch.claimed_jobs', claimed);
    telemetry.record('worker.batch.duration_ms', Date.now() - started, { outcome: 'success' });
    logger.info('worker.batch.completed', { claimed });
    return claimed;
  } catch (error) {
    telemetry.increment('worker.batch.failed');
    telemetry.record('worker.batch.duration_ms', Date.now() - started, { outcome: 'failure' });
    throw error;
  }
}
