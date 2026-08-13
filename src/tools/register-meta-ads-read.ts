import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
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
    { title: 'List Meta Ads Campaigns', inputSchema: accountInputSchema, outputSchema, annotations },
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
    { title: 'Read Meta Ads Insights', inputSchema: insightsInputSchema, outputSchema, annotations },
    async (input) =>
      response(
        await provider.getInsights(
          { adAccountId: input.adAccountId, currency: input.currency },
          { level: input.level, fields: input.fields, since: input.since, until: input.until },
        ),
      ),
  );
}

function response(data: readonly unknown[]) {
  const output = { data: [...data] };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(output) }],
    structuredContent: output,
  };
}
