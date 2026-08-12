import type { MetaApiClient } from '../meta/meta-api-client.js';
import type { InstagramPublishRequest } from './instagram-contracts.js';
import {
  buildInstagramContainerPlan,
  buildInstagramPublishCall,
  type InstagramContainerCreate,
} from './instagram-publish-builder.js';
import type { InstagramPublicationTransport } from './instagram-publication-executor.js';

type IdResponse = { readonly id: string };

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
