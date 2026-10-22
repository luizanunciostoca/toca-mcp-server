import { createHash } from 'node:crypto';
import type { CreativeTruthPublicationBinding } from '../../contracts/creative-truth.js';

export type InstagramMediaType = 'IMAGE' | 'CAROUSEL' | 'REEL' | 'STORY';

export interface InstagramAccountRef {
  readonly pageId: string;
  readonly instagramAccountId: string;
}

export interface InstagramProfile {
  readonly id: string;
  readonly username: string;
  readonly name?: string;
  readonly followersCount?: number;
  readonly mediaCount?: number;
}

export interface InstagramMediaSummary {
  readonly id: string;
  readonly mediaType: InstagramMediaType;
  readonly permalink?: string;
  readonly timestamp?: string;
  readonly caption?: string;
}

export interface InstagramComment {
  readonly id: string;
  readonly text: string;
  readonly username?: string;
  readonly timestamp?: string;
}

export interface InstagramInsightMetric {
  readonly name: string;
  readonly value: number | string;
  readonly period?: string;
}

export interface InstagramReadProvider {
  getProfile(account: InstagramAccountRef): Promise<InstagramProfile>;
  listMedia(
    account: InstagramAccountRef,
    limit?: number,
  ): Promise<readonly InstagramMediaSummary[]>;
  listComments(
    account: InstagramAccountRef,
    mediaId: string,
    limit?: number,
  ): Promise<readonly InstagramComment[]>;
  getAccountInsights(
    account: InstagramAccountRef,
    metrics: readonly string[],
  ): Promise<readonly InstagramInsightMetric[]>;
  getMediaInsights(
    account: InstagramAccountRef,
    mediaId: string,
    metrics: readonly string[],
  ): Promise<readonly InstagramInsightMetric[]>;
}

/** Provenance only, never authority. The runtime writes gate and externally approved
 * whole-request hash remain required. A controller must authenticate the owner grant.
 * The envelope digest describes that protected command, not this request (no hash cycle).
 */
export interface InstagramOneOffDescriptor {
  readonly mode: 'ONE_OFF';
  readonly authorizationRef: string;
  readonly authorizationId: string;
  readonly commandEnvelopeSha256: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly maxPublications: 1;
}

/** Mutable content, account, envelope and validity must never mint another consumption key. */
export function deriveInstagramOneOffIdempotencyKey(
  descriptor: Pick<InstagramOneOffDescriptor, 'authorizationRef' | 'authorizationId'>,
): string {
  const identity = JSON.stringify([descriptor.authorizationRef, descriptor.authorizationId]);
  return `instagram:one-off:${createHash('sha256').update(identity, 'utf8').digest('hex')}`;
}

export function assertInstagramOneOffWindow(
  descriptor: InstagramOneOffDescriptor,
  nowIso: string,
): void {
  const now = Date.parse(nowIso);
  const start = Date.parse(descriptor.validFrom);
  const end = Date.parse(descriptor.validUntil);
  if (![now, start, end].every(Number.isFinite) || start >= end) {
    throw new Error('INSTAGRAM_PUBLICATION_ONE_OFF_AUTHORIZATION_WINDOW_INVALID');
  }
  if (now < start) {
    throw new Error('INSTAGRAM_PUBLICATION_ONE_OFF_AUTHORIZATION_NOT_YET_VALID');
  }
  if (now >= end) throw new Error('INSTAGRAM_PUBLICATION_ONE_OFF_AUTHORIZATION_EXPIRED');
}

export interface InstagramPublishRequest {
  readonly oneOff?: InstagramOneOffDescriptor;
  readonly account: InstagramAccountRef;
  readonly mediaType: InstagramMediaType;
  readonly mediaUrls: readonly string[];
  readonly caption?: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly creativeTruthBinding?: CreativeTruthPublicationBinding;
  /** SHA-256 computed from the exact staged publication bytes before provider execution. */
  readonly publicationAssetSha256?: string;
}

export interface InstagramPublishResult {
  readonly externalMediaId: string;
  readonly status: 'PROCESSING' | 'PUBLISHED';
  readonly permalink?: string;
}

export interface InstagramWriteProvider {
  publish(request: InstagramPublishRequest): Promise<InstagramPublishResult>;
  getPublishStatus(
    account: InstagramAccountRef,
    externalMediaId: string,
  ): Promise<InstagramPublishResult>;
  replyToComment(
    account: InstagramAccountRef,
    commentId: string,
    message: string,
  ): Promise<{ readonly replyId: string }>;
}
