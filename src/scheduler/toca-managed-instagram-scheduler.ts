import { createHash, randomUUID } from 'node:crypto';
import * as z from 'zod/v4';
import type { PublicationAssetContentType } from '../providers/gcp/gcs-publication-asset-stager.js';
import type { InstagramPublishRequest } from '../providers/instagram/instagram-contracts.js';
import type { InstagramPublicationExecutor } from '../providers/instagram/instagram-publication-executor.js';
import type { InstagramPublicationReconciler } from '../providers/instagram/instagram-publication-reconciler.js';
import type { JobHandler } from '../worker/worker.js';
import type { NewScheduledJob, ScheduledJob, Scheduler } from './scheduler-contracts.js';

export const TOCA_MANAGED_INSTAGRAM_PUBLICATION_JOB =
  'internal.instagram.publication.toca-managed.execute';

export const tocaManagedApprovalStatusSchema = z.enum(['APPROVED', 'PREAPPROVED_CLASS']);

const tocaManagedInstagramAssetSchema = z.object({
  assetId: z.string().min(1),
  objectName: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4']),
});

const descriptorObjectSchema = z.object({
  schemaVersion: z.literal(1),
  contentItemId: z.string().min(1),
  scheduledFor: z.string().datetime({ offset: true }),
  timezone: z.string().min(1).refine(isValidIanaTimezone, 'Invalid IANA timezone'),
  account: z.object({
    pageId: z.string().min(1),
    instagramAccountId: z.string().min(1),
  }),
  mediaType: z.enum(['IMAGE', 'CAROUSEL', 'REEL', 'STORY']),
  /** Legacy v1 single-asset field retained for persisted schedules and API compatibility. */
  asset: tocaManagedInstagramAssetSchema.optional(),
  /** Canonical multi-asset representation for new schedules. Array order is publication order. */
  assets: z.array(tocaManagedInstagramAssetSchema).min(1).max(10).optional(),
  caption: z.string().optional(),
  correlationId: z.string().min(1),
  publicationIdempotencyKey: z.string().min(1),
});

export const tocaManagedInstagramApprovalDescriptorSchema = descriptorObjectSchema.superRefine(
  validateManagedMediaContract,
);

export const tocaManagedInstagramSchedulePayloadSchema = descriptorObjectSchema
  .extend({
    approval: z.object({
      mode: z.enum(['EXPLICIT_APPROVAL', 'PREAPPROVED_CLASS']),
      status: tocaManagedApprovalStatusSchema,
      approvedDescriptorSha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  })
  .superRefine(validateManagedMediaContract);

export type TocaManagedInstagramApprovalDescriptor = z.infer<
  typeof tocaManagedInstagramApprovalDescriptorSchema
>;
export type TocaManagedInstagramSchedulePayload = z.infer<
  typeof tocaManagedInstagramSchedulePayloadSchema
>;
export type TocaManagedInstagramAsset = z.infer<typeof tocaManagedInstagramAssetSchema>;

export interface PublicationAssetDeliveryProvider {
  createVerifiedDeliveryUrl(
    objectName: string,
    expectedSha256: string,
    expectedContentType?: PublicationAssetContentType,
  ): Promise<string>;
}

export class TocaManagedInstagramScheduler {
  constructor(
    private readonly scheduler: Scheduler,
    private readonly createId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  schedule(
    payload: TocaManagedInstagramSchedulePayload,
  ): Promise<ScheduledJob<TocaManagedInstagramSchedulePayload>> {
    const parsed = this.parseNewSchedule(payload);
    return this.scheduler.schedule(this.newJob(parsed));
  }

  async reschedule(
    jobId: string,
    replacement: TocaManagedInstagramSchedulePayload,
  ): Promise<ScheduledJob<TocaManagedInstagramSchedulePayload>> {
    const parsedReplacement = this.parseNewSchedule(replacement);
    const existing = await this.requireManagedJob(jobId);
    if (existing.status !== 'SCHEDULED') {
      throw new Error('TOCA_MANAGED_INSTAGRAM_SCHEDULE_NOT_MUTABLE');
    }
    if (!this.scheduler.replace) {
      throw new Error('TOCA_MANAGED_INSTAGRAM_ATOMIC_RESCHEDULE_REQUIRED');
    }

    const replacementJob = this.newJob(parsedReplacement);
    const replaced = await this.scheduler.replace(jobId, replacementJob);
    if (!replaced) throw new Error('TOCA_MANAGED_INSTAGRAM_SCHEDULE_NOT_FOUND');
    if (replaced.id !== replacementJob.id || replaced.status !== 'SCHEDULED') {
      throw new Error('TOCA_MANAGED_INSTAGRAM_SCHEDULE_NOT_MUTABLE');
    }
    return replaced;
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

  private parseNewSchedule(
    payload: TocaManagedInstagramSchedulePayload,
  ): TocaManagedInstagramSchedulePayload {
    const parsed = parseTocaManagedInstagramSchedulePayload(payload);
    assertApprovedTocaManagedDescriptor(parsed);
    assertFutureManagedSchedule(parsed.scheduledFor, this.now());
    return parsed;
  }

  private newJob(
    parsed: TocaManagedInstagramSchedulePayload,
  ): NewScheduledJob<TocaManagedInstagramSchedulePayload> {
    const descriptorSha256 = hashTocaManagedInstagramApprovalDescriptor(parsed);
    return {
      id: this.createId(),
      toolName: TOCA_MANAGED_INSTAGRAM_PUBLICATION_JOB,
      payload: parsed,
      runAt: parsed.scheduledFor,
      timezone: parsed.timezone,
      idempotencyKey: `internal:instagram:toca-managed:${parsed.contentItemId}:${descriptorSha256}`,
    };
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
    private readonly reconciler?: InstagramPublicationReconciler,
  ) {}

  async execute(payload: unknown): Promise<void> {
    const schedule = parseTocaManagedInstagramSchedulePayload(payload);
    assertApprovedTocaManagedDescriptor(schedule);

    const assets = managedPublicationAssets(schedule);
    const mediaUrls = await Promise.all(
      assets.map((asset) =>
        this.delivery.createVerifiedDeliveryUrl(asset.objectName, asset.sha256, asset.contentType),
      ),
    );
    const request: InstagramPublishRequest = {
      account: schedule.account,
      mediaType: schedule.mediaType,
      mediaUrls,
      correlationId: schedule.correlationId,
      idempotencyKey: schedule.publicationIdempotencyKey,
      ...(schedule.caption !== undefined ? { caption: schedule.caption } : {}),
      ...(assets.length === 1 ? { publicationAssetSha256: assets[0]!.sha256 } : {}),
    };

    if (this.reconciler) {
      const reconciled = await this.reconciler.reconcile(request, {
        scheduledFor: schedule.scheduledFor,
        mediaType: schedule.mediaType,
        ...(schedule.caption !== undefined ? { caption: schedule.caption } : {}),
      });
      if (reconciled?.completed) return;
    }

    const result = await this.executor.execute(request);
    if (!result.completed) {
      throw new Error('INSTAGRAM_PUBLICATION_PROCESSING_PENDING');
    }
  }
}

export function managedPublicationAssets(
  value: Pick<TocaManagedInstagramApprovalDescriptor, 'asset' | 'assets'>,
): readonly TocaManagedInstagramAsset[] {
  if (value.assets) return value.assets;
  if (value.asset) return [value.asset];
  throw new Error('TOCA_MANAGED_INSTAGRAM_ASSET_REQUIRED');
}

export function assertFutureManagedSchedule(scheduledFor: string, now: Date = new Date()): void {
  const scheduledEpoch = Date.parse(scheduledFor);
  if (!Number.isFinite(scheduledEpoch)) {
    throw new Error('TOCA_MANAGED_INSTAGRAM_SCHEDULE_TIME_INVALID');
  }
  if (Number.isNaN(now.getTime())) throw new Error('TOCA_MANAGED_INSTAGRAM_CLOCK_INVALID');
  if (scheduledEpoch <= now.getTime()) {
    throw new Error('TOCA_MANAGED_INSTAGRAM_SCHEDULE_MUST_BE_FUTURE');
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
  if (payload.approval.mode === 'EXPLICIT_APPROVAL' && payload.approval.status !== 'APPROVED') {
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

function validateManagedMediaContract(
  value: z.infer<typeof descriptorObjectSchema>,
  ctx: z.core.$RefinementCtx<z.infer<typeof descriptorObjectSchema>>,
): void {
  if (value.asset && value.assets) {
    ctx.addIssue({
      code: 'custom',
      path: ['assets'],
      message: 'Use either legacy asset or canonical assets, never both.',
    });
    return;
  }
  const assets = value.assets ?? (value.asset ? [value.asset] : []);
  if (assets.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['assets'], message: 'At least one asset is required.' });
    return;
  }

  const identities = new Set<string>();
  for (const asset of assets) {
    const identity = `${asset.assetId}:${asset.objectName}`;
    if (identities.has(identity)) {
      ctx.addIssue({
        code: 'custom',
        path: ['assets'],
        message: 'Duplicate publication assets are not allowed.',
      });
      return;
    }
    identities.add(identity);
  }

  const imageOnly = assets.every((asset) => asset.contentType !== 'video/mp4');
  switch (value.mediaType) {
    case 'IMAGE':
      if (assets.length !== 1 || !imageOnly) {
        ctx.addIssue({
          code: 'custom',
          path: ['assets'],
          message: 'IMAGE requires exactly one JPEG, PNG, or WebP asset.',
        });
      }
      break;
    case 'REEL':
      if (assets.length !== 1 || assets[0]?.contentType !== 'video/mp4') {
        ctx.addIssue({
          code: 'custom',
          path: ['assets'],
          message: 'REEL requires exactly one video/mp4 asset.',
        });
      }
      break;
    case 'STORY':
      if (assets.length !== 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['assets'],
          message: 'STORY requires exactly one image or video asset.',
        });
      }
      break;
    case 'CAROUSEL':
      if (assets.length < 2 || assets.length > 10 || !imageOnly) {
        ctx.addIssue({
          code: 'custom',
          path: ['assets'],
          message: 'CAROUSEL requires between two and ten JPEG, PNG, or WebP assets.',
        });
      }
      break;
  }
}

function assertManagedJob(job: ScheduledJob): void {
  if (job.toolName !== TOCA_MANAGED_INSTAGRAM_PUBLICATION_JOB) {
    throw new Error('TOCA_MANAGED_INSTAGRAM_SCHEDULE_JOB_MISMATCH');
  }
}

function isValidIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
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
