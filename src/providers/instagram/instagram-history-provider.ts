import * as z from 'zod/v4';
import type { MetaApiClient } from '../meta/meta-api-client.js';

const pagingSchema = z
  .object({
    cursors: z
      .object({
        before: z.string().optional(),
        after: z.string().optional(),
      })
      .optional(),
    next: z.string().url().optional(),
    previous: z.string().url().optional(),
  })
  .optional();

const mediaSchema = z.object({
  id: z.string().min(1),
  caption: z.string().optional(),
  media_type: z.string().optional(),
  media_product_type: z.string().optional(),
  permalink: z.string().url().optional(),
  thumbnail_url: z.string().url().optional(),
  timestamp: z.string().optional(),
  username: z.string().optional(),
  like_count: z.number().optional(),
  comments_count: z.number().optional(),
});

const mediaListSchema = z.object({
  data: z.array(mediaSchema),
  paging: pagingSchema,
});

const insightValueSchema = z.object({
  value: z.union([z.number(), z.string(), z.record(z.string(), z.unknown())]),
  end_time: z.string().optional(),
});

const insightMetricSchema = z.object({
  name: z.string().min(1),
  period: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  id: z.string().optional(),
  values: z.array(insightValueSchema).optional(),
  value: z.union([z.number(), z.string(), z.record(z.string(), z.unknown())]).optional(),
  total_value: z
    .object({
      value: z.union([z.number(), z.string(), z.record(z.string(), z.unknown())]),
      breakdowns: z.array(z.unknown()).optional(),
    })
    .optional(),
});

const insightsSchema = z.object({
  data: z.array(insightMetricSchema),
  paging: pagingSchema,
});

export interface InstagramMediaListInput {
  readonly limit: number;
  readonly after?: string;
  readonly since?: string;
  readonly until?: string;
}

export interface InstagramMediaInsightInput {
  readonly mediaId: string;
  readonly metrics: readonly string[];
}

export interface InstagramAccountInsightInput {
  readonly metrics: readonly string[];
  readonly period?: string;
  readonly since?: string;
  readonly until?: string;
  readonly metricType?: 'time_series' | 'total_value';
}

export class InstagramHistoryProvider {
  constructor(
    private readonly client: MetaApiClient,
    private readonly instagramBusinessAccountId: string,
  ) {}

  async listMedia(input: InstagramMediaListInput) {
    const query: Record<string, string> = {
      fields:
        'id,caption,media_type,media_product_type,permalink,thumbnail_url,timestamp,username,like_count,comments_count',
      limit: String(input.limit),
    };
    if (input.after) query.after = input.after;
    if (input.since) query.since = input.since;
    if (input.until) query.until = input.until;

    const parsed = mediaListSchema.safeParse(
      await this.client.get(`${this.instagramBusinessAccountId}/media`, query),
    );
    if (!parsed.success) throw new Error('INSTAGRAM_MEDIA_LIST_RESPONSE_INVALID');
    return parsed.data;
  }

  async getMediaInsights(input: InstagramMediaInsightInput) {
    const parsed = insightsSchema.safeParse(
      await this.client.get(`${input.mediaId}/insights`, {
        metric: input.metrics.join(','),
      }),
    );
    if (!parsed.success) throw new Error('INSTAGRAM_MEDIA_INSIGHTS_RESPONSE_INVALID');
    return parsed.data;
  }

  async getAccountInsights(input: InstagramAccountInsightInput) {
    const query: Record<string, string> = { metric: input.metrics.join(',') };
    if (input.period) query.period = input.period;
    if (input.since) query.since = input.since;
    if (input.until) query.until = input.until;
    if (input.metricType) query.metric_type = input.metricType;

    const parsed = insightsSchema.safeParse(
      await this.client.get(`${this.instagramBusinessAccountId}/insights`, query),
    );
    if (!parsed.success) throw new Error('INSTAGRAM_ACCOUNT_INSIGHTS_RESPONSE_INVALID');
    return parsed.data;
  }
}
