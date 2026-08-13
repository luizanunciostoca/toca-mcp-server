import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { MetaAdsProvider } from '../providers/meta-ads/meta-ads-contracts.js';

const accountInputSchema = z.object({ adAccountId: z.string().min(1), currency: z.string().min(3) });
const insightsInputSchema = accountInputSchema.extend({
  level: z.enum(['account', 'campaign', 'adset', 'ad']).default('campaign'),
  fields: z.array(z.string().min(1)).min(1).max(50),
  since: z.string().min(10),
  until: z.string().min(10),
});
const outputSchema = z.object({ data: z.array(z.unknown()) });
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

export function registerMetaAdsReadTools(server: McpServer, provider: MetaAdsProvider): void {
  server.registerTool('meta_ads.accounts.list', { title: 'List Meta Ad Accounts', inputSchema: z.object({}), outputSchema, annotations }, async () => response(await provider.listAccounts()));
  server.registerTool('meta_ads.campaigns.list', { title: 'List Meta Ads Campaigns', inputSchema: accountInputSchema, outputSchema, annotations }, async (input) => response(await provider.listCampaigns(input)));
  server.registerTool('meta_ads.insights.get', { title: 'Read Meta Ads Insights', inputSchema: insightsInputSchema, outputSchema, annotations }, async (input) => response(await provider.getInsights({ adAccountId: input.adAccountId, currency: input.currency }, { level: input.level, fields: input.fields, since: input.since, until: input.until })));
}

function response(data: readonly unknown[]) {
  const output = { data: [...data] };
  return { content: [{ type: 'text' as const, text: JSON.stringify(output) }], structuredContent: output };
}
