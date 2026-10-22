import {
  assertMetaApiRequestActive,
  type MetaApiClient,
  type MetaApiRequestContext,
} from '../meta/meta-api-client.js';
import type { InstagramPublishRequest } from './instagram-contracts.js';
import {
  buildInstagramContainerPlan,
  buildInstagramPublishCall,
  type InstagramContainerCreate,
} from './instagram-publish-builder.js';
import type {
  InstagramPublicationTransport,
  PublishedMediaEvidence,
} from './instagram-publication-executor.js';

type IdResponse = { readonly id: string };
type MediaListResponse = { readonly data?: readonly unknown[] };

export class MetaInstagramPublicationTransport implements InstagramPublicationTransport {
  constructor(private readonly client: MetaApiClient) {}

  async createContainer(
    request: InstagramPublishRequest,
    context?: MetaApiRequestContext,
  ): Promise<{ readonly containerId: string }> {
    assertMetaApiRequestActive(context);
    const plan = buildInstagramContainerPlan(request);
    const containerId = await this.createPlannedContainer(plan, context);
    return { containerId };
  }

  async getContainerStatus(
    containerId: string,
    context?: MetaApiRequestContext,
  ): Promise<'IN_PROGRESS' | 'FINISHED' | 'ERROR'> {
    assertMetaApiRequestActive(context);
    const response = requireObject(
      await (context
        ? this.client.get(containerId, { fields: 'status_code' }, context)
        : this.client.get(containerId, { fields: 'status_code' })),
      'META_INSTAGRAM_STATUS_INVALID',
    );
    const status = response.status_code;
    if (typeof status !== 'string') throw new Error('META_INSTAGRAM_STATUS_INVALID');
    if (status === 'FINISHED') return 'FINISHED';
    if (status === 'IN_PROGRESS') return 'IN_PROGRESS';
    if (status === 'ERROR' || status === 'EXPIRED') return 'ERROR';
    throw new Error(`META_INSTAGRAM_STATUS_UNSUPPORTED:${status}`);
  }

  async publishContainer(
    instagramAccountId: string,
    containerId: string,
    context?: MetaApiRequestContext,
  ): Promise<{ readonly mediaId: string }> {
    assertMetaApiRequestActive(context);
    const call = buildInstagramPublishCall(instagramAccountId, containerId);
    const response = requireId(
      await (context
        ? this.client.post(call.path, call.body, context)
        : this.client.post(call.path, call.body)),
    );
    return { mediaId: response.id };
  }

  async getPublishedMedia(
    mediaId: string,
    context?: MetaApiRequestContext,
  ): Promise<PublishedMediaEvidence> {
    assertMetaApiRequestActive(context);
    const query = { fields: 'id,caption,media_type,permalink,timestamp' };
    return parseMediaEvidence(
      await (context ? this.client.get(mediaId, query, context) : this.client.get(mediaId, query)),
    );
  }

  async listRecentPublishedMedia(
    instagramAccountId: string,
    limit = 25,
  ): Promise<readonly PublishedMediaEvidence[]> {
    return this.listPublishedCollection(`${instagramAccountId}/media`, limit);
  }

  async listRecentPublishedStories(
    instagramAccountId: string,
    limit = 25,
  ): Promise<readonly PublishedMediaEvidence[]> {
    return this.listPublishedCollection(`${instagramAccountId}/stories`, limit);
  }

  private async listPublishedCollection(
    path: string,
    limit: number,
  ): Promise<readonly PublishedMediaEvidence[]> {
    const response = requireObject(
      await this.client.get(path, {
        fields: 'id,caption,media_type,permalink,timestamp',
        limit: String(limit),
      }),
      'META_INSTAGRAM_MEDIA_LIST_INVALID',
    ) as MediaListResponse & Record<string, unknown>;
    if (!Array.isArray(response.data)) throw new Error('META_INSTAGRAM_MEDIA_LIST_INVALID');
    return response.data.map(parseMediaEvidence);
  }

  private async createPlannedContainer(
    plan: InstagramContainerCreate,
    context?: MetaApiRequestContext,
  ): Promise<string> {
    assertMetaApiRequestActive(context);
    let body = plan.body;
    if (plan.children?.length) {
      const childIds: string[] = [];
      for (const child of plan.children) {
        childIds.push(await this.createPlannedContainer(child, context));
      }
      body = { ...body, children: childIds.join(',') };
    }
    // A late child response cannot authorize its siblings or the parent container.
    assertMetaApiRequestActive(context);
    return requireId(
      await (context
        ? this.client.post(plan.path, body, context)
        : this.client.post(plan.path, body)),
    ).id;
  }
}

function parseMediaEvidence(value: unknown): PublishedMediaEvidence {
  const object = requireObject(value, 'META_INSTAGRAM_MEDIA_INVALID');
  if (typeof object.id !== 'string' || object.id.length === 0) {
    throw new Error('META_INSTAGRAM_MEDIA_INVALID');
  }
  return {
    mediaId: object.id,
    ...(typeof object.caption === 'string' ? { caption: object.caption } : {}),
    ...(typeof object.media_type === 'string' ? { mediaType: object.media_type } : {}),
    ...(typeof object.permalink === 'string' ? { permalink: object.permalink } : {}),
    ...(typeof object.timestamp === 'string' ? { timestamp: object.timestamp } : {}),
  };
}

function requireId(value: unknown): IdResponse {
  const object = requireObject(value, 'META_INSTAGRAM_ID_RESPONSE_INVALID');
  if (typeof object.id !== 'string' || object.id.length === 0) {
    throw new Error('META_INSTAGRAM_ID_RESPONSE_INVALID');
  }
  return { id: object.id };
}

function requireObject(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}
