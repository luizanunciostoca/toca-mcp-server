import { describe, expect, it, vi } from 'vitest';
import type { ScheduledJob } from '../src/scheduler/scheduler-contracts.js';
import { InstagramPublicationRuntimeGate } from '../src/worker/instagram-publication-runtime-gate.js';
import type { JobHandler } from '../src/worker/worker.js';

const job: ScheduledJob = {
  id: 'job-1',
  toolName: 'internal.instagram.publication.execute',
  payload: { example: true },
  runAt: '2026-08-12T14:00:00.000Z',
  timezone: 'America/Bahia',
  idempotencyKey: 'internal:instagram:publication:test',
  status: 'RUNNING',
  attempts: 1,
};

describe('InstagramPublicationRuntimeGate', () => {
  it('blocks execution before the delegate when publication writes are disabled', async () => {
    const execute = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const gate = new InstagramPublicationRuntimeGate(false, { execute } as JobHandler);

    await expect(gate.execute(job.payload, job)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_WRITES_DISABLED',
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('delegates execution when publication writes are explicitly enabled', async () => {
    const execute = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const gate = new InstagramPublicationRuntimeGate(true, { execute } as JobHandler);

    await expect(gate.execute(job.payload, job)).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledOnce();
  });
});
