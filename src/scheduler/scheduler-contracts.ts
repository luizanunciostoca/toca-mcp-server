export const SCHEDULER_STALE_RUNNING_AFTER_MS = 10 * 60 * 1000;
export const SCHEDULER_STALE_RECOVERY_MARKER = 'WORKER_STALE_RUNNING_RECOVERED';

export type ScheduledJobStatus = 'SCHEDULED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';

export interface ScheduledJob<TPayload = unknown> {
  readonly id: string;
  readonly tenantId?: string;
  readonly toolName: string;
  readonly payload: TPayload;
  readonly runAt: string;
  readonly timezone: string;
  readonly idempotencyKey: string;
  readonly status: ScheduledJobStatus;
  readonly attempts: number;
  readonly lastError?: string;
}

export interface Scheduler {
  schedule<TPayload>(
    job: Omit<ScheduledJob<TPayload>, 'status' | 'attempts' | 'tenantId'>,
  ): Promise<ScheduledJob<TPayload>>;
  get<TPayload = unknown>(id: string): Promise<ScheduledJob<TPayload> | undefined>;
  reschedule(id: string, runAt: string, timezone: string): Promise<ScheduledJob | undefined>;
  cancel(id: string): Promise<ScheduledJob | undefined>;
  list(toolName?: string): Promise<readonly ScheduledJob[]>;
  claimDue(nowIso: string, limit: number, toolName?: string): Promise<readonly ScheduledJob[]>;
  markSucceeded(id: string): Promise<void>;
  markFailed(id: string, normalizedError: string): Promise<void>;
  retryAfterFailure?(id: string, normalizedError: string, retryAt: string): Promise<void>;
}

export interface ReconciliationResult {
  readonly status:
    'IN_SYNC' | 'LOCAL_STALE' | 'PROVIDER_UNAVAILABLE' | 'STATE_CONFLICT' | 'RESOURCE_MISSING';
  readonly localState: string;
  readonly providerState?: string;
  readonly externalResourceId?: string;
}
