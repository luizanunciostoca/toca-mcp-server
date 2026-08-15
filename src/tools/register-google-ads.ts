import { createHash } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { AuditSink } from '../core/audit.js';
import { executeTool, type ProviderReadbackResult } from '../core/executor.js';
import type { ExecutionIdentityResolver } from '../core/identity.js';
import type { ToolDefinition, ToolRegistry } from '../core/tool-registry.js';
import type { ApprovalStore } from '../governance/approval-governance.js';
import type {
  GoogleAdsCampaignPlan,
  GoogleAdsPaidMediaProvider,
} from '../providers/google-ads/google-ads-paid-media.js';
import {
  googleAdsPhaseAtLeast,
  type GoogleAdsPhase,
} from '../providers/google-ads/google-ads-phase.js';

const planSchema = z.object({
  customerId: z.string().min(1),
  currencyCode: z.string().length(3),
  campaignName: z.string().min(1),
  budgetName: z.string().min(1),
  dailyBudgetMicros: z.number().int().positive(),
  advertisingChannelType: z.literal('SEARCH').optional(),
  targeting: z.object({
    locationCriterionIds: z.array(z.string().regex(/^\d+$/)).min(1),
    languageCriterionIds: z.array(z.string().regex(/^\d+$/)).optional(),
    presenceOnly: z.boolean().optional(),
  }),
});

const dateRangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export interface GoogleAdsToolExecutionOptions {
  readonly registry: ToolRegistry;
  readonly auditSink: AuditSink;
  readonly approvalStore: ApprovalStore;
  readonly resolveIdentity: ExecutionIdentityResolver;
  readonly customerId: string;
  readonly currencyCode: string;
}

export function registerGoogleAdsTools(
  server: McpServer,
  provider: GoogleAdsPaidMediaProvider,
  phase: GoogleAdsPhase,
  execution?: GoogleAdsToolExecutionOptions,
): void {
  if (!googleAdsPhaseAtLeast(phase, 'READ_ONLY')) return;

  registerRead(
    server,
    'google_ads.account.inspect',
    'Inspect Google Ads account',
    z.object({}),
    () => provider.inspectAccount(),
  );
  registerRead(
    server,
    'google_ads.campaigns.list',
    'List Google Ads campaigns',
    z.object({ limit: z.number().int().min(1).max(500).optional() }),
    ({ limit }) => provider.listCampaigns(limit),
  );
  registerRead(
    server,
    'google_ads.insights.get',
    'Read Google Ads campaign insights',
    dateRangeSchema.extend({ limit: z.number().int().min(1).max(500).optional() }),
    ({ startDate, endDate, limit }) => provider.getInsights(startDate, endDate, limit),
  );
  registerRead(
    server,
    'google_ads.conversion_actions.list',
    'List Google Ads conversion actions',
    z.object({ limit: z.number().int().min(1).max(500).optional() }),
    ({ limit }) => provider.listConversionActions(limit),
  );
  registerRead(
    server,
    'google_ads.spend.monitor',
    'Monitor Google Ads spend',
    dateRangeSchema,
    ({ startDate, endDate }) => provider.spendMonitor(startDate, endDate),
  );
  registerRead(
    server,
    'google_ads.conversions.monitor',
    'Monitor Google Ads conversions',
    dateRangeSchema,
    ({ startDate, endDate }) => provider.conversionsMonitor(startDate, endDate),
  );

  if (!googleAdsPhaseAtLeast(phase, 'PREPARE')) return;
  registerRead(
    server,
    'google_ads.campaign.prepare',
    'Prepare a PAUSED Google Ads campaign',
    planSchema,
    (plan) => Promise.resolve(provider.prepare(plan as GoogleAdsCampaignPlan)),
  );
  registerRead(
    server,
    'google_ads.targeting.validate',
    'Validate Google Ads targeting without execution',
    planSchema,
    (plan) => provider.validateTargeting(plan as GoogleAdsCampaignPlan),
  );

  if (!googleAdsPhaseAtLeast(phase, 'CREATE_PAUSED') || !execution) return;
  server.registerTool(
    'google_ads.campaign.create_paused',
    {
      title: 'Create PAUSED Google Ads campaign',
      description:
        'Creates budget, PAUSED campaign and targeting atomically. Requires R27 approval, authenticated requester and provider read-back; policy remains fail-closed until PRODUCTION_VALIDATED.',
      inputSchema: z.object({ plan: planSchema, approvalId: z.string().min(1) }),
      annotations: writeAnnotations(false),
    },
    async ({ plan, approvalId }, context) => {
      const typedPlan = plan as GoogleAdsCampaignPlan;
      const prepared = provider.prepare(typedPlan);
      const identity = execution.resolveIdentity(context);
      const correlationId = `google-ads:create-paused:${prepared.requestSha256}`;
      const output = await executeTool({
        tool: requireTool(execution.registry, 'google_ads.campaign.create_paused'),
        policyContext: {
          ...(identity ? { identity } : {}),
          connectedAccount: execution.customerId,
          descriptorSha256: prepared.requestSha256,
          requiredApprovalScope: ['google_ads.campaign.create_paused'],
          financialAmountMinor: provider.minorUnitsForMicros(prepared.plan.dailyBudgetMicros),
          currency: prepared.plan.currencyCode,
        },
        auditSink: execution.auditSink,
        correlationId,
        createExecutionId: () => correlationId,
        action: () => provider.createPaused(typedPlan),
        approvalExecution: {
          approvalId,
          store: execution.approvalStore,
          providerReadback: async (result) => {
            const campaignResourceName = result.campaignResourceName;
            if (typeof campaignResourceName !== 'string') {
              return {
                verified: false,
                evidence: [JSON.stringify(result)],
                reason: 'Provider mutation did not return a campaign resource name.',
              };
            }
            const readback = await provider.verifyPaused(campaignResourceName);
            return {
              verified: readback.verified,
              evidence: [JSON.stringify(readback.evidence)],
              ...(readback.verified
                ? { externalResourceId: campaignResourceName }
                : { reason: 'Campaign provider status is not PAUSED.' }),
            };
          },
        },
      });
      return response(output);
    },
  );

  if (!googleAdsPhaseAtLeast(phase, 'READBACK')) return;
  registerRead(
    server,
    'google_ads.campaign.readback',
    'Read back Google Ads campaign provider state',
    z.object({ campaignIdOrName: z.string().min(1) }),
    ({ campaignIdOrName }) => provider.readbackCampaign(campaignIdOrName),
  );

  if (!googleAdsPhaseAtLeast(phase, 'MANAGE')) return;
  registerStatusWrite(server, provider, execution, 'google_ads.campaign.activate', 'ENABLED');
  registerStatusWrite(server, provider, execution, 'google_ads.campaign.pause', 'PAUSED');

  server.registerTool(
    'google_ads.campaign.update_budget',
    {
      title: 'Update Google Ads campaign budget',
      description:
        'Updates a campaign budget within configured financial guardrails. Requires R27 approval, requester identity and provider read-back.',
      inputSchema: z.object({
        campaignId: z.string().regex(/^\d+$/),
        amountMicros: z.number().int().positive(),
        approvalId: z.string().min(1),
      }),
      annotations: writeAnnotations(true),
    },
    async ({ campaignId, amountMicros, approvalId }, context) => {
      const descriptorSha256 = descriptorHash({ campaignId, amountMicros });
      const identity = execution.resolveIdentity(context);
      const output = await executeTool({
        tool: requireTool(execution.registry, 'google_ads.campaign.update_budget'),
        policyContext: {
          ...(identity ? { identity } : {}),
          connectedAccount: execution.customerId,
          descriptorSha256,
          requiredApprovalScope: ['google_ads.campaign.update_budget'],
          financialAmountMinor: provider.minorUnitsForMicros(amountMicros),
          currency: execution.currencyCode,
        },
        auditSink: execution.auditSink,
        correlationId: `google-ads:update-budget:${descriptorSha256}`,
        action: () => provider.updateBudget(campaignId, amountMicros),
        approvalExecution: {
          approvalId,
          store: execution.approvalStore,
          providerReadback: async () => verifyBudgetReadback(provider, campaignId, amountMicros),
        },
      });
      return response(output);
    },
  );
}

function registerStatusWrite(
  server: McpServer,
  provider: GoogleAdsPaidMediaProvider,
  execution: GoogleAdsToolExecutionOptions,
  capability: 'google_ads.campaign.activate' | 'google_ads.campaign.pause',
  status: 'ENABLED' | 'PAUSED',
): void {
  server.registerTool(
    capability,
    {
      title: status === 'ENABLED' ? 'Activate Google Ads campaign' : 'Pause Google Ads campaign',
      description:
        'Changes Google Ads campaign delivery status only after R27 approval, requester identity and provider read-back.',
      inputSchema: z.object({
        campaignId: z.string().regex(/^\d+$/),
        approvalId: z.string().min(1),
      }),
      annotations: writeAnnotations(true),
    },
    async ({ campaignId, approvalId }, context) => {
      const budgetMicros =
        status === 'ENABLED' ? await provider.readActivationBudgetMicros(campaignId) : undefined;
      const descriptorSha256 = descriptorHash({ campaignId, status, budgetMicros });
      const identity = execution.resolveIdentity(context);
      const output = await executeTool({
        tool: requireTool(execution.registry, capability),
        policyContext: {
          ...(identity ? { identity } : {}),
          connectedAccount: execution.customerId,
          descriptorSha256,
          requiredApprovalScope: [capability],
          ...(budgetMicros !== undefined
            ? {
                financialAmountMinor: provider.minorUnitsForMicros(budgetMicros),
                currency: execution.currencyCode,
              }
            : {}),
        },
        auditSink: execution.auditSink,
        correlationId: `google-ads:${status.toLowerCase()}:${descriptorSha256}`,
        action: () =>
          status === 'ENABLED'
            ? provider.activateCampaign(campaignId)
            : provider.updateStatus(campaignId, 'PAUSED'),
        approvalExecution: {
          approvalId,
          store: execution.approvalStore,
          providerReadback: async () => verifyStatusReadback(provider, campaignId, status),
        },
      });
      return response(output);
    },
  );
}

async function verifyStatusReadback(
  provider: GoogleAdsPaidMediaProvider,
  campaignId: string,
  expected: 'ENABLED' | 'PAUSED',
): Promise<ProviderReadbackResult> {
  const readback = await provider.readbackCampaign(campaignId);
  const rows = readback.results as Array<Record<string, unknown>>;
  const campaign = rows[0]?.campaign as Record<string, unknown> | undefined;
  const verified = campaign?.status === expected;
  return {
    verified,
    evidence: [JSON.stringify(readback)],
    ...(verified ? {} : { reason: `Expected provider campaign status ${expected}.` }),
    ...(typeof campaign?.resourceName === 'string'
      ? { externalResourceId: campaign.resourceName }
      : {}),
  };
}

async function verifyBudgetReadback(
  provider: GoogleAdsPaidMediaProvider,
  campaignId: string,
  expectedMicros: number,
): Promise<ProviderReadbackResult> {
  const readback = await provider.readbackCampaign(campaignId);
  const rows = readback.results as Array<Record<string, unknown>>;
  const budget = rows[0]?.campaignBudget as Record<string, unknown> | undefined;
  const amount = budget?.amountMicros;
  const verified = Number(amount) === expectedMicros;
  return {
    verified,
    evidence: [JSON.stringify(readback)],
    ...(verified ? {} : { reason: 'Provider budget amount does not match requested amount.' }),
  };
}

function registerRead<T extends z.ZodType>(
  server: McpServer,
  name: string,
  title: string,
  inputSchema: T,
  handler: (input: z.infer<T>) => Promise<unknown>,
): void {
  server.registerTool(
    name,
    {
      title,
      description: `${title}. Google Ads API v25; no budget-consuming mutation is performed.`,
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => response(await handler(input as z.infer<T>)),
  );
}

function requireTool(registry: ToolRegistry, name: string): ToolDefinition {
  const tool = registry.get(name);
  if (!tool) throw new Error(`MCP_TOOL_DEFINITION_NOT_FOUND:${name}`);
  return tool;
}

function writeAnnotations(idempotent: boolean) {
  return {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: idempotent,
    openWorldHint: true,
  };
}

function descriptorHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function response(output: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(output) }],
    structuredContent: output as Record<string, unknown>,
  };
}
