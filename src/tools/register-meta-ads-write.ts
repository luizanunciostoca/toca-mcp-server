import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { AuditSink } from '../core/audit.js';
import { executeTool } from '../core/executor.js';
import type { ExecutionIdentityResolver } from '../core/identity.js';
import type { ToolDefinition, ToolRegistry } from '../core/tool-registry.js';
import {
  requestSha256,
  type ControlledCreatePausedPlan,
  type MetaAdsControlledWriteService,
} from '../providers/meta-ads/meta-ads-controlled-write.js';

const recordSchema = z.record(z.string(), z.unknown());

const planSchema = z.object({
  account: z.object({
    adAccountId: z.string().min(1),
    currency: z.string().length(3),
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

export interface MetaAdsWriteExecutionOptions {
  readonly registry: ToolRegistry;
  readonly auditSink: AuditSink;
  readonly resolveIdentity: ExecutionIdentityResolver;
}

export function registerMetaAdsWriteTools(
  server: McpServer,
  service: MetaAdsControlledWriteService,
  execution: MetaAdsWriteExecutionOptions,
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
    (input) => {
      const output = service.prepare(input as ControlledCreatePausedPlan);
      return response(output);
    },
  );

  server.registerTool(
    'meta_ads.campaign.create_paused',
    {
      title: 'Create Paused Meta Ads Campaign',
      description:
        'Create one campaign, one ad set, creatives, and ads in Meta Ads. Every entity is forced to PAUSED. The capability remains fail-closed until provider-backed production validation promotes it.',
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
    async ({ plan, approvalSha256 }, context) => {
      const typedPlan = plan as ControlledCreatePausedPlan;
      const correlationId = `meta-ads:create-paused:${requestSha256(typedPlan)}`;
      const output = await executeTool({
        tool: requireTool(execution.registry, 'meta_ads.campaign.create_paused'),
        policyContext: {
          identity: execution.resolveIdentity(context),
          connectedAccount: typedPlan.account.adAccountId,
        },
        auditSink: execution.auditSink,
        correlationId,
        action: () => service.createPaused(typedPlan, approvalSha256),
      });
      return response(output);
    },
  );
}

function requireTool(registry: ToolRegistry, name: string): ToolDefinition {
  const tool = registry.get(name);
  if (!tool) throw new Error(`MCP_TOOL_DEFINITION_NOT_FOUND:${name}`);
  return tool;
}

function response(output: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(output) }],
    structuredContent: output as Record<string, unknown>,
  };
}
