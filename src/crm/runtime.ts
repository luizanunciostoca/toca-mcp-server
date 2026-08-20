import * as z from 'zod/v4';
import type { ExecutionIdentity } from '../core/identity.js';
import type { ToolDefinition } from '../core/tool-registry.js';
import type {
  CoreCapabilityRuntimeBinding,
  CoreCapabilityRuntimeContext,
} from '../mcp/core-execution.js';
import type { CrmCoreStore, CrmMutationMetadata, CrmScope } from './crm-records.js';
import {
  calculateInitialSla,
  recommendQualification,
  routeLeadDeterministically,
  scoreLeadDeterministically,
  type CrmSalesStore,
  type LeadScoringResult,
  type SalesPipelineStage,
} from './sales-engine.js';

export const CRM_SALES_RUNTIME_CAPABILITY_IDS = [
  'sales.lead.enrich',
  'sales.lead.create',
  'sales.lead.qualify',
  'sales.pipeline.update',
  'sales.followup.create',
  'sales.followup.schedule',
  'sales.report.generate',
] as const;

export type CrmSalesRuntimeCapabilityId = (typeof CRM_SALES_RUNTIME_CAPABILITY_IDS)[number];

export const CRM_SALES_RUNTIME_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  crmTool('sales.lead.enrich', 'READ', false),
  crmTool('sales.lead.create', 'WRITE_REVERSIBLE', true),
  crmTool('sales.lead.qualify', 'WRITE_REVERSIBLE', true),
  crmTool('sales.pipeline.update', 'WRITE_REVERSIBLE', true),
  crmTool('sales.followup.create', 'WRITE_REVERSIBLE', true),
  crmTool('sales.followup.schedule', 'WRITE_REVERSIBLE', true),
  crmTool('sales.report.generate', 'READ', false),
];

const urgencySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'IMMEDIATE']);
const pipelineStageSchema = z.enum([
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'OPPORTUNITY',
  'WON',
  'LOST',
  'NURTURE',
]);
const channelSchema = z.enum([
  'WHATSAPP',
  'EMAIL',
  'INSTAGRAM',
  'PHONE',
  'WEB',
  'IN_PERSON',
  'OTHER',
]);
const mutationEvidenceSchema = z.array(z.string().min(1)).min(1).max(50);
const idempotencySchema = z.string().min(1).max(255);
const optionalTimestampSchema = z.string().datetime({ offset: true }).optional();
const optionalNullableTimestampSchema = z.string().datetime({ offset: true }).nullable().optional();

const contactSearchSchema = z.object({
  channels: z
    .array(
      z.object({
        channelType: z.enum(['EMAIL', 'PHONE', 'SOCIAL', 'OTHER']),
        provider: z.string().min(1).max(100).nullable().optional(),
        value: z.string().min(1).max(500),
      }),
    )
    .min(1)
    .max(20),
});

const scoringSignalsSchema = z.object({
  intentStrength: z.number().int().min(0).max(4),
  urgency: urgencySchema,
  propensity: z.number().min(0).max(1),
  estimatedValueMinor: z.number().int().nonnegative().nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
  visitEventAt: z.string().datetime({ offset: true }).nullable().optional(),
  engagementSignals: z.number().int().nonnegative().max(100).optional(),
  aiScore: z.number().min(0).max(100).nullable().optional(),
});

const leadCreateSchema = z
  .object({
    idempotencyKey: idempotencySchema,
    evidence: mutationEvidenceSchema,
    leadId: z.string().min(1).max(255),
    contactId: z.string().min(1).max(255),
    eventId: z.string().min(1).max(255).nullable().optional(),
    sourceType: z.string().min(1).max(120),
    sourceRef: z.string().min(1).max(500).nullable().optional(),
    capturedAt: optionalTimestampSchema,
    eligibleOwnerPrincipalIds: z.array(z.string().min(1).max(255)).min(1).max(100).optional(),
    preferredOwnerPrincipalId: z.string().min(1).max(255).nullable().optional(),
    language: z.string().min(2).max(35).optional(),
    campaignRef: z.string().min(1).max(500).nullable().optional(),
    intent: z.string().min(1).max(120).nullable().optional(),
  })
  .extend(scoringSignalsSchema.shape)
  .superRefine((input, ctx) => validateMoneyPair(input.estimatedValueMinor, input.currency, ctx));

const qualifyLeadSchema = z
  .object({
    idempotencyKey: idempotencySchema,
    evidence: mutationEvidenceSchema,
    qualificationDecisionId: z.string().min(1).max(255),
    leadScoreObservationId: z.string().min(1).max(255),
    leadId: z.string().min(1).max(255),
    pipelineKey: z.string().min(1).max(255),
    fromStage: z.enum(['CONTACTED', 'NURTURE']),
    intent: z.string().min(1).max(120).nullable().optional(),
    campaignRef: z.string().min(1).max(500).nullable().optional(),
    sourceRef: z.string().min(1).max(500).nullable().optional(),
    hasVerifiedContactPath: z.boolean(),
    explicitOptOut: z.boolean().default(false),
    humanOverride: z.enum(['QUALIFIED', 'NURTURE', 'DISQUALIFIED']).nullable().optional(),
    rationale: z.string().min(1).max(2_000).optional(),
  })
  .extend(scoringSignalsSchema.shape)
  .superRefine((input, ctx) => validateMoneyPair(input.estimatedValueMinor, input.currency, ctx));

const opportunityUpdateSchema = z
  .object({
    idempotencyKey: idempotencySchema,
    evidence: mutationEvidenceSchema,
    opportunityId: z.string().min(1).max(255),
    expectedVersion: z.number().int().positive(),
    pipelineKey: z.string().min(1).max(255),
    fromStage: z.literal('OPPORTUNITY'),
    toStage: z.enum(['WON', 'LOST', 'NURTURE']),
    stageKey: z.string().min(1).max(255),
    status: z.enum(['OPEN', 'WON', 'LOST']),
    lossReason: z.string().min(1).max(1_000).nullable().optional(),
    valueMinor: z.number().int().nonnegative().nullable().optional(),
    currency: z.string().length(3).nullable().optional(),
    ownerPrincipalId: z.string().min(1).max(255).nullable().optional(),
    nextAction: z.string().min(1).max(2_000).nullable().optional(),
    nextActionAt: optionalNullableTimestampSchema,
    reason: z.string().min(1).max(2_000),
  })
  .superRefine((input, ctx) => {
    validateMoneyPair(input.valueMinor, input.currency, ctx);
    if (input.toStage === 'WON' && input.status !== 'WON') {
      ctx.addIssue({ code: 'custom', message: 'CRM_RUNTIME_WON_STATUS_MISMATCH' });
    }
    if (input.toStage === 'LOST' && input.status !== 'LOST') {
      ctx.addIssue({ code: 'custom', message: 'CRM_RUNTIME_LOST_STATUS_MISMATCH' });
    }
    if (input.toStage === 'NURTURE' && input.status !== 'OPEN') {
      ctx.addIssue({ code: 'custom', message: 'CRM_RUNTIME_NURTURE_STATUS_MISMATCH' });
    }
  });

const activitySchema = z.object({
  idempotencyKey: idempotencySchema,
  evidence: mutationEvidenceSchema,
  activityId: z.string().min(1).max(255),
  contactId: z.string().min(1).max(255),
  leadId: z.string().min(1).max(255).nullable().optional(),
  opportunityId: z.string().min(1).max(255).nullable().optional(),
  conversationId: z.string().min(1).max(255).nullable().optional(),
  activityType: z.enum([
    'CONTACT_ATTEMPT',
    'RESPONSE',
    'QUALIFICATION',
    'NOTE',
    'CALL',
    'MEETING',
    'PROPOSAL',
    'FOLLOW_UP',
    'HUMAN_HANDOFF',
    'ESCALATION',
    'REACTIVATION',
    'POST_SALE',
  ]),
  channel: channelSchema.nullable().optional(),
  summary: z.string().min(1).max(4_000),
  outcome: z.string().min(1).max(1_000).nullable().optional(),
  occurredAt: optionalTimestampSchema,
  stageTransition: z
    .object({
      pipelineKey: z.string().min(1).max(255),
      fromStage: pipelineStageSchema,
      toStage: pipelineStageSchema,
      reason: z.string().min(1).max(2_000),
    })
    .optional(),
});

const nextActionSchema = z.object({
  idempotencyKey: idempotencySchema,
  evidence: mutationEvidenceSchema,
  nextActionId: z.string().min(1).max(255),
  contactId: z.string().min(1).max(255),
  leadId: z.string().min(1).max(255).nullable().optional(),
  opportunityId: z.string().min(1).max(255).nullable().optional(),
  actionType: z.enum([
    'CONTACT',
    'FOLLOW_UP',
    'QUALIFY',
    'CREATE_OPPORTUNITY',
    'PROPOSAL',
    'REACTIVATE',
    'HUMAN_HANDOFF',
    'ESCALATE',
    'POST_SALE',
    'CLOSE_LOST',
  ]),
  title: z.string().min(1).max(500),
  rationale: z.string().min(1).max(2_000),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  ownerPrincipalId: z.string().min(1).max(255).nullable().optional(),
  playbookKey: z.string().min(1).max(255).nullable().optional(),
  dueAt: optionalNullableTimestampSchema,
});

const pipelineQuerySchema = z.object({
  pipelineKey: z.string().min(1).max(255).optional(),
  stages: z.array(pipelineStageSchema).min(1).max(7).optional(),
  ownerPrincipalId: z.string().min(1).max(255).optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

export interface CrmSalesRuntimeServices {
  readonly core: CrmCoreStore;
  readonly sales: CrmSalesStore;
}

export function resolveCrmSalesRuntimeBinding(
  capabilityId: string,
  services: CrmSalesRuntimeServices | undefined,
): CoreCapabilityRuntimeBinding | undefined {
  if (!services) return undefined;
  switch (capabilityId) {
    case 'sales.lead.enrich':
      return readBinding(contactSearchSchema, async (input, context) => {
        const scope = scopeFromContext(context);
        return services.sales.resolveContact({ ...scope, channels: input.channels });
      });
    case 'sales.lead.create':
      return mutationBinding(
        leadCreateSchema,
        (input) => input.idempotencyKey,
        async (input, context) => {
          const scope = scopeFromContext(context);
          const metadata = metadataFromContext(input, context);
          const now = new Date().toISOString();
          const capturedAt = input.capturedAt ?? now;
          const scoring = scoreFromSignals(input, capturedAt);
          const sla = calculateInitialSla(capturedAt, scoring.temperature);
          const assignment = input.eligibleOwnerPrincipalIds
            ? routeLeadDeterministically({
                leadId: input.leadId,
                eligibleOwnerPrincipalIds: input.eligibleOwnerPrincipalIds,
                preferredOwnerPrincipalId: input.preferredOwnerPrincipalId,
              })
            : undefined;
          return services.core.createLead({
            ...scope,
            ...metadata,
            leadId: input.leadId,
            contactId: input.contactId,
            ...(input.eventId !== undefined ? { eventId: input.eventId } : {}),
            sourceType: input.sourceType,
            ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}),
            score: scoring.effectiveScore,
            ...(assignment ? { ownerPrincipalId: assignment.ownerPrincipalId } : {}),
            slaDueAt: sla.firstResponseDueAt,
            capturedAt,
            attributes: {
              language: input.language ?? 'und',
              intent: input.intent ?? null,
              campaign_ref: input.campaignRef ?? null,
              temperature: scoring.temperature,
              urgency: input.urgency,
              propensity: input.propensity,
              scoring_rule_version: scoring.ruleVersion,
              deterministic_score: scoring.deterministicScore,
              ai_score: scoring.aiScore,
              ...(assignment ? { routing_rule: assignment.routingRule } : {}),
            },
          });
        },
        async (result) => {
          const record = leadResult(result);
          const persisted = await services.core.getLead({
            tenantId: record.tenantId,
            workspaceId: record.workspaceId,
            organizationId: record.organizationId,
            leadId: record.leadId,
          });
          return readback(Boolean(persisted && persisted.version === record.version), record.leadId, [
            `crm:postgres:lead:${record.leadId}:version:${record.version}`,
          ]);
        },
      );
    case 'sales.lead.qualify':
      return mutationBinding(
        qualifyLeadSchema,
        (input) => input.idempotencyKey,
        async (input, context) => {
          const scope = scopeFromContext(context);
          const metadata = metadataFromContext(input, context);
          assertHumanOverrideAuthorized(input.humanOverride, context.identity);
          const now = new Date().toISOString();
          const scoring = scoreFromSignals(input, now);
          const recommendation = recommendQualification({
            scoring,
            hasVerifiedContactPath: input.hasVerifiedContactPath,
            explicitOptOut: input.explicitOptOut,
            humanOverride: input.humanOverride,
          });
          return services.sales.qualifyLead({
            ...scope,
            ...metadata,
            qualificationDecisionId: input.qualificationDecisionId,
            leadScoreObservationId: input.leadScoreObservationId,
            leadId: input.leadId,
            outcome: recommendation.outcome,
            authority: recommendation.authority,
            scoring,
            ...(input.intent !== undefined ? { intent: input.intent } : {}),
            urgency: input.urgency,
            propensity: input.propensity,
            ...(input.estimatedValueMinor !== undefined
              ? { estimatedValueMinor: input.estimatedValueMinor }
              : {}),
            ...(input.currency !== undefined ? { currency: input.currency } : {}),
            ...(input.visitEventAt !== undefined ? { visitEventAt: input.visitEventAt } : {}),
            ...(input.campaignRef !== undefined ? { campaignRef: input.campaignRef } : {}),
            ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}),
            rationale: input.rationale ?? recommendation.rationale,
            pipelineKey: input.pipelineKey,
            fromStage: input.fromStage,
          });
        },
        async (result) => {
          const decision = qualificationResult(result);
          const persisted = await services.sales.getQualificationDecision({
            tenantId: decision.tenantId,
            workspaceId: decision.workspaceId,
            organizationId: decision.organizationId,
            qualificationDecisionId: decision.qualificationDecisionId,
          });
          return readback(Boolean(persisted), decision.qualificationDecisionId, [
            `crm:postgres:qualification:${decision.qualificationDecisionId}`,
          ]);
        },
      );
    case 'sales.pipeline.update':
      return mutationBinding(
        opportunityUpdateSchema,
        (input) => input.idempotencyKey,
        async (input, context) =>
          services.sales.updateOpportunity({
            ...scopeFromContext(context),
            ...metadataFromContext(input, context),
            opportunityId: input.opportunityId,
            expectedVersion: input.expectedVersion,
            pipelineKey: input.pipelineKey,
            fromStage: input.fromStage,
            toStage: input.toStage,
            stageKey: input.stageKey,
            status: input.status,
            ...(input.lossReason !== undefined ? { lossReason: input.lossReason } : {}),
            ...(input.valueMinor !== undefined ? { valueMinor: input.valueMinor } : {}),
            ...(input.currency !== undefined ? { currency: input.currency } : {}),
            ...(input.ownerPrincipalId !== undefined
              ? { ownerPrincipalId: input.ownerPrincipalId }
              : {}),
            ...(input.nextAction !== undefined ? { nextAction: input.nextAction } : {}),
            ...(input.nextActionAt !== undefined ? { nextActionAt: input.nextActionAt } : {}),
            reason: input.reason,
          }),
        async (result) => {
          const stage = stageResult(result);
          if (!stage.opportunityId) return readback(false, stage.stageHistoryId, []);
          const persisted = await services.core.getOpportunity({
            tenantId: stage.tenantId,
            workspaceId: stage.workspaceId,
            organizationId: stage.organizationId,
            opportunityId: stage.opportunityId,
          });
          const expectedStatus = stage.toStage === 'WON' ? 'WON' : stage.toStage === 'LOST' ? 'LOST' : 'OPEN';
          return readback(Boolean(persisted?.status === expectedStatus), stage.opportunityId, [
            `crm:postgres:opportunity:${stage.opportunityId}:status:${persisted?.status ?? 'missing'}`,
          ]);
        },
      );
    case 'sales.followup.create':
      return mutationBinding(
        activitySchema,
        (input) => input.idempotencyKey,
        async (input, context) =>
          services.sales.appendActivity({
            ...scopeFromContext(context),
            ...metadataFromContext(input, context),
            activityId: input.activityId,
            contactId: input.contactId,
            ...(input.leadId !== undefined ? { leadId: input.leadId } : {}),
            ...(input.opportunityId !== undefined ? { opportunityId: input.opportunityId } : {}),
            ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}),
            activityType: input.activityType,
            ...(input.channel !== undefined ? { channel: input.channel } : {}),
            summary: input.summary,
            ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
            ...(input.occurredAt !== undefined ? { occurredAt: input.occurredAt } : {}),
            ...(input.stageTransition !== undefined
              ? { stageTransition: input.stageTransition }
              : {}),
          }),
        async (result) => {
          const activity = activityResult(result);
          const persisted = await services.sales.getActivity({
            tenantId: activity.tenantId,
            workspaceId: activity.workspaceId,
            organizationId: activity.organizationId,
            activityId: activity.activityId,
          });
          return readback(Boolean(persisted), activity.activityId, [
            `crm:postgres:activity:${activity.activityId}`,
          ]);
        },
      );
    case 'sales.followup.schedule':
      return mutationBinding(
        nextActionSchema,
        (input) => input.idempotencyKey,
        async (input, context) =>
          services.sales.scheduleNextAction({
            ...scopeFromContext(context),
            ...metadataFromContext(input, context),
            nextActionId: input.nextActionId,
            contactId: input.contactId,
            ...(input.leadId !== undefined ? { leadId: input.leadId } : {}),
            ...(input.opportunityId !== undefined ? { opportunityId: input.opportunityId } : {}),
            actionType: input.actionType,
            title: input.title,
            rationale: input.rationale,
            priority: input.priority,
            ...(input.ownerPrincipalId !== undefined
              ? { ownerPrincipalId: input.ownerPrincipalId }
              : {}),
            ...(input.playbookKey !== undefined ? { playbookKey: input.playbookKey } : {}),
            ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
          }),
        async (result) => {
          const action = nextActionResult(result);
          const persisted = await services.sales.getNextAction({
            tenantId: action.tenantId,
            workspaceId: action.workspaceId,
            organizationId: action.organizationId,
            nextActionId: action.nextActionId,
          });
          return readback(Boolean(persisted), action.nextActionId, [
            `crm:postgres:next-action:${action.nextActionId}`,
          ]);
        },
      );
    case 'sales.report.generate':
      return readBinding(pipelineQuerySchema, async (input, context) =>
        services.sales.queryPipeline({
          ...scopeFromContext(context),
          ...(input.pipelineKey !== undefined ? { pipelineKey: input.pipelineKey } : {}),
          ...(input.stages !== undefined ? { stages: input.stages } : {}),
          ...(input.ownerPrincipalId !== undefined
            ? { ownerPrincipalId: input.ownerPrincipalId }
            : {}),
          limit: input.limit,
        }),
      );
    default:
      return undefined;
  }
}

function crmTool(
  name: CrmSalesRuntimeCapabilityId,
  riskClass: ToolDefinition['riskClass'],
  sideEffects: boolean,
): ToolDefinition {
  return {
    name,
    version: '1.0.0',
    provider: 'TOCA_OS CRM/PostgreSQL',
    riskClass,
    requiredScopes: [],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects,
    idempotent: true,
  };
}

function readBinding<T>(
  schema: z.ZodType<T>,
  execute: (input: T, context: CoreCapabilityRuntimeContext) => Promise<unknown>,
): CoreCapabilityRuntimeBinding {
  return {
    inputSchema: schema,
    execute: async (input, context) => execute(schema.parse(input), requireContext(context)),
  };
}

function mutationBinding<T>(
  schema: z.ZodType<T>,
  idempotencyKey: (input: T) => string,
  execute: (input: T, context: CoreCapabilityRuntimeContext) => Promise<unknown>,
  providerReadback: (result: unknown, input: T) => Promise<{
    readonly verified: boolean;
    readonly evidence: readonly string[];
    readonly externalResourceId?: string;
    readonly reason?: string;
  }>,
): CoreCapabilityRuntimeBinding {
  return {
    inputSchema: schema,
    execute: async (input, context) => execute(schema.parse(input), requireContext(context)),
    idempotencyKey: (input) => idempotencyKey(schema.parse(input)),
    providerReadback: (result, input) => providerReadback(result, schema.parse(input)),
    sideEffectValidated: false,
  };
}

function scopeFromContext(context: CoreCapabilityRuntimeContext): CrmScope {
  const principal = context.identity.principal;
  return {
    tenantId: principal.tenantId,
    workspaceId: principal.workspaceId,
    organizationId: principal.organizationId,
  };
}

function metadataFromContext(
  input: { readonly idempotencyKey: string; readonly evidence: readonly string[] },
  context: CoreCapabilityRuntimeContext,
): CrmMutationMetadata {
  const principal = context.identity.principal;
  return {
    idempotencyKey: input.idempotencyKey,
    executionId: context.executionId,
    correlationId: context.correlationId,
    actorPrincipalId: principal.principalId,
    evidence: [...new Set([...principal.evidence, ...context.identity.authorization.evidence, ...input.evidence])],
  };
}

function scoreFromSignals(
  input: z.infer<typeof scoringSignalsSchema>,
  now: string,
): LeadScoringResult {
  return scoreLeadDeterministically({
    intentStrength: input.intentStrength as 0 | 1 | 2 | 3 | 4,
    urgency: input.urgency,
    propensity: input.propensity,
    ...(input.estimatedValueMinor !== undefined
      ? { estimatedValueMinor: input.estimatedValueMinor }
      : {}),
    ...(input.visitEventAt !== undefined ? { visitEventAt: input.visitEventAt } : {}),
    now,
    ...(input.engagementSignals !== undefined ? { engagementSignals: input.engagementSignals } : {}),
    ...(input.aiScore !== undefined ? { aiScore: input.aiScore } : {}),
  });
}

function assertHumanOverrideAuthorized(
  humanOverride: 'QUALIFIED' | 'NURTURE' | 'DISQUALIFIED' | null | undefined,
  identity: ExecutionIdentity,
): void {
  if (!humanOverride) return;
  if (!identity.authorization.roles.some((role) => role === 'APPROVER' || role === 'ADMIN')) {
    throw new Error('CRM_RUNTIME_HUMAN_OVERRIDE_NOT_AUTHORIZED');
  }
}

function validateMoneyPair(
  valueMinor: number | null | undefined,
  currency: string | null | undefined,
  ctx: z.RefinementCtx,
): void {
  const hasValue = valueMinor !== undefined && valueMinor !== null;
  const hasCurrency = currency !== undefined && currency !== null;
  if (hasValue !== hasCurrency) {
    ctx.addIssue({ code: 'custom', message: 'CRM_RUNTIME_MONEY_PAIR_REQUIRED' });
  }
}

function requireContext(
  context: CoreCapabilityRuntimeContext | undefined,
): CoreCapabilityRuntimeContext {
  if (!context) throw new Error('CRM_RUNTIME_EXECUTION_CONTEXT_REQUIRED');
  return context;
}

function readback(
  verified: boolean,
  externalResourceId: string,
  evidence: readonly string[],
): {
  readonly verified: boolean;
  readonly evidence: readonly string[];
  readonly externalResourceId: string;
  readonly reason?: string;
} {
  return {
    verified,
    evidence,
    externalResourceId,
    ...(!verified ? { reason: 'CRM_POSTGRES_READBACK_MISMATCH' } : {}),
  };
}

function leadResult(result: unknown) {
  return result as {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly organizationId: string;
    readonly leadId: string;
    readonly version: number;
  };
}

function qualificationResult(result: unknown) {
  return result as {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly organizationId: string;
    readonly qualificationDecisionId: string;
  };
}

function stageResult(result: unknown) {
  return result as {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly organizationId: string;
    readonly stageHistoryId: string;
    readonly opportunityId: string | null;
    readonly toStage: SalesPipelineStage;
  };
}

function activityResult(result: unknown) {
  return result as {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly organizationId: string;
    readonly activityId: string;
  };
}

function nextActionResult(result: unknown) {
  return result as {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly organizationId: string;
    readonly nextActionId: string;
  };
}
