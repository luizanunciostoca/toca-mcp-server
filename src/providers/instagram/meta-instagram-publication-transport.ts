import type { MetaApiClient } from '../meta/meta-api-client.js';
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

type MediaListResponse = {
  readonly data?: readonly unknown[];
};

export class MetaInstagramPublicationTransport implements InstagramPublicationTransport {
  constructor(private readonly client: MetaApiClient) {}

  async createContainer(
    request: InstagramPublishRequest,
  ): Promise<{ readonly containerId: string }> {
    const plan = buildInstagramContainerPlan(request);
    const containerId = await this.createPlannedContainer(plan);
    return { containerId };
  }

  async getContainerStatus(containerId: string): Promise<'IN_PROGRESS' | 'FINISHED' | 'ERROR'> {
    const response = requireObject(
      await this.client.get(containerId, { fields: 'status_code' }),
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
  ): Promise<{ readonly mediaId: string }> {
    const call = buildInstagramPublishCall(instagramAccountId, containerId);
    const response = requireId(await this.client.post(call.path, call.body));
    return { mediaId: response.id };
  }

  async getPublishedMedia(mediaId: string): Promise<PublishedMediaEvidence> {
    return parseMediaEvidence(
      await this.client.get(mediaId, {
        fields: 'id,caption,media_type,permalink,timestamp',
      }),
    );
  }

  async listRecentPublishedMedia(
    instagramAccountId: string,
    limit = 25,
  ): Promise<readonly PublishedMediaEvidence[]> {
    const response = requireObject(
      await this.client.get(`${instagramAccountId}/media`, {
        fields: 'id,caption,media_type,permalink,timestamp',
        limit: String(limit),
      }),
      'META_INSTAGRAM_MEDIA_LIST_INVALID',
    ) as MediaListResponse & Record<string, unknown>;
    if (!Array.isArray(response.data)) throw new Error('META_INSTAGRAM_MEDIA_LIST_INVALID');
    return response.data.map(parseMediaEvidence);
  }

  private async createPlannedContainer(plan: InstagramContainerCreate): Promise<string> {
    let body = plan.body;
    if (plan.children?.length) {
      const childIds: string[] = [];
      for (const child of plan.children) {
        childIds.push(await this.createPlannedContainer(child));
      }
      body = { ...body, children: childIds.join(',') };
    }
    return requireId(await this.client.post(plan.path, body)).id;
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
