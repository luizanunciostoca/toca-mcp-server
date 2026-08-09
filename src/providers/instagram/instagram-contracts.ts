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

export interface InstagramPublishRequest {
  readonly account: InstagramAccountRef;
  readonly mediaType: InstagramMediaType;
  readonly mediaUrls: readonly string[];
  readonly caption?: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
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
