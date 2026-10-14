import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { readAg09NativeMetaInsights } from '../measurement/ag09-native-meta-insights.js';
import type { MetaAdsReadProvider } from '../providers/meta-ads/meta-ads-read-provider.js';

const accountInputSchema = z.object({
  adAccountId: z.string().min(1),
  currency: z.string().min(3).max(8),
});

const insightsInputSchema = accountInputSchema.extend({
  level: z.enum(['account', 'campaign', 'adset', 'ad']).default('campaign'),
  fields: z.array(z.string().min(1)).min(1).max(50),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const outputSchema = z.object({ data: z.array(z.unknown()) });
const insightsOutputSchema = outputSchema.extend({
  source: z.object({
    provider: z.literal('META_MARKETING_API'),
    gateway: z.literal('TOCA_MCP_SERVER'),
    repository: z.literal('luizanunciostoca/toca-mcp-server'),
    capability: z.literal('meta_ads.insights.get'),
    reportingTimeZone: z.literal('America/Bahia'),
    externalAggregatorsAccepted: z.literal(false),
  }),
  accountId: z.string(),
  currency: z.string(),
  level: z.enum(['account', 'campaign', 'adset', 'ad']),
  window: z.object({ since: z.string(), until: z.string() }),
  observationState: z.enum(['ROWS_RETURNED', 'NO_ROWS']),
  identicalRowsDiscarded: z.number().int().nonnegative(),
});
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export function registerMetaAdsReadTools(server: McpServer, provider: MetaAdsReadProvider): void {
  server.registerTool(
    'meta_ads.accounts.list',
    { title: 'List Meta Ad Accounts', inputSchema: z.object({}), outputSchema, annotations },
    async () => response(await provider.listAccounts()),
  );

  server.registerTool(
    'meta_ads.campaigns.list',
    {
      title: 'List Meta Ads Campaigns',
      inputSchema: accountInputSchema,
      outputSchema,
      annotations,
    },
    async (input) => response(await provider.listCampaigns(input)),
  );

  server.registerTool(
    'meta_ads.adsets.list',
    { title: 'List Meta Ads Ad Sets', inputSchema: accountInputSchema, outputSchema, annotations },
    async (input) => response(await provider.listAdSets(input)),
  );

  server.registerTool(
    'meta_ads.ads.list',
    { title: 'List Meta Ads Ads', inputSchema: accountInputSchema, outputSchema, annotations },
    async (input) => response(await provider.listAds(input)),
  );

  server.registerTool(
    'meta_ads.insights.get',
    {
      title: 'Read Meta Ads Insights',
      inputSchema: insightsInputSchema,
      outputSchema: insightsOutputSchema,
      annotations,
    },
    async (input) => {
      const result = await readAg09NativeMetaInsights(
        provider,
        { adAccountId: input.adAccountId, currency: input.currency },
        { level: input.level, fields: input.fields, since: input.since, until: input.until },
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        structuredContent: { ...result, data: [...result.data] },
      };
    },
  );
}

function response(data: readonly unknown[]) {
  const output = { data: [...data] };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(output) }],
    structuredContent: output,
  };
}
