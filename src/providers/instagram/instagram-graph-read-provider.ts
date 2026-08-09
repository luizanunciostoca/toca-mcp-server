import { z } from 'zod/v4';
import type { MetaApiClient } from '../meta/meta-api-client.js';
import type {
  InstagramAccountRef,
  InstagramComment,
  InstagramInsightMetric,
  InstagramMediaSummary,
  InstagramMediaType,
  InstagramProfile,
  InstagramReadProvider,
} from './instagram-contracts.js';

const profileSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  name: z.string().optional(),
  followers_count: z.number().optional(),
  media_count: z.number().optional(),
});

const mediaSchema = z.object({
  id: z.string().min(1),
  media_type: z.string().min(1),
  permalink: z.string().url().optional(),
  timestamp: z.string().optional(),
  caption: z.string().optional(),
});

const commentSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  username: z.string().optional(),
  timestamp: z.string().optional(),
});

const dataSchema = <T extends z.ZodTypeAny>(item: T) => z.object({ data: z.array(item).default([]) });
const insightSchema = z.object({
  name: z.string().min(1),
  period: z.string().optional(),
  values: z.array(z.object({ value: z.union([z.number(), z.string()]) })).optional(),
  total_value: z.object({ value: z.union([z.number(), z.string()]) }).optional(),
});

function normalizeMediaType(value: string): InstagramMediaType {
  if (value === 'CAROUSEL_ALBUM') return 'CAROUSEL';
  if (value === 'VIDEO') return 'REEL';
  return 'IMAGE';
}

function normalizeInsight(input: z.infer<typeof insightSchema>): InstagramInsightMetric | undefined {
  const value = input.total_value?.value ?? input.values?.[0]?.value;
  if (value === undefined) return undefined;
  return { name: input.name, value, ...(input.period ? { period: input.period } : {}) };
}

export class InstagramGraphReadProvider implements InstagramReadProvider {
  constructor(private readonly api: MetaApiClient) {}

  async getProfile(account: InstagramAccountRef): Promise<InstagramProfile> {
    const parsed = profileSchema.parse(
      await this.api.get(account.instagramAccountId, {
        fields: 'id,username,name,followers_count,media_count',
      }),
    );
    return {
      id: parsed.id,
      username: parsed.username,
      ...(parsed.name ? { name: parsed.name } : {}),
      ...(parsed.followers_count !== undefined ? { followersCount: parsed.followers_count } : {}),
      ...(parsed.media_count !== undefined ? { mediaCount: parsed.media_count } : {}),
    };
  }

  async listMedia(
    account: InstagramAccountRef,
    limit = 25,
  ): Promise<readonly InstagramMediaSummary[]> {
    const parsed = dataSchema(mediaSchema).parse(
      await this.api.get(`${account.instagramAccountId}/media`, {
        fields: 'id,media_type,permalink,timestamp,caption',
        limit: String(limit),
      }),
    );
    return parsed.data.map((item) => ({
      id: item.id,
      mediaType: normalizeMediaType(item.media_type),
      ...(item.permalink ? { permalink: item.permalink } : {}),
      ...(item.timestamp ? { timestamp: item.timestamp } : {}),
      ...(item.caption ? { caption: item.caption } : {}),
    }));
  }

  async listComments(
    _account: InstagramAccountRef,
    mediaId: string,
    limit = 25,
  ): Promise<readonly InstagramComment[]> {
    const parsed = dataSchema(commentSchema).parse(
      await this.api.get(`${mediaId}/comments`, {
        fields: 'id,text,username,timestamp',
        limit: String(limit),
      }),
    );
    return parsed.data.map((item) => ({
      id: item.id,
      text: item.text,
      ...(item.username ? { username: item.username } : {}),
      ...(item.timestamp ? { timestamp: item.timestamp } : {}),
    }));
  }

  async getAccountInsights(
    account: InstagramAccountRef,
    metrics: readonly string[],
  ): Promise<readonly InstagramInsightMetric[]> {
    return this.getInsights(account.instagramAccountId, metrics);
  }

  async getMediaInsights(
    _account: InstagramAccountRef,
    mediaId: string,
    metrics: readonly string[],
  ): Promise<readonly InstagramInsightMetric[]> {
    return this.getInsights(mediaId, metrics);
  }

  private async getInsights(
    objectId: string,
    metrics: readonly string[],
  ): Promise<readonly InstagramInsightMetric[]> {
    if (metrics.length === 0) return [];
    const parsed = dataSchema(insightSchema).parse(
      await this.api.get(`${objectId}/insights`, { metric: metrics.join(',') }),
    );
    return parsed.data
      .map(normalizeInsight)
      .filter((value): value is InstagramInsightMetric => value !== undefined);
  }
}
