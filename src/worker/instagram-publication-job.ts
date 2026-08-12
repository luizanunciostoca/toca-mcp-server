import { randomUUID } from 'node:crypto';
import * as z from 'zod/v4';
import type { Scheduler, ScheduledJob } from '../scheduler/scheduler-contracts.js';
import type { InstagramPublishRequest } from '../providers/instagram/instagram-contracts.js';
import type { InstagramPublicationExecutor } from '../providers/instagram/instagram-publication-executor.js';
import type { JobHandler } from './worker.js';

export const INSTAGRAM_PUBLICATION_JOB = 'internal.instagram.publication.execute';

const instagramPublishRequestSchema = z.object({
  account: z.object({
    pageId: z.string().min(1),
    instagramAccountId: z.string().min(1),
  }),
  mediaType: z.enum(['IMAGE', 'CAROUSEL', 'REEL', 'STORY']),
  mediaUrls: z.array(z.string().url()).min(1),
  caption: z.string().optional(),
  correlationId: z.string().min(1),
  idempotencyKey: z.string().min(1),
});

export class InstagramPublicationJobScheduler {
  constructor(
    private readonly scheduler: Scheduler,
    private readonly createId: () => string = randomUUID,
  ) {}

  schedule(
    request: InstagramPublishRequest,
    runAt: string,
    timezone: string,
  ): Promise<ScheduledJob<InstagramPublishRequest>> {
    const payload = instagramPublishRequestSchema.parse(request);
    return this.scheduler.schedule({
      id: this.createId(),
      toolName: INSTAGRAM_PUBLICATION_JOB,
      payload,
      runAt,
      timezone,
      idempotencyKey: `internal:instagram:publication:${request.idempotencyKey}`,
    });
  }
}

export class InstagramPublicationJobHandler implements JobHandler {
  constructor(private readonly executor: InstagramPublicationExecutor) {}

  async execute(payload: unknown): Promise<void> {
    const request = instagramPublishRequestSchema.parse(payload);
    const result = await this.executor.execute(request);
    if (!result.completed) {
      throw new Error('INSTAGRAM_PUBLICATION_PROCESSING_PENDING');
    }
  }
}
