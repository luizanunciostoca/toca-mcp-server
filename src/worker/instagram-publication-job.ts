import { randomUUID } from 'node:crypto';
import * as z from 'zod/v4';
import { creativeTruthPublicationBindingSchema } from '../contracts/creative-truth.js';
import type { Scheduler, ScheduledJob } from '../scheduler/scheduler-contracts.js';
import type { InstagramPublishRequest } from '../providers/instagram/instagram-contracts.js';
import type {
  InstagramPublicationExecutor,
} from '../providers/instagram/instagram-publication-executor.js';
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
  creativeTruthBinding: creativeTruthPublicationBindingSchema.optional(),
  publicationAssetSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
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
    const payload = parseInstagramPublishRequest(request);
    return this.scheduler.schedule({
      id: this.createId(),
      toolName: INSTAGRAM_PUBLICATION_JOB,
      payload,
      runAt,
      timezone,
      idempotencyKey: `internal:instagram:publication:${request.idempotencyKey}`,
    });
  }

  async reschedule(
    jobId: string,
    runAt: string,
    timezone: string,
  ): Promise<ScheduledJob | undefined> {
    await this.requirePublicationJob(jobId);
    return this.scheduler.reschedule(jobId, runAt, timezone);
  }

  async cancel(jobId: string): Promise<ScheduledJob | undefined> {
    await this.requirePublicationJob(jobId);
    return this.scheduler.cancel(jobId);
  }

  async status(jobId: string): Promise<ScheduledJob | undefined> {
    const job = await this.scheduler.get(jobId);
    if (!job) return undefined;
    assertPublicationJob(job);
    return job;
  }

  async listScheduled(): Promise<readonly ScheduledJob[]> {
    const jobs = await this.scheduler.list(INSTAGRAM_PUBLICATION_JOB);
    return jobs.filter((job) => job.status === 'SCHEDULED');
  }

  private async requirePublicationJob(jobId: string): Promise<ScheduledJob> {
    const job = await this.scheduler.get(jobId);
    if (!job) throw new Error('INSTAGRAM_PUBLICATION_JOB_NOT_FOUND');
    assertPublicationJob(job);
    return job;
  }
}

export class InstagramPublicationJobHandler implements JobHandler {
  constructor(private readonly executor: InstagramPublicationExecutor) {}

  async execute(payload: unknown): Promise<void> {
    const request = parseInstagramPublishRequest(payload);
    const result = await this.executor.execute(request);
    if (!result.completed) {
      throw new Error('INSTAGRAM_PUBLICATION_PROCESSING_PENDING');
    }
  }
}

function assertPublicationJob(job: ScheduledJob): void {
  if (job.toolName !== INSTAGRAM_PUBLICATION_JOB) {
    throw new Error('INSTAGRAM_PUBLICATION_JOB_MISMATCH');
  }
}

export function parseInstagramPublishRequest(value: unknown): InstagramPublishRequest {
  const parsed = instagramPublishRequestSchema.parse(value);
  return {
    account: parsed.account,
    mediaType: parsed.mediaType,
    mediaUrls: parsed.mediaUrls,
    correlationId: parsed.correlationId,
    idempotencyKey: parsed.idempotencyKey,
    ...(parsed.caption !== undefined ? { caption: parsed.caption } : {}),
    ...(parsed.creativeTruthBinding !== undefined
      ? { creativeTruthBinding: parsed.creativeTruthBinding }
      : {}),
    ...(parsed.publicationAssetSha256 !== undefined
      ? { publicationAssetSha256: parsed.publicationAssetSha256 }
      : {}),
  };
}
