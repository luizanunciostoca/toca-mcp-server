import type { ScheduledJob } from '../scheduler/scheduler-contracts.js';
import type { JobHandler } from './worker.js';

export class InstagramPublicationRuntimeGate implements JobHandler {
  constructor(
    private readonly writesEnabled: boolean,
    private readonly delegate: JobHandler,
  ) {}

  execute(payload: unknown, job: ScheduledJob): Promise<void> {
    if (!this.writesEnabled) {
      return Promise.reject(new Error('INSTAGRAM_PUBLICATION_WRITES_DISABLED'));
    }
    return this.delegate.execute(payload, job);
  }
}
