import type { ScheduledJob } from '../scheduler/scheduler-contracts.js';
import { hashInstagramPublicationApprovalPayload } from './instagram-publication-boundary.js';
import {
  INSTAGRAM_PUBLICATION_JOB,
  parseInstagramPublishRequest,
} from './instagram-publication-job.js';
import type { JobHandler } from './worker.js';

export interface ControlledInstagramPublicationOptions {
  readonly payload: unknown;
  readonly handler: JobHandler;
  readonly maxAttempts?: number;
  readonly pollIntervalMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly now?: () => string;
}

export async function runControlledInstagramPublication(
  options: ControlledInstagramPublicationOptions,
): Promise<void> {
  const oneOff = parseInstagramPublishRequest(options.payload).oneOff;
  const maxAttempts = oneOff ? 1 : (options.maxAttempts ?? 20);
  const pollIntervalMs = options.pollIntervalMs ?? 3_000;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => new Date().toISOString());
  const requestSha256 = hashInstagramPublicationApprovalPayload(options.payload);
  const jobId = `controlled-instagram-publication:${requestSha256}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const job: ScheduledJob = {
      id: jobId,
      toolName: INSTAGRAM_PUBLICATION_JOB,
      payload: options.payload,
      runAt: now(),
      timezone: 'UTC',
      idempotencyKey: `controlled:${requestSha256}`,
      status: 'RUNNING',
      attempts: attempt,
    };

    try {
      await options.handler.execute(options.payload, job);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNKNOWN_PUBLICATION_ERROR';
      if (message !== 'INSTAGRAM_PUBLICATION_PROCESSING_PENDING') throw error;
      if (oneOff) {
        throw new Error('INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMED_RECONCILIATION_REQUIRED');
      }
      if (attempt === maxAttempts) {
        throw new Error('INSTAGRAM_PUBLICATION_PROCESSING_TIMEOUT');
      }
      await sleep(pollIntervalMs);
    }
  }
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
