import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { InstagramHistoryProvider } from '../providers/instagram/instagram-history-provider.js';

const mediaListInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  after: z.string().min(1).optional(),
  since: z.string().min(1).optional(),
  until: z.string().min(1).optional(),
});

const mediaInsightsInputSchema = z.object({
  mediaId: z.string().min(1),
  metrics: z.array(z.string().min(1)).min(1).max(50),
});

const accountInsightsInputSchema = z.object({
  metrics: z.array(z.string().min(1)).min(1).max(50),
  period: z.string().min(1).optional(),
  since: z.string().min(1).optional(),
  until: z.string().min(1).optional(),
  metricType: z.enum(['time_series', 'total_value']).optional(),
});

const passthroughOutputSchema = z.object({
  data: z.array(z.unknown()),
  paging: z.unknown().optional(),
});

export function registerInstagramHistoryTools(
  server: McpServer,
  provider: InstagramHistoryProvider,
): void {
  server.registerTool(
    'instagram.media.list',
    {
      title: 'List Instagram Media',
      description: 'Read Instagram Business media metadata for TOCA_OS analysis. No side effects.',
      inputSchema: mediaListInputSchema,
      outputSchema: passthroughOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => response(await provider.listMedia(input)),
  );

  server.registerTool(
    'instagram.insights.media',
    {
      title: 'Read Instagram Media Insights',
      description:
        'Read provider metrics for one Instagram media ID. Metric names are supplied by the caller so TOCA_OS can follow the active Graph API contract.',
      inputSchema: mediaInsightsInputSchema,
      outputSchema: passthroughOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => response(await provider.getMediaInsights(input)),
  );

  server.registerTool(
    'instagram.insights.account',
    {
      title: 'Read Instagram Account Insights',
      description:
        'Read provider metrics for the configured Instagram Business Account. Metric names and windows are request-scoped.',
      inputSchema: accountInsightsInputSchema,
      outputSchema: passthroughOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => response(await provider.getAccountInsights(input)),
  );
}

function response(output: { data: unknown[]; paging?: unknown }) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(output) }],
    structuredContent: output,
  };
}
