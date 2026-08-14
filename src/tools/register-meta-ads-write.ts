import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type {
  ControlledCreatePausedPlan,
  MetaAdsControlledWriteService,
} from '../providers/meta-ads/meta-ads-controlled-write.js';

const recordSchema = z.record(z.string(), z.unknown());

const planSchema = z.object({
  account: z.object({
    adAccountId: z.string().min(1),
    currency: z.string().min(3),
  }),
  campaign: z.object({
    name: z.string().min(1),
    objective: z.string().min(1),
    specialAdCategories: z.array(z.string()),
  }),
  adSet: z.object({
    name: z.string().min(1),
    dailyBudgetMinor: z.number().int().positive(),
    billingEvent: z.string().min(1),
    optimizationGoal: z.string().min(1),
    targeting: recordSchema,
    promotedObject: recordSchema,
    startTime: z.string().min(1).optional(),
    endTime: z.string().min(1).optional(),
  }),
  creatives: z
    .array(
      z.object({
        name: z.string().min(1),
        pageId: z.string().min(1),
        instagramActorId: z.string().min(1).optional(),
        objectStorySpec: recordSchema,
      }),
    )
    .min(1)
    .max(10),
  ads: z
    .array(
      z.object({
        name: z.string().min(1),
        creativeIndex: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(10),
});

export function registerMetaAdsWriteTools(
  server: McpServer,
  service: MetaAdsControlledWriteService,
): void {
  server.registerTool(
    'meta_ads.campaign.prepare_paused',
    {
      title: 'Prepare Paused Meta Ads Campaign',
      description:
        'Validate a Meta Ads campaign against TOCA OS guardrails and return its deterministic approval SHA. No provider write occurs.',
      inputSchema: planSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const output = service.prepare(input as ControlledCreatePausedPlan);
      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    'meta_ads.campaign.create_paused',
    {
      title: 'Create Paused Meta Ads Campaign',
      description:
        'Create one campaign, one ad set, creatives, and ads in Meta Ads. Every entity is forced to PAUSED and the request must match the environment-bound approval SHA.',
      inputSchema: z.object({
        plan: planSchema,
        approvalSha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ plan, approvalSha256 }) => {
      const output = await service.createPaused(
        plan as ControlledCreatePausedPlan,
        approvalSha256,
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );
}
