import { randomUUID } from 'node:crypto';
import type { Scheduler, ScheduledJob } from '../scheduler/scheduler-contracts.js';
import type { Telemetry } from '../core/observability.js';

export interface JobHandler {
  execute(payload: unknown, job: ScheduledJob): Promise<void>;
}

export interface JobHandlerRegistry {
  get(toolName: string): JobHandler | undefined;
}

export interface DeadLetterRecord {
  readonly id: string;
  readonly originalJobId: string;
  readonly toolName: string;
  readonly payload: unknown;
  readonly attempts: number;
  readonly lastError: string;
  readonly failedAt: string;
}

export interface DeadLetterSink {
  put(record: DeadLetterRecord): Promise<void>;
}

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export interface WorkerLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export interface WorkerOptions {
  readonly scheduler: Scheduler;
  readonly handlers: JobHandlerRegistry;
  readonly deadLetters: DeadLetterSink;
  readonly telemetry: Telemetry;
  readonly logger: WorkerLogger;
  readonly retry: RetryPolicy;
  readonly batchSize?: number;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function retryDelayMs(attempt: number, policy: RetryPolicy): number {
  const exponential = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(exponential, policy.maxDelayMs);
}

function logicalAttempt(job: ScheduledJob): number {
  const matches = [...job.idempotencyKey.matchAll(/:retry:(\d+)/g)];
  const previousRetry = matches.at(-1)?.[1];
  return Math.max(job.attempts, previousRetry ? Number(previousRetry) + 1 : 1);
}

function rootIdempotencyKey(key: string): string {
  return key.replace(/(?::retry:\d+)+$/, '');
}

export class SchedulerWorker {
  readonly #batchSize: number;
  readonly #now: () => Date;
  readonly #createId: () => string;

  constructor(private readonly options: WorkerOptions) {
    this.#batchSize = options.batchSize ?? 10;
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? randomUUID;
  }

  async runOnce(): Promise<number> {
    const startedAt = this.#now();
    const jobs = await this.options.scheduler.claimDue(startedAt.toISOString(), this.#batchSize);
    this.options.telemetry.record('worker.claimed_jobs', jobs.length);

    for (const job of jobs) {
      await this.executeJob(job);
    }

    return jobs.length;
  }

  private async executeJob(job: ScheduledJob): Promise<void> {
    const attempt = logicalAttempt(job);
    const handler = this.options.handlers.get(job.toolName);
    if (!handler) {
      await this.failOrDeadLetter(job, attempt, `HANDLER_NOT_FOUND: ${job.toolName}`);
      return;
    }

    const started = Date.now();
    this.options.logger.info('worker.job.started', {
      jobId: job.id,
      toolName: job.toolName,
      attempt,
    });

    try {
      await handler.execute(job.payload, job);
      await this.options.scheduler.markSucceeded(job.id);
      this.options.telemetry.increment('worker.job.succeeded', { toolName: job.toolName });
      this.options.telemetry.record('worker.job.duration_ms', Date.now() - started, {
        toolName: job.toolName,
        outcome: 'success',
      });
      this.options.logger.info('worker.job.succeeded', { jobId: job.id, toolName: job.toolName });
    } catch (error) {
      await this.failOrDeadLetter(job, attempt, normalizeError(error));
    }
  }

  private async failOrDeadLetter(
    job: ScheduledJob,
    attempt: number,
    normalizedError: string,
  ): Promise<void> {
    await this.options.scheduler.markFailed(job.id, normalizedError);
    this.options.telemetry.increment('worker.job.failed', { toolName: job.toolName });
    this.options.logger.error('worker.job.failed', {
      jobId: job.id,
      toolName: job.toolName,
      attempt,
      error: normalizedError,
    });

    if (attempt >= this.options.retry.maxAttempts) {
      await this.options.deadLetters.put({
        id: this.#createId(),
        originalJobId: job.id,
        toolName: job.toolName,
        payload: job.payload,
        attempts: attempt,
        lastError: normalizedError,
        failedAt: this.#now().toISOString(),
      });
      this.options.telemetry.increment('worker.job.dead_lettered', { toolName: job.toolName });
      return;
    }

    const delay = retryDelayMs(attempt, this.options.retry);
    const retryAt = new Date(this.#now().getTime() + delay).toISOString();
    await this.options.scheduler.schedule({
      id: this.#createId(),
      toolName: job.toolName,
      payload: job.payload,
      runAt: retryAt,
      timezone: job.timezone,
      idempotencyKey: `${rootIdempotencyKey(job.idempotencyKey)}:retry:${attempt}`,
    });
    this.options.telemetry.increment('worker.job.retry_scheduled', { toolName: job.toolName });
  }
}

export class MapJobHandlerRegistry implements JobHandlerRegistry {
  constructor(private readonly handlers: ReadonlyMap<string, JobHandler>) {}

  get(toolName: string): JobHandler | undefined {
    return this.handlers.get(toolName);
  }
}
