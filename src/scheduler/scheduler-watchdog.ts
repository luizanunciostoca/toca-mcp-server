import type { ScheduledJob } from './scheduler-contracts.js';

export const SCHEDULER_WATCHDOG_STATUSES = ['HEALTHY', 'DEGRADED', 'UNHEALTHY'] as const;
export type SchedulerWatchdogStatus = (typeof SCHEDULER_WATCHDOG_STATUSES)[number];

export interface SchedulerWatchdogThresholds {
  readonly maxPollSilenceMs: number;
  readonly maxClaimSilenceMs: number;
  readonly maxDueAgeMs: number;
  readonly maxRunningAgeMs: number;
  readonly maxExecutionLatencyMs: number;
  readonly maxPublicationLagMs: number;
  readonly maxDeadLetterBacklog: number;
  readonly maxReconciliationSilenceMs: number;
}

export interface SchedulerWatchdogState {
  readonly lastPollAt?: string;
  readonly lastClaimAt?: string;
  readonly lastSuccessfulExecutionAt?: string;
  readonly lastReconciliationAt?: string;
  readonly lastExecutionLatencyMs?: number;
  readonly deadLetterBacklog: number;
}

export interface SchedulerWatchdogSnapshot {
  readonly status: SchedulerWatchdogStatus;
  readonly evaluatedAt: string;
  readonly lastPollAt: string | null;
  readonly lastClaimAt: string | null;
  readonly lastSuccessfulExecutionAt: string | null;
  readonly lastReconciliationAt: string | null;
  readonly oldestDueJobAt: string | null;
  readonly oldestDueJobAgeMs: number | null;
  readonly dueBacklog: number;
  readonly runningBacklog: number;
  readonly staleRunningBacklog: number;
  readonly failedBacklog: number;
  readonly deadLetterBacklog: number;
  readonly executionLatencyMs: number | null;
  readonly publicationLagMs: number | null;
  readonly reasonCodes: readonly string[];
  readonly evidence: readonly string[];
}

export const DEFAULT_SCHEDULER_WATCHDOG_THRESHOLDS: SchedulerWatchdogThresholds = Object.freeze({
  maxPollSilenceMs: 2 * 60_000,
  maxClaimSilenceMs: 2 * 60_000,
  maxDueAgeMs: 5 * 60_000,
  maxRunningAgeMs: 10 * 60_000,
  maxExecutionLatencyMs: 5 * 60_000,
  maxPublicationLagMs: 10 * 60_000,
  maxDeadLetterBacklog: 0,
  maxReconciliationSilenceMs: 15 * 60_000,
});

export function evaluateSchedulerWatchdog(
  jobs: readonly ScheduledJob[],
  state: SchedulerWatchdogState,
  options: {
    readonly now?: string;
    readonly thresholds?: SchedulerWatchdogThresholds;
  } = {},
): SchedulerWatchdogSnapshot {
  const now = options.now ?? new Date().toISOString();
  const nowEpoch = parseTimestamp(now, 'SCHEDULER_WATCHDOG_NOW_INVALID');
  const thresholds = options.thresholds ?? DEFAULT_SCHEDULER_WATCHDOG_THRESHOLDS;
  assertThresholds(thresholds);
  if (!Number.isSafeInteger(state.deadLetterBacklog) || state.deadLetterBacklog < 0) {
    throw new Error('SCHEDULER_WATCHDOG_DLQ_INVALID');
  }

  const due = jobs.filter(
    (job) =>
      job.status === 'SCHEDULED' &&
      parseTimestamp(job.runAt, 'SCHEDULER_JOB_RUN_AT_INVALID') <= nowEpoch,
  );
  const running = jobs.filter((job) => job.status === 'RUNNING');
  const staleRunning = running.filter((job) => {
    const reference = job.updatedAt ?? job.runAt;
    return (
      nowEpoch - parseTimestamp(reference, 'SCHEDULER_JOB_UPDATED_AT_INVALID') >
      thresholds.maxRunningAgeMs
    );
  });
  const failed = jobs.filter((job) => job.status === 'FAILED');
  const oldestDue = [...due].sort(
    (left, right) => Date.parse(left.runAt) - Date.parse(right.runAt),
  )[0];
  const oldestDueJobAgeMs = oldestDue ? Math.max(0, nowEpoch - Date.parse(oldestDue.runAt)) : null;
  const publicationLagMs =
    due.length + running.length > 0
      ? Math.max(0, ...[...due, ...running].map((job) => nowEpoch - Date.parse(job.runAt)))
      : null;

  const reasons: string[] = [];
  assertTimestampState(state, nowEpoch);
  if (!state.lastPollAt || age(nowEpoch, state.lastPollAt) > thresholds.maxPollSilenceMs) {
    reasons.push('SCHEDULER_POLL_STALE');
  }
  if (!state.lastClaimAt || age(nowEpoch, state.lastClaimAt) > thresholds.maxClaimSilenceMs) {
    reasons.push('SCHEDULER_CLAIM_STALE');
  }
  if (
    !state.lastReconciliationAt ||
    age(nowEpoch, state.lastReconciliationAt) > thresholds.maxReconciliationSilenceMs
  ) {
    reasons.push('SCHEDULER_RECONCILIATION_STALE');
  }
  if (oldestDueJobAgeMs !== null && oldestDueJobAgeMs > thresholds.maxDueAgeMs) {
    reasons.push('SCHEDULER_DUE_BACKLOG_STALE');
  }
  if (staleRunning.length > 0) reasons.push('SCHEDULER_RUNNING_STALE');
  if (
    state.lastExecutionLatencyMs !== undefined &&
    state.lastExecutionLatencyMs > thresholds.maxExecutionLatencyMs
  ) {
    reasons.push('SCHEDULER_EXECUTION_LATENCY_HIGH');
  }
  if (publicationLagMs !== null && publicationLagMs > thresholds.maxPublicationLagMs) {
    reasons.push('SCHEDULER_PUBLICATION_LAG_HIGH');
  }
  if (state.deadLetterBacklog > thresholds.maxDeadLetterBacklog) {
    reasons.push('SCHEDULER_DEAD_LETTER_BACKLOG');
  }

  const critical = new Set([
    'SCHEDULER_POLL_STALE',
    'SCHEDULER_CLAIM_STALE',
    'SCHEDULER_RUNNING_STALE',
    'SCHEDULER_DEAD_LETTER_BACKLOG',
  ]);
  const status: SchedulerWatchdogStatus =
    reasons.length === 0
      ? 'HEALTHY'
      : reasons.some((reason) => critical.has(reason))
        ? 'UNHEALTHY'
        : 'DEGRADED';

  return {
    status,
    evaluatedAt: now,
    lastPollAt: state.lastPollAt ?? null,
    lastClaimAt: state.lastClaimAt ?? null,
    lastSuccessfulExecutionAt: state.lastSuccessfulExecutionAt ?? null,
    lastReconciliationAt: state.lastReconciliationAt ?? null,
    oldestDueJobAt: oldestDue?.runAt ?? null,
    oldestDueJobAgeMs,
    dueBacklog: due.length,
    runningBacklog: running.length,
    staleRunningBacklog: staleRunning.length,
    failedBacklog: failed.length,
    deadLetterBacklog: state.deadLetterBacklog,
    executionLatencyMs: state.lastExecutionLatencyMs ?? null,
    publicationLagMs,
    reasonCodes: [...new Set(reasons)].sort(),
    evidence: buildEvidence(jobs, state, now),
  };
}

export class SchedulerWatchdog {
  #state: SchedulerWatchdogState = { deadLetterBacklog: 0 };

  constructor(
    private readonly thresholds: SchedulerWatchdogThresholds = DEFAULT_SCHEDULER_WATCHDOG_THRESHOLDS,
    private readonly now: () => Date = () => new Date(),
  ) {}

  recordPoll(at = this.now().toISOString()): void {
    assertMonotonic(this.#state.lastPollAt, at, 'SCHEDULER_WATCHDOG_POLL_NON_MONOTONIC');
    this.#state = { ...this.#state, lastPollAt: at };
  }

  recordClaim(at = this.now().toISOString()): void {
    assertMonotonic(this.#state.lastClaimAt, at, 'SCHEDULER_WATCHDOG_CLAIM_NON_MONOTONIC');
    this.#state = { ...this.#state, lastClaimAt: at };
  }

  recordExecution(
    outcome: 'SUCCEEDED' | 'FAILED',
    latencyMs: number,
    at = this.now().toISOString(),
  ): void {
    if (!Number.isSafeInteger(latencyMs) || latencyMs < 0) {
      throw new Error('SCHEDULER_WATCHDOG_EXECUTION_LATENCY_INVALID');
    }
    this.#state = {
      ...this.#state,
      lastExecutionLatencyMs: latencyMs,
      ...(outcome === 'SUCCEEDED' ? { lastSuccessfulExecutionAt: at } : {}),
    };
  }

  recordReconciliation(at = this.now().toISOString()): void {
    assertMonotonic(
      this.#state.lastReconciliationAt,
      at,
      'SCHEDULER_WATCHDOG_RECONCILIATION_NON_MONOTONIC',
    );
    this.#state = { ...this.#state, lastReconciliationAt: at };
  }

  setDeadLetterBacklog(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error('SCHEDULER_WATCHDOG_DLQ_INVALID');
    }
    this.#state = { ...this.#state, deadLetterBacklog: count };
  }

  snapshot(
    jobs: readonly ScheduledJob[],
    at = this.now().toISOString(),
  ): SchedulerWatchdogSnapshot {
    return evaluateSchedulerWatchdog(jobs, this.#state, { now: at, thresholds: this.thresholds });
  }

  state(): SchedulerWatchdogState {
    return { ...this.#state };
  }
}

function assertTimestampState(state: SchedulerWatchdogState, nowEpoch: number): void {
  for (const [name, value] of Object.entries({
    lastPollAt: state.lastPollAt,
    lastClaimAt: state.lastClaimAt,
    lastSuccessfulExecutionAt: state.lastSuccessfulExecutionAt,
    lastReconciliationAt: state.lastReconciliationAt,
  })) {
    if (!value) continue;
    const epoch = parseTimestamp(value, `SCHEDULER_WATCHDOG_TIMESTAMP_INVALID:${name}`);
    if (epoch > nowEpoch) throw new Error(`SCHEDULER_WATCHDOG_TIMESTAMP_FROM_FUTURE:${name}`);
  }
}

function assertThresholds(value: SchedulerWatchdogThresholds): void {
  for (const [name, threshold] of Object.entries(value)) {
    if (!Number.isSafeInteger(threshold) || threshold < 0) {
      throw new Error(`SCHEDULER_WATCHDOG_THRESHOLD_INVALID:${name}`);
    }
  }
}

function assertMonotonic(previous: string | undefined, next: string, code: string): void {
  const nextEpoch = parseTimestamp(next, `${code}:INVALID`);
  if (previous && nextEpoch < Date.parse(previous)) throw new Error(code);
}

function age(nowEpoch: number, timestamp: string): number {
  return nowEpoch - parseTimestamp(timestamp, 'SCHEDULER_WATCHDOG_TIMESTAMP_INVALID');
}

function parseTimestamp(value: string, code: string): number {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new Error(code);
  return epoch;
}

function buildEvidence(
  jobs: readonly ScheduledJob[],
  state: SchedulerWatchdogState,
  now: string,
): readonly string[] {
  return [
    `scheduler:watchdog:evaluated-at:${now}`,
    `scheduler:watchdog:jobs:${jobs.length}`,
    `scheduler:watchdog:dlq:${state.deadLetterBacklog}`,
    ...(state.lastPollAt ? [`scheduler:watchdog:last-poll:${state.lastPollAt}`] : []),
    ...(state.lastClaimAt ? [`scheduler:watchdog:last-claim:${state.lastClaimAt}`] : []),
    ...(state.lastReconciliationAt
      ? [`scheduler:watchdog:last-reconciliation:${state.lastReconciliationAt}`]
      : []),
  ].sort();
}
