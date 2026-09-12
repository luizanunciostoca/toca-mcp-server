import * as z from 'zod/v4';
import { creativeTruthPublicationBindingSchema } from '../contracts/creative-truth.js';

export const GITHUB_NATIVE_PUBLICATION_QUEUE_SCHEMA_VERSION = 1 as const;
export const GITHUB_NATIVE_PUBLICATION_TIMEZONE = 'America/Bahia' as const;
export const GITHUB_NATIVE_PUBLICATION_TOLERANCE_MS = 5 * 60 * 1000;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);
const explicitOffsetTimestampSchema = z
  .string()
  .regex(/T.*(?:Z|[+-]\d{2}:\d{2})$/i, 'timestamp must include Z or an explicit numeric offset')
  .refine((value) => Number.isFinite(Date.parse(value)), 'timestamp must be valid ISO-8601');

export const githubNativePublicationItemSchema = z.object({
  contentItemId: z.string().min(1),
  scheduledAt: explicitOffsetTimestampSchema,
  expiresAt: explicitOffsetTimestampSchema.optional(),
  operation: z.enum(['SUNSET', 'THE_PARTY']),
  channel: z.literal('INSTAGRAM'),
  contentStatus: z.literal('PRODUCED'),
  approvalStatus: z.literal('APPROVED'),
  publicationIntent: z.literal('SCHEDULED'),
  mediaType: z.enum(['IMAGE', 'STORY']),
  instagramAccountId: z.string().min(1),
  pageId: z.string().min(1).optional(),
  caption: z.string().optional(),
  asset: z.object({
    url: z.string().url(),
    contentType: z.literal('image/jpeg'),
    sha256: sha256Schema,
  }),
  correlationId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  creativeTruthBinding: creativeTruthPublicationBindingSchema,
  sourceRegistry: z
    .object({
      driveFileId: z.string().min(1),
      sheetName: z.string().min(1),
      rowRef: z.string().min(1),
    })
    .optional(),
});

export const githubNativePublicationQueueSchema = z
  .object({
    schemaVersion: z.literal(GITHUB_NATIVE_PUBLICATION_QUEUE_SCHEMA_VERSION),
    timezone: z.literal(GITHUB_NATIVE_PUBLICATION_TIMEZONE),
    generatedAt: explicitOffsetTimestampSchema,
    items: z.array(githubNativePublicationItemSchema),
  })
  .superRefine((queue, ctx) => {
    const contentItemIds = new Set<string>();
    const idempotencyKeys = new Set<string>();
    for (const [index, item] of queue.items.entries()) {
      const scheduledAt = Date.parse(item.scheduledAt);
      if (item.expiresAt) {
        const expiresAt = Date.parse(item.expiresAt);
        if (expiresAt <= scheduledAt) {
          ctx.addIssue({
            code: 'custom',
            path: ['items', index, 'expiresAt'],
            message: 'expiresAt must be after scheduledAt',
          });
        }
      }
      if (contentItemIds.has(item.contentItemId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'contentItemId'],
          message: 'duplicate contentItemId',
        });
      }
      contentItemIds.add(item.contentItemId);
      if (idempotencyKeys.has(item.idempotencyKey)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'idempotencyKey'],
          message: 'duplicate idempotencyKey',
        });
      }
      idempotencyKeys.add(item.idempotencyKey);
    }
  });

export type GithubNativePublicationItem = z.infer<typeof githubNativePublicationItemSchema>;
export type GithubNativePublicationQueue = z.infer<typeof githubNativePublicationQueueSchema>;

export function parseGithubNativePublicationQueue(value: unknown): GithubNativePublicationQueue {
  return githubNativePublicationQueueSchema.parse(value);
}

export function selectDuePublicationItems(
  queue: GithubNativePublicationQueue,
  nowIso: string,
  toleranceMs = GITHUB_NATIVE_PUBLICATION_TOLERANCE_MS,
): readonly GithubNativePublicationItem[] {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) throw new Error('GITHUB_NATIVE_PUBLICATION_NOW_INVALID');
  return queue.items
    .filter((item) => {
      const scheduledAt = Date.parse(item.scheduledAt);
      if (Math.abs(now - scheduledAt) > toleranceMs) return false;
      if (item.expiresAt && now >= Date.parse(item.expiresAt)) return false;
      return true;
    })
    .sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt));
}

export function assertPublicationItemNotExpired(
  item: GithubNativePublicationItem,
  nowIso: string,
): void {
  if (!item.expiresAt) return;
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now) || now >= Date.parse(item.expiresAt)) {
    throw new Error('GITHUB_NATIVE_PUBLICATION_EXPIRED');
  }
}
