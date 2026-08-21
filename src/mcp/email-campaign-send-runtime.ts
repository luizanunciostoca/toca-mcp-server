import * as z from 'zod/v4';
import type {
  EmailCampaignSendInput,
  EmailCampaignSendResult,
  EmailCampaignSendRuntime,
} from '../omnichannel/email-campaign-send-runtime.js';
import type {
  CoreCapabilityRuntimeBinding,
  CoreCapabilityRuntimeContext,
} from './core-execution.js';

const emailCampaignSendSchema = z.object({
  tenant_id: z.string().min(1),
  workspace_id: z.string().min(1),
  organization_id: z.string().min(1),
  correlation_id: z.string().min(1),
  audience_snapshot_id: z.string().min(1),
  privacy_purpose_id: z.string().min(1),
  resolved_contact_count: z.number().int().min(1),
  ambiguous_contact_count: z.literal(0),
  unresolved_contact_count: z.literal(0),
  privacy_unknown_blocked_count: z.literal(0),
  privacy_suppressed_count: z.literal(0),
  policy_denied_count: z.literal(0),
  approval_id: z.string().min(1),
  approval_status: z.literal('APPROVED'),
  message_id: z.string().min(1),
  prepared_campaign_id: z.string().min(1),
  idempotency_key: z.string().min(1),
});

export function resolveEmailCampaignSendRuntimeBinding(
  capabilityId: string,
  runtime: EmailCampaignSendRuntime | undefined,
): CoreCapabilityRuntimeBinding | undefined {
  if (capabilityId !== 'email.campaign.send' || !runtime) return undefined;
  return {
    inputSchema: emailCampaignSendSchema,
    execute: async (value, context) => {
      const input = emailCampaignSendSchema.parse(value);
      const execution = requireContext(context);
      assertScope(input, execution);
      if (input.correlation_id !== execution.correlationId) {
        throw new Error('EMAIL_CORRELATION_MISMATCH');
      }
      const result = await runtime.send(toDomainInput(input), {
        actorPrincipalId: execution.identity.principal.principalId,
        executionId: execution.executionId,
        correlationId: execution.correlationId,
      });
      return toWireResult(result);
    },
    targetAccount: () => runtime.targetAccount(),
    idempotencyKey: (value) => emailCampaignSendSchema.parse(value).idempotency_key,
    providerReadback: async (result, value) => {
      const parsedResult = parseResult(result);
      const input = toDomainInput(emailCampaignSendSchema.parse(value));
      return runtime.readback(parsedResult, input);
    },
    sideEffectValidated: true,
  };
}

function toDomainInput(input: z.infer<typeof emailCampaignSendSchema>): EmailCampaignSendInput {
  return {
    tenantId: input.tenant_id,
    workspaceId: input.workspace_id,
    organizationId: input.organization_id,
    correlationId: input.correlation_id,
    audienceSnapshotId: input.audience_snapshot_id,
    privacyPurposeId: input.privacy_purpose_id,
    resolvedContactCount: input.resolved_contact_count,
    ambiguousContactCount: input.ambiguous_contact_count,
    unresolvedContactCount: input.unresolved_contact_count,
    privacyUnknownBlockedCount: input.privacy_unknown_blocked_count,
    privacySuppressedCount: input.privacy_suppressed_count,
    policyDeniedCount: input.policy_denied_count,
    approvalId: input.approval_id,
    messageId: input.message_id,
    preparedCampaignRef: input.prepared_campaign_id,
    idempotencyKey: input.idempotency_key,
  };
}

function toWireResult(result: EmailCampaignSendResult) {
  return {
    provider_dispatch_id: result.providerDispatchId,
    provider: result.provider,
    state: result.state,
    accepted_at: result.acceptedAt,
  };
}

function parseResult(value: unknown): EmailCampaignSendResult {
  const parsed = z
    .object({
      provider_dispatch_id: z.string().min(1),
      provider: z.string().min(1),
      state: z.enum(['SUBMITTED', 'ACCEPTED', 'REJECTED', 'UNKNOWN']),
      accepted_at: z.string().min(1),
    })
    .parse(value);
  if (!Number.isFinite(Date.parse(parsed.accepted_at))) {
    throw new Error('EMAIL_ACCEPTED_AT_INVALID');
  }
  return {
    providerDispatchId: parsed.provider_dispatch_id,
    provider: parsed.provider,
    state: parsed.state,
    acceptedAt: parsed.accepted_at,
  };
}

function requireContext(
  context: CoreCapabilityRuntimeContext | undefined,
): CoreCapabilityRuntimeContext {
  if (!context) throw new Error('EMAIL_CORE_EXECUTION_CONTEXT_REQUIRED');
  return context;
}

function assertScope(
  input: z.infer<typeof emailCampaignSendSchema>,
  context: CoreCapabilityRuntimeContext,
): void {
  const principal = context.identity.principal;
  if (
    input.tenant_id !== principal.tenantId ||
    input.workspace_id !== principal.workspaceId ||
    input.organization_id !== principal.organizationId
  ) {
    throw new Error('EMAIL_CAMPAIGN_SCOPE_MISMATCH');
  }
}
