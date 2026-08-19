import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import * as z from 'zod/v4';
import type {
  InstagramMediaType,
  InstagramPublishRequest,
} from '../providers/instagram/instagram-contracts.js';
import type {
  InstagramPublicationExecutor,
  InstagramPublicationTransport,
  PublicationExecutionResult,
} from '../providers/instagram/instagram-publication-executor.js';
import type { CoreCapabilityRuntimeBinding } from './core-execution.js';

const DIRECT_PUBLICATION_CAPABILITIES = {
  'instagram.publish.image': 'IMAGE',
  'instagram.publish.carousel': 'CAROUSEL',
  'instagram.publish.reel': 'REEL',
  'instagram.publish.story': 'STORY',
} as const satisfies Readonly<Record<string, InstagramMediaType>>;

type DirectPublicationCapabilityId = keyof typeof DIRECT_PUBLICATION_CAPABILITIES;

const accountSchema = z.object({
  pageId: z.string().min(1),
  instagramAccountId: z.string().min(1),
});
const mediaUrlSchema = z.string().url();
const imageUrlSchema = mediaUrlSchema.refine(isImageMediaUrl, {
  message: 'Instagram image publication requires a JPEG, PNG, or WebP URL.',
});
const basePublicationSchema = z.object({
  account: accountSchema,
  mediaUrls: z.array(mediaUrlSchema).min(1).max(10),
  caption: z.string().max(2200).optional(),
  correlationId: z.string().min(1),
  idempotencyKey: z.string().min(1),
});
const imagePublicationSchema = basePublicationSchema.extend({
  mediaUrls: z.array(imageUrlSchema).length(1),
});
const carouselPublicationSchema = basePublicationSchema.extend({
  mediaUrls: z.array(imageUrlSchema).min(2).max(10),
});
const singleVideoPublicationSchema = basePublicationSchema.extend({
  mediaUrls: z.array(mediaUrlSchema).length(1),
});
const storyPublicationSchema = basePublicationSchema.omit({ caption: true }).extend({
  mediaUrls: z.array(mediaUrlSchema).length(1),
});

type DirectPublicationInput = z.infer<typeof basePublicationSchema>;

export interface InstagramCorePublicationRuntime {
  readonly executor: Pick<InstagramPublicationExecutor, 'execute'>;
  readonly transport: Pick<InstagramPublicationTransport, 'getPublishedMedia'>;
  readonly allowedInstagramAccountId: string;
  readonly maxPollAttempts?: number;
  readonly pollIntervalMs?: number;
}

export function resolveInstagramPublicationRuntimeBinding(
  capabilityId: string,
  runtime: InstagramCorePublicationRuntime | undefined,
): CoreCapabilityRuntimeBinding | undefined {
  if (!runtime || !isDirectPublicationCapabilityId(capabilityId)) return undefined;
  const mediaType = DIRECT_PUBLICATION_CAPABILITIES[capabilityId];
  const schema = publicationSchemaFor(mediaType);

  return {
    inputSchema: schema,
    execute: async (value) => {
      const input = schema.parse(value);
      assertAllowedAccount(input, runtime.allowedInstagramAccountId);
      const request = publicationRequest(capabilityId, mediaType, input);
      return executeUntilPublished(runtime, request);
    },
    targetAccount: (value) => schema.parse(value).account.instagramAccountId,
    idempotencyKey: (value) => directPublicationIdempotencyKey(capabilityId, schema.parse(value)),
    providerReadback: async (result, value) => {
      const input = schema.parse(value);
      assertAllowedAccount(input, runtime.allowedInstagramAccountId);
      return readbackPublishedMedia(
        mediaType,
        result as PublicationExecutionResult,
        input,
        runtime,
      );
    },
    sideEffectValidated: true,
  };
}

async function executeUntilPublished(
  runtime: InstagramCorePublicationRuntime,
  request: InstagramPublishRequest,
): Promise<PublicationExecutionResult> {
  const maxAttempts = runtime.maxPollAttempts ?? 60;
  const pollIntervalMs = runtime.pollIntervalMs ?? 1000;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error('INSTAGRAM_PUBLICATION_MAX_POLL_ATTEMPTS_INVALID');
  }
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 0) {
    throw new Error('INSTAGRAM_PUBLICATION_POLL_INTERVAL_INVALID');
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runtime.executor.execute(request);
    if (result.completed && result.publication.state === 'PUBLISHED') return result;
    if (attempt < maxAttempts && pollIntervalMs > 0) await delay(pollIntervalMs);
  }
  throw new Error('INSTAGRAM_PUBLICATION_PROCESSING_TIMEOUT');
}

async function readbackPublishedMedia(
  expectedType: InstagramMediaType,
  result: PublicationExecutionResult,
  input: DirectPublicationInput,
  runtime: InstagramCorePublicationRuntime,
) {
  const mediaId = result.publication.externalMediaId;
  if (!result.completed || result.publication.state !== 'PUBLISHED' || !mediaId) {
    return {
      verified: false,
      evidence: ['instagram:publication:not-published'],
      reason: 'INSTAGRAM_PUBLICATION_NOT_PUBLISHED',
    };
  }
  if (!runtime.transport.getPublishedMedia) {
    return {
      verified: false,
      evidence: [`instagram:media:${mediaId}:readback-unavailable`],
      externalResourceId: mediaId,
      reason: 'INSTAGRAM_PUBLICATION_READBACK_UNAVAILABLE',
    };
  }

  const observed = await runtime.transport.getPublishedMedia(mediaId);
  const typeVerified = providerMediaTypeMatches(expectedType, observed.mediaType);
  const captionVerified =
    expectedType === 'STORY' ||
    input.caption === undefined ||
    normalizeCaption(observed.caption) === normalizeCaption(input.caption);
  const verified = observed.mediaId === mediaId && typeVerified && captionVerified;
  return {
    verified,
    evidence: [
      `instagram:media:${mediaId}:readback`,
      `instagram:media:${mediaId}:type:${observed.mediaType ?? 'UNKNOWN'}`,
      `instagram:media:${mediaId}:caption:${captionVerified ? 'MATCH' : 'MISMATCH'}`,
    ],
    externalResourceId: mediaId,
    ...(!verified ? { reason: 'INSTAGRAM_PUBLICATION_READBACK_MISMATCH' } : {}),
  };
}

function publicationRequest(
  capabilityId: DirectPublicationCapabilityId,
  mediaType: InstagramMediaType,
  input: DirectPublicationInput,
): InstagramPublishRequest {
  return {
    account: input.account,
    mediaType,
    mediaUrls: input.mediaUrls,
    ...(input.caption !== undefined ? { caption: input.caption } : {}),
    correlationId: input.correlationId,
    idempotencyKey: directPublicationIdempotencyKey(capabilityId, input),
  };
}

function publicationSchemaFor(mediaType: InstagramMediaType) {
  switch (mediaType) {
    case 'IMAGE':
      return imagePublicationSchema;
    case 'CAROUSEL':
      return carouselPublicationSchema;
    case 'REEL':
      return singleVideoPublicationSchema;
    case 'STORY':
      return storyPublicationSchema;
  }
}

function directPublicationIdempotencyKey(
  capabilityId: DirectPublicationCapabilityId,
  input: DirectPublicationInput,
): string {
  const descriptor = JSON.stringify({
    capabilityId,
    account: input.account,
    mediaUrls: input.mediaUrls,
    caption: input.caption ?? null,
    correlationId: input.correlationId,
    callerIdempotencyKey: input.idempotencyKey,
  });
  const digest = createHash('sha256').update(descriptor, 'utf8').digest('hex');
  return `instagram:direct:${digest}`;
}

function assertAllowedAccount(
  input: DirectPublicationInput,
  allowedInstagramAccountId: string,
): void {
  if (input.account.instagramAccountId !== allowedInstagramAccountId) {
    throw new Error('INSTAGRAM_PUBLICATION_TARGET_ACCOUNT_NOT_ALLOWED');
  }
}

function providerMediaTypeMatches(
  expected: InstagramMediaType,
  observed: string | undefined,
): boolean {
  switch (expected) {
    case 'IMAGE':
      return observed === 'IMAGE';
    case 'CAROUSEL':
      return observed === 'CAROUSEL_ALBUM';
    case 'REEL':
      return observed === 'VIDEO' || observed === 'REELS';
    case 'STORY':
      return observed === 'IMAGE' || observed === 'VIDEO' || observed === 'REELS';
  }
}

function isImageMediaUrl(value: string): boolean {
  try {
    const pathname = new URL(value).pathname.toLowerCase();
    return /\.(?:jpe?g|png|webp)$/.test(pathname);
  } catch {
    return false;
  }
}

function normalizeCaption(value: string | undefined): string {
  return (value ?? '').replace(/\r\n/g, '\n').trim();
}

function isDirectPublicationCapabilityId(value: string): value is DirectPublicationCapabilityId {
  return Object.prototype.hasOwnProperty.call(DIRECT_PUBLICATION_CAPABILITIES, value);
}
