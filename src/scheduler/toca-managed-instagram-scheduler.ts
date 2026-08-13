import { createHash, randomUUID } from 'node:crypto';
import * as z from 'zod/v4';
import type { InstagramPublishRequest } from '../providers/instagram/instagram-contracts.js';
import type { InstagramPublicationExecutor } from '../providers/instagram/instagram-publication-executor.js';
import type { JobHandler } from '../worker/worker.js';
import type { ScheduledJob, Scheduler } from './scheduler-contracts.js';

export const TOCA_MANAGED_INSTAGRAM_PUBLICATION_JOB =
  'internal.instagram.publication.toca-managed.execute';

export const tocaManagedApprovalStatusSchema = z.enum(['APPROVED', 'PREAPPROVED_CLASS']);

export const tocaManagedInstagramApprovalDescriptorSchema = z.object({
  schemaVersion: z.literal(1),
  contentItemId: z.string().min(1),
  scheduledFor: z.string().datetime({ offset: true }),
  timezone: z.string().min(1),
  account: z.object({
    pageId: z.string().min(1),
    instagramAccountId: z.string().min(1),
  }),
  mediaType: z.enum(['IMAGE', 'CAROUSEL', 'REEL', 'STORY']),
  asset: z.object({
    assetId: z.string().min(1),
    objectName: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  }),
  caption: z.string().optional(),
  correlationId: z.string().min(1),
  publicationIdempotencyKey: z.string().min(1),
});

export const tocaManagedInstagramSchedulePayloadSchema =
  tocaManagedInstagramApprovalDescriptorSchema.extend({
    approval: z.object({
      mode: z.enum(['EXPLICIT_APPROVAL', 'PREAPPROVED_CLASS']),
      status: tocaManagedApprovalStatusSchema,
      approvedDescriptorSha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  });

export type TocaManagedInstagramApprovalDescriptor = z.infer<
  typeof tocaManagedInstagramApprovalDescriptorSchema
>;
export type TocaManagedInstagramSchedulePayload = z.infer<
  typeof tocaManagedInstagramSchedulePayloadSchema
>;

export interface PublicationAssetDeliveryProvider {
  createDeliveryUrl(objectName: string): Promise<string>;
}

export class TocaManagedInstagramScheduler {
  constructor(
    private readonly scheduler: Scheduler,
    private readonly createId: () => string = randomUUID,
  ) {}

  schedule(
    payload: TocaManagedInstagramSchedulePayload,
  ): Promise<ScheduledJob<TocaManagedInstagramSchedulePayload>> {
    const parsed = parseTocaManagedInstagramSchedulePayload(payload);
    assertApprovedTocaManagedDescriptor(parsed);
    const descriptorSha256 = hashTocaManagedInstagramApprovalDescriptor(parsed);

    return this.scheduler.schedule({
      id: this.createId(),
      toolName: TOCA_MANAGED_INSTAGRAM_PUBLICATION_JOB,
      payload: parsed,
      runAt: parsed.scheduledFor,
      timezone: parsed.timezone,
      idempotencyKey: `internal:instagram:toca-managed:${parsed.contentItemId}:${descriptorSha256}`,
    });
  }

  async reschedule(
    jobId: string,
    replacement: TocaManagedInstagramSchedulePayload,
  ): Promise<ScheduledJob<TocaManagedInstagramSchedulePayload>> {
    const existing = await this.requireManagedJob(jobId);
    if (existing.status !== 'SCHEDULED') {
      throw new Error('TOCA_MANAGED_INSTAGRAM_SCHEDULE_NOT_MUTABLE');
    }
    await this.scheduler.cancel(jobId);
    return this.schedule(replacement);
  }

  async cancel(jobId: string): Promise<ScheduledJob | undefined> {
    await this.requireManagedJob(jobId);
    return this.scheduler.cancel(jobId);
  }

  async status(
    jobId: string,
  ): Promise<ScheduledJob<TocaManagedInstagramSchedulePayload> | undefined> {
    const job = await this.scheduler.get<TocaManagedInstagramSchedulePayload>(jobId);
    if (!job) return undefined;
    assertManagedJob(job);
    return job;
  }

  async list(): Promise<readonly ScheduledJob<TocaManagedInstagramSchedulePayload>[]> {
    const jobs = await this.scheduler.list(TOCA_MANAGED_INSTAGRAM_PUBLICATION_JOB);
    return jobs.map((job) => {
      assertManagedJob(job);
      return job as ScheduledJob<TocaManagedInstagramSchedulePayload>;
    });
  }

  private async requireManagedJob(jobId: string): Promise<ScheduledJob> {
    const job = await this.scheduler.get(jobId);
    if (!job) throw new Error('TOCA_MANAGED_INSTAGRAM_SCHEDULE_NOT_FOUND');
    assertManagedJob(job);
    return job;
  }
}

export class TocaManagedInstagramPublicationJobHandler implements JobHandler {
  constructor(
    private readonly delivery: PublicationAssetDeliveryProvider,
    private readonly executor: InstagramPublicationExecutor,
  ) {}

  async execute(payload: unknown): Promise<void> {
    const schedule = parseTocaManagedInstagramSchedulePayload(payload);
    assertApprovedTocaManagedDescriptor(schedule);

    const mediaUrl = await this.delivery.createDeliveryUrl(schedule.asset.objectName);
    const request: InstagramPublishRequest = {
      account: schedule.account,
      mediaType: schedule.mediaType,
      mediaUrls: [mediaUrl],
      correlationId: schedule.correlationId,
      idempotencyKey: schedule.publicationIdempotencyKey,
      ...(schedule.caption !== undefined ? { caption: schedule.caption } : {}),
    };

    const result = await this.executor.execute(request);
    if (!result.completed) {
      throw new Error('INSTAGRAM_PUBLICATION_PROCESSING_PENDING');
    }
  }
}

export function parseTocaManagedInstagramApprovalDescriptor(
  value: unknown,
): TocaManagedInstagramApprovalDescriptor {
  return tocaManagedInstagramApprovalDescriptorSchema.parse(value);
}

export function parseTocaManagedInstagramSchedulePayload(
  value: unknown,
): TocaManagedInstagramSchedulePayload {
  return tocaManagedInstagramSchedulePayloadSchema.parse(value);
}

export function hashTocaManagedInstagramApprovalDescriptor(
  value: TocaManagedInstagramApprovalDescriptor,
): string {
  const descriptor = parseTocaManagedInstagramApprovalDescriptor(value);
  return createHash('sha256').update(stableJson(descriptor), 'utf8').digest('hex');
}

export function assertApprovedTocaManagedDescriptor(
  payload: TocaManagedInstagramSchedulePayload,
): void {
  if (
    payload.approval.mode === 'EXPLICIT_APPROVAL' &&
    payload.approval.status !== 'APPROVED'
  ) {
    throw new Error('TOCA_MANAGED_INSTAGRAM_APPROVAL_REQUIRED');
  }
  if (
    payload.approval.mode === 'PREAPPROVED_CLASS' &&
    payload.approval.status !== 'PREAPPROVED_CLASS'
  ) {
    throw new Error('TOCA_MANAGED_INSTAGRAM_PREAPPROVAL_REQUIRED');
  }

  const actual = hashTocaManagedInstagramApprovalDescriptor(payload);
  if (actual !== payload.approval.approvedDescriptorSha256) {
    throw new Error('TOCA_MANAGED_INSTAGRAM_APPROVAL_MISMATCH');
  }
}

function assertManagedJob(job: ScheduledJob): void {
  if (job.toolName !== TOCA_MANAGED_INSTAGRAM_PUBLICATION_JOB) {
    throw new Error('TOCA_MANAGED_INSTAGRAM_SCHEDULE_JOB_MISMATCH');
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('TOCA_MANAGED_DESCRIPTOR_INVALID');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  throw new Error('TOCA_MANAGED_DESCRIPTOR_INVALID');
}
