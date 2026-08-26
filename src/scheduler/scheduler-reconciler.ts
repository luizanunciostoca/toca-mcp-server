import type { ScheduledJob, Scheduler } from './scheduler-contracts.js';
import type { SchedulerWatchdog } from './scheduler-watchdog.js';

export type SchedulerProviderState =
  'PUBLISHED' | 'PROCESSING' | 'NOT_FOUND' | 'UNAVAILABLE' | 'NOT_APPLICABLE';

export interface SchedulerProviderObservation {
  readonly jobId: string;
  readonly state: SchedulerProviderState;
  readonly externalResourceId?: string;
  readonly evidence: readonly string[];
  readonly observedAt: string;
}

export type SchedulerReconciliationIssueCode =
  | 'DUPLICATE_IDEMPOTENCY_KEY'
  | 'RUNNING_STALE'
  | 'PROVIDER_PUBLISHED_LOCAL_NOT_SUCCEEDED'
  | 'LOCAL_SUCCEEDED_PROVIDER_NOT_VERIFIED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PUBLICATION_OUTCOME_UNKNOWN';

export interface SchedulerReconciliationIssue {
  readonly code: SchedulerReconciliationIssueCode;
  readonly severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  readonly jobIds: readonly string[];
  readonly evidence: readonly string[];
  readonly safeRepairAvailable: boolean;
}

export interface SchedulerSafeRepairCommand {
  readonly type: 'PROMOTE_LOCAL_SUCCEEDED_AFTER_PROVIDER_READBACK';
  readonly jobId: string;
  readonly expectedLocalStatuses: readonly ['SCHEDULED', 'RUNNING', 'FAILED'];
  readonly externalResourceId: string;
  readonly evidence: readonly string[];
  readonly observedAt: string;
}

export interface SchedulerReconciliationReport {
  readonly reconciledAt: string;
  readonly scannedJobs: number;
  readonly observations: readonly SchedulerProviderObservation[];
  readonly issues: readonly SchedulerReconciliationIssue[];
  readonly safeRepairs: readonly SchedulerSafeRepairCommand[];
  readonly appliedRepairJobIds: readonly string[];
  readonly blockedJobIds: readonly string[];
  readonly healthy: boolean;
}

export interface SchedulerProviderProbe {
  observe(job: ScheduledJob): Promise<SchedulerProviderObservation>;
}

export interface SchedulerSafeRepairer {
  apply(command: SchedulerSafeRepairCommand): Promise<void>;
}

export interface SchedulerReconcilerOptions {
  readonly scheduler: Scheduler;
  readonly providerProbe: SchedulerProviderProbe;
  readonly repairer?: SchedulerSafeRepairer;
  readonly watchdog?: SchedulerWatchdog;
  readonly toolName?: string;
  readonly staleRunningAfterMs?: number;
  readonly now?: () => Date;
}

export class SchedulerReconciler {
  readonly #now: () => Date;
  readonly #staleRunningAfterMs: number;

  constructor(private readonly options: SchedulerReconcilerOptions) {
    this.#now = options.now ?? (() => new Date());
    this.#staleRunningAfterMs = options.staleRunningAfterMs ?? 10 * 60_000;
    if (!Number.isSafeInteger(this.#staleRunningAfterMs) || this.#staleRunningAfterMs < 1) {
      throw new Error('SCHEDULER_RECONCILER_STALE_THRESHOLD_INVALID');
    }
  }

  async runOnce(): Promise<SchedulerReconciliationReport> {
    const reconciledAt = this.#now().toISOString();
    const jobs = await this.options.scheduler.list(this.options.toolName);
    const observations: SchedulerProviderObservation[] = [];
    for (const job of jobs) {
      const observation = await this.options.providerProbe.observe(job);
      assertObservation(job, observation, reconciledAt);
      observations.push({ ...observation, evidence: normalizeEvidence(observation.evidence) });
    }

    const report = planSchedulerReconciliation(jobs, observations, {
      now: reconciledAt,
      staleRunningAfterMs: this.#staleRunningAfterMs,
    });
    const appliedRepairJobIds: string[] = [];
    if (this.options.repairer) {
      for (const command of report.safeRepairs) {
        await this.options.repairer.apply(command);
        appliedRepairJobIds.push(command.jobId);
      }
    }
    this.options.watchdog?.recordReconciliation(reconciledAt);
    return {
      ...report,
      appliedRepairJobIds,
    };
  }
}

export function planSchedulerReconciliation(
  jobs: readonly ScheduledJob[],
  observations: readonly SchedulerProviderObservation[],
  options: { readonly now: string; readonly staleRunningAfterMs: number },
): Omit<SchedulerReconciliationReport, 'appliedRepairJobIds'> & {
  readonly appliedRepairJobIds: readonly string[];
} {
  const nowEpoch = Date.parse(options.now);
  if (!Number.isFinite(nowEpoch)) throw new Error('SCHEDULER_RECONCILIATION_NOW_INVALID');
  if (!Number.isSafeInteger(options.staleRunningAfterMs) || options.staleRunningAfterMs < 1) {
    throw new Error('SCHEDULER_RECONCILER_STALE_THRESHOLD_INVALID');
  }
  const byJobId = new Map(observations.map((observation) => [observation.jobId, observation]));
  if (byJobId.size !== observations.length) {
    throw new Error('SCHEDULER_RECONCILIATION_OBSERVATION_DUPLICATE');
  }

  const issues: SchedulerReconciliationIssue[] = [];
  const safeRepairs: SchedulerSafeRepairCommand[] = [];
  const blocked = new Set<string>();
  const byIdempotency = new Map<string, ScheduledJob[]>();
  for (const job of jobs) {
    const siblings = byIdempotency.get(job.idempotencyKey) ?? [];
    siblings.push(job);
    byIdempotency.set(job.idempotencyKey, siblings);
  }
  for (const siblings of byIdempotency.values()) {
    const active = siblings.filter((job) => job.status !== 'CANCELED');
    if (active.length <= 1) continue;
    const jobIds = active.map((job) => job.id).sort();
    jobIds.forEach((jobId) => blocked.add(jobId));
    issues.push({
      code: 'DUPLICATE_IDEMPOTENCY_KEY',
      severity: 'CRITICAL',
      jobIds,
      evidence: [`scheduler:idempotency-key:${active[0]!.idempotencyKey}`],
      safeRepairAvailable: false,
    });
  }

  for (const job of jobs) {
    const observation = byJobId.get(job.id);
    if (!observation) {
      blocked.add(job.id);
      issues.push({
        code: 'PUBLICATION_OUTCOME_UNKNOWN',
        severity: 'HIGH',
        jobIds: [job.id],
        evidence: [`scheduler:observation:missing:${job.id}`],
        safeRepairAvailable: false,
      });
      continue;
    }

    if (
      job.status === 'RUNNING' &&
      nowEpoch - Date.parse(job.updatedAt ?? job.runAt) > options.staleRunningAfterMs
    ) {
      blocked.add(job.id);
      issues.push({
        code: 'RUNNING_STALE',
        severity: 'HIGH',
        jobIds: [job.id],
        evidence: [`scheduler:running-stale:${job.id}:${job.updatedAt ?? job.runAt}`],
        safeRepairAvailable: observation.state === 'PUBLISHED',
      });
    }

    if (observation.state === 'UNAVAILABLE') {
      blocked.add(job.id);
      issues.push({
        code: 'PROVIDER_UNAVAILABLE',
        severity: 'HIGH',
        jobIds: [job.id],
        evidence: normalizeEvidence(observation.evidence),
        safeRepairAvailable: false,
      });
      continue;
    }

    if (observation.state === 'PUBLISHED' && job.status !== 'SUCCEEDED') {
      const evidence = normalizeEvidence(observation.evidence);
      if (!observation.externalResourceId || evidence.length === 0) {
        blocked.add(job.id);
        issues.push({
          code: 'PUBLICATION_OUTCOME_UNKNOWN',
          severity: 'CRITICAL',
          jobIds: [job.id],
          evidence: [`scheduler:provider-published-without-proof:${job.id}`],
          safeRepairAvailable: false,
        });
        continue;
      }
      issues.push({
        code: 'PROVIDER_PUBLISHED_LOCAL_NOT_SUCCEEDED',
        severity: 'HIGH',
        jobIds: [job.id],
        evidence,
        safeRepairAvailable: true,
      });
      safeRepairs.push({
        type: 'PROMOTE_LOCAL_SUCCEEDED_AFTER_PROVIDER_READBACK',
        jobId: job.id,
        expectedLocalStatuses: ['SCHEDULED', 'RUNNING', 'FAILED'],
        externalResourceId: observation.externalResourceId,
        evidence,
        observedAt: observation.observedAt,
      });
      continue;
    }

    if (
      job.status === 'SUCCEEDED' &&
      observation.state !== 'PUBLISHED' &&
      observation.state !== 'NOT_APPLICABLE'
    ) {
      blocked.add(job.id);
      issues.push({
        code: 'LOCAL_SUCCEEDED_PROVIDER_NOT_VERIFIED',
        severity: 'CRITICAL',
        jobIds: [job.id],
        evidence: normalizeEvidence(observation.evidence),
        safeRepairAvailable: false,
      });
    }
  }

  return {
    reconciledAt: options.now,
    scannedJobs: jobs.length,
    observations,
    issues: issues.sort((left, right) =>
      `${left.code}:${left.jobIds.join(',')}`.localeCompare(
        `${right.code}:${right.jobIds.join(',')}`,
      ),
    ),
    safeRepairs: safeRepairs.sort((left, right) => left.jobId.localeCompare(right.jobId)),
    appliedRepairJobIds: [],
    blockedJobIds: [...blocked].sort(),
    healthy: issues.length === 0,
  };
}

function assertObservation(
  job: ScheduledJob,
  observation: SchedulerProviderObservation,
  reconciledAt: string,
): void {
  if (observation.jobId !== job.id) {
    throw new Error(`SCHEDULER_RECONCILIATION_JOB_MISMATCH:${job.id}`);
  }
  const observedAt = Date.parse(observation.observedAt);
  if (!Number.isFinite(observedAt)) {
    throw new Error(`SCHEDULER_RECONCILIATION_OBSERVED_AT_INVALID:${job.id}`);
  }
  if (observedAt > Date.parse(reconciledAt)) {
    throw new Error(`SCHEDULER_RECONCILIATION_OBSERVATION_FROM_FUTURE:${job.id}`);
  }
  if (observation.state === 'PUBLISHED') {
    if (
      !observation.externalResourceId?.trim() ||
      normalizeEvidence(observation.evidence).length === 0
    ) {
      throw new Error(`SCHEDULER_RECONCILIATION_PUBLISHED_EVIDENCE_REQUIRED:${job.id}`);
    }
  }
}

function normalizeEvidence(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}
