import type { ScheduledJob, Scheduler } from './scheduler-contracts.js';

export class InMemoryScheduler implements Scheduler {
  private readonly jobs = new Map<string, ScheduledJob>();
  private readonly idempotencyIndex = new Map<string, string>();

  schedule<TPayload>(
    job: Omit<ScheduledJob<TPayload>, 'status' | 'attempts'>,
  ): Promise<ScheduledJob<TPayload>> {
    const existingId = this.idempotencyIndex.get(job.idempotencyKey);
    if (existingId) {
      return Promise.resolve(this.jobs.get(existingId) as ScheduledJob<TPayload>);
    }

    const scheduled: ScheduledJob<TPayload> = { ...job, status: 'SCHEDULED', attempts: 0 };
    this.jobs.set(job.id, scheduled);
    this.idempotencyIndex.set(job.idempotencyKey, job.id);
    return Promise.resolve(scheduled);
  }

  get<TPayload = unknown>(id: string): Promise<ScheduledJob<TPayload> | undefined> {
    return Promise.resolve(this.jobs.get(id) as ScheduledJob<TPayload> | undefined);
  }

  reschedule(id: string, runAt: string, timezone: string): Promise<ScheduledJob | undefined> {
    const current = this.jobs.get(id);
    if (!current || current.status !== 'SCHEDULED') return Promise.resolve(current);
    const rescheduled: ScheduledJob = { ...current, runAt, timezone };
    this.jobs.set(id, rescheduled);
    return Promise.resolve(rescheduled);
  }

  cancel(id: string): Promise<ScheduledJob | undefined> {
    const current = this.jobs.get(id);
    if (!current || current.status === 'SUCCEEDED') return Promise.resolve(current);
    const canceled: ScheduledJob = { ...current, status: 'CANCELED' };
    this.jobs.set(id, canceled);
    return Promise.resolve(canceled);
  }

  list(toolName?: string): Promise<readonly ScheduledJob[]> {
    return Promise.resolve(
      [...this.jobs.values()]
        .filter((job) => toolName === undefined || job.toolName === toolName)
        .sort((left, right) => left.runAt.localeCompare(right.runAt) || left.id.localeCompare(right.id)),
    );
  }

  claimDue(nowIso: string, limit: number): Promise<readonly ScheduledJob[]> {
    const now = Date.parse(nowIso);
    const due = [...this.jobs.values()]
      .filter((job) => job.status === 'SCHEDULED' && Date.parse(job.runAt) <= now)
      .sort((a, b) => a.runAt.localeCompare(b.runAt))
      .slice(0, limit);

    for (const job of due) {
      this.jobs.set(job.id, { ...job, status: 'RUNNING', attempts: job.attempts + 1 });
    }
    return Promise.resolve(due.map((job) => this.jobs.get(job.id)!));
  }

  markSucceeded(id: string): Promise<void> {
    const current = this.requireJob(id);
    this.jobs.set(id, { ...current, status: 'SUCCEEDED' });
    return Promise.resolve();
  }

  markFailed(id: string, normalizedError: string): Promise<void> {
    const current = this.requireJob(id);
    this.jobs.set(id, { ...current, status: 'FAILED', lastError: normalizedError });
    return Promise.resolve();
  }

  private requireJob(id: string): ScheduledJob {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Scheduled job not found: ${id}`);
    return job;
  }
}
