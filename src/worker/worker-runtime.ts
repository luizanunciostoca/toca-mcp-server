import type pg from 'pg';
import { RuntimeTelemetry, type Telemetry } from '../core/observability.js';
import { JsonConsoleLogger, type StructuredLogger } from '../core/structured-logger.js';
import { PostgresScheduler } from '../scheduler/postgres-scheduler.js';
import { SchedulerWatchdog } from '../scheduler/scheduler-watchdog.js';
import { PostgresDeadLetterSink } from './postgres-dead-letter.js';
import {
  MapJobHandlerRegistry,
  SchedulerWorker,
  type JobHandler,
  type RetryPolicy,
} from './worker.js';

export interface WorkerRuntimeOptions {
  readonly pool: pg.Pool;
  readonly tenantId: string;
  readonly handlers: ReadonlyMap<string, JobHandler>;
  readonly telemetry?: Telemetry;
  readonly logger?: StructuredLogger;
  readonly retry?: RetryPolicy;
  readonly batchSize?: number;
  readonly claimToolName?: string;
  readonly watchdog?: SchedulerWatchdog;
}

export async function runWorkerBatch(options: WorkerRuntimeOptions): Promise<number> {
  const logger = options.logger ?? new JsonConsoleLogger();
  const telemetry = options.telemetry ?? new RuntimeTelemetry(logger);
  const scheduler = new PostgresScheduler(options.pool, options.tenantId);
  const watchdog = options.watchdog ?? new SchedulerWatchdog();
  const worker = new SchedulerWorker({
    scheduler,
    handlers: new MapJobHandlerRegistry(options.handlers),
    deadLetters: new PostgresDeadLetterSink(options.pool, options.tenantId),
    telemetry,
    logger,
    retry: options.retry ?? {
      maxAttempts: 5,
      baseDelayMs: 30_000,
      maxDelayMs: 30 * 60_000,
    },
    ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize }),
    ...(options.claimToolName === undefined ? {} : { claimToolName: options.claimToolName }),
    watchdog,
  });

  const started = Date.now();
  try {
    const claimed = await worker.runOnce();
    telemetry.increment('worker.batch.succeeded');
    telemetry.record('worker.batch.claimed_jobs', claimed);
    telemetry.record('worker.batch.duration_ms', Date.now() - started, { outcome: 'success' });
    const watchdogSnapshot = watchdog.snapshot(await scheduler.list(options.claimToolName));
    telemetry.record('scheduler.watchdog.due_backlog', watchdogSnapshot.dueBacklog);
    telemetry.record('scheduler.watchdog.running_backlog', watchdogSnapshot.runningBacklog);
    telemetry.record('scheduler.watchdog.dead_letter_backlog', watchdogSnapshot.deadLetterBacklog);
    telemetry.record(
      'scheduler.watchdog.publication_lag_ms',
      watchdogSnapshot.publicationLagMs ?? 0,
    );
    logger.info('scheduler.watchdog.snapshot', { ...watchdogSnapshot });
    logger.info('worker.batch.completed', { claimed });
    return claimed;
  } catch (error) {
    telemetry.increment('worker.batch.failed');
    telemetry.record('worker.batch.duration_ms', Date.now() - started, { outcome: 'failure' });
    throw error;
  }
}
