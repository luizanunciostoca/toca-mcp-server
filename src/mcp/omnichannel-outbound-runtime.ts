import * as z from 'zod/v4';
import type { ProviderReadbackResult } from '../core/executor.js';
import type {
  CoreCapabilityRuntimeBinding,
  CoreCapabilityRuntimeContext,
  CoreCapabilityRuntimeResolver,
} from './core-execution.js';

const scopeSchema = z.object({
  tenant_id: z.string().min(1),
  workspace_id: z.string().min(1),
  organization_id: z.string().min(1),
  correlation_id: z.string().min(1),
});

const approvalSchema = z.object({
  approval_id: z.string().min(1),
  approval_status: z.literal('APPROVED'),
});

const audienceEligibilitySchema = z.object({
  audience_snapshot_id: z.string().min(1),
  privacy_purpose_id: z.string().min(1),
  resolved_contact_count: z.number().int().min(1),
  ambiguous_contact_count: z.literal(0),
  unresolved_contact_count: z.literal(0),
  privacy_unknown_blocked_count: z.literal(0),
  privacy_suppressed_count: z.literal(0),
  policy_denied_count: z.literal(0),
});

const singleRecipientEligibilitySchema = z.object({
  contact_record_id: z.string().min(1),
  contact_resolution_id: z.string().min(1),
  contact_resolution_status: z.literal('RESOLVED'),
  privacy_execution_id: z.string().min(1),
  privacy_subject_ref: z.string().min(1),
  privacy_state: z.literal('ALLOWED'),
  privacy_blocked: z.literal(false),
  privacy_purpose_id: z.string().min(1),
  privacy_channel: z.enum(['WHATSAPP', 'EMAIL']),
  policy_decision_id: z.string().min(1),
  policy_allowed: z.literal(true),
});

export const emailOutboundSendSchema = scopeSchema
  .extend(audienceEligibilitySchema.shape)
  .extend(approvalSchema.shape)
  .extend({
    message_id: z.string().min(1),
    prepared_campaign_id: z.string().min(1),
    idempotency_key: z.string().min(1),
  });

export const whatsappOutboundSendSchema = scopeSchema
  .extend(singleRecipientEligibilitySchema.shape)
  .extend(approvalSchema.shape)
  .extend({
    message_id: z.string().min(1),
    prepared_message_id: z.string().min(1),
    idempotency_key: z.string().min(1),
  });

export type EmailOutboundRuntimeInput = z.infer<typeof emailOutboundSendSchema>;
export type WhatsAppOutboundRuntimeInput = z.infer<typeof whatsappOutboundSendSchema>;

export interface OmnichannelOutboundSendResult {
  readonly providerMessageId: string;
  readonly provider: string;
  readonly state: 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' | 'UNKNOWN';
  readonly acceptedAt: string;
}

export interface OmnichannelAcceptanceVerificationInput {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly idempotencyKey: string;
  readonly providerMessageId: string;
}

export interface OmnichannelOutboundRuntimeService {
  readonly emailTargetAccount?: string;
  readonly whatsappTargetAccount?: string;
  sendEmail(
    input: EmailOutboundRuntimeInput,
    context: CoreCapabilityRuntimeContext,
  ): Promise<OmnichannelOutboundSendResult>;
  sendWhatsApp(
    input: WhatsAppOutboundRuntimeInput,
    context: CoreCapabilityRuntimeContext,
  ): Promise<OmnichannelOutboundSendResult>;
  verifyEmailAcceptance(
    input: OmnichannelAcceptanceVerificationInput,
  ): Promise<ProviderReadbackResult>;
  verifyWhatsAppAcceptance(
    input: OmnichannelAcceptanceVerificationInput,
  ): Promise<ProviderReadbackResult>;
}

export function resolveOmnichannelOutboundRuntimeBinding(
  capabilityId: string,
  service: OmnichannelOutboundRuntimeService | undefined,
): CoreCapabilityRuntimeBinding | undefined {
  if (!service) return undefined;

  switch (capabilityId) {
    case 'email.campaign.send': {
      const targetAccount = normalized(service.emailTargetAccount);
      if (!targetAccount) return undefined;
      return {
        inputSchema: emailOutboundSendSchema,
        execute: async (input, context) => {
          const parsed = emailOutboundSendSchema.parse(input);
          const execution = requireContext(context);
          assertScopeAndApproval(parsed, execution);
          const result = await service.sendEmail(parsed, execution);
          return {
            provider_dispatch_id: result.providerMessageId,
            provider: result.provider,
            state: result.state,
            accepted_at: result.acceptedAt,
          };
        },
        targetAccount: () => targetAccount,
        idempotencyKey: (input) => emailOutboundSendSchema.parse(input).idempotency_key,
        providerReadback: async (result, input) => {
          const parsedInput = emailOutboundSendSchema.parse(input);
          const parsedResult = emailSendResultSchema.parse(result);
          return service.verifyEmailAcceptance({
            tenantId: parsedInput.tenant_id,
            workspaceId: parsedInput.workspace_id,
            organizationId: parsedInput.organization_id,
            idempotencyKey: parsedInput.idempotency_key,
            providerMessageId: parsedResult.provider_dispatch_id,
          });
        },
        sideEffectValidated: true,
      };
    }
    case 'whatsapp.message.send': {
      const targetAccount = normalized(service.whatsappTargetAccount);
      if (!targetAccount) return undefined;
      return {
        inputSchema: whatsappOutboundSendSchema,
        execute: async (input, context) => {
          const parsed = whatsappOutboundSendSchema.parse(input);
          const execution = requireContext(context);
          assertScopeAndApproval(parsed, execution);
          const result = await service.sendWhatsApp(parsed, execution);
          return {
            provider_message_id: result.providerMessageId,
            provider: result.provider,
            state: result.state,
            accepted_at: result.acceptedAt,
          };
        },
        targetAccount: () => targetAccount,
        idempotencyKey: (input) => whatsappOutboundSendSchema.parse(input).idempotency_key,
        providerReadback: async (result, input) => {
          const parsedInput = whatsappOutboundSendSchema.parse(input);
          const parsedResult = whatsappSendResultSchema.parse(result);
          return service.verifyWhatsAppAcceptance({
            tenantId: parsedInput.tenant_id,
            workspaceId: parsedInput.workspace_id,
            organizationId: parsedInput.organization_id,
            idempotencyKey: parsedInput.idempotency_key,
            providerMessageId: parsedResult.provider_message_id,
          });
        },
        sideEffectValidated: true,
      };
    }
    default:
      return undefined;
  }
}

export function createOmnichannelOutboundRuntimeResolver(
  service: OmnichannelOutboundRuntimeService | undefined,
): CoreCapabilityRuntimeResolver {
  return (capabilityId) => resolveOmnichannelOutboundRuntimeBinding(capabilityId, service);
}

const emailSendResultSchema = z.object({
  provider_dispatch_id: z.string().min(1),
  provider: z.string().min(1),
  state: z.enum(['SUBMITTED', 'ACCEPTED', 'REJECTED', 'UNKNOWN']),
  accepted_at: z.string().datetime({ offset: true }),
});

const whatsappSendResultSchema = z.object({
  provider_message_id: z.string().min(1),
  provider: z.string().min(1),
  state: z.enum(['SUBMITTED', 'ACCEPTED', 'REJECTED', 'UNKNOWN']),
  accepted_at: z.string().datetime({ offset: true }),
});

function requireContext(
  context: CoreCapabilityRuntimeContext | undefined,
): CoreCapabilityRuntimeContext {
  if (!context) throw new Error('OMNICHANNEL_OUTBOUND_EXECUTION_CONTEXT_REQUIRED');
  return context;
}

function assertScopeAndApproval(
  input: {
    readonly tenant_id: string;
    readonly workspace_id: string;
    readonly organization_id: string;
    readonly correlation_id: string;
    readonly approval_id: string;
  },
  context: CoreCapabilityRuntimeContext,
): void {
  const principal = context.identity.principal;
  if (
    principal.tenantId !== input.tenant_id ||
    principal.workspaceId !== input.workspace_id ||
    principal.organizationId !== input.organization_id
  ) {
    throw new Error('OMNICHANNEL_OUTBOUND_SCOPE_MISMATCH');
  }
  if (context.correlationId !== input.correlation_id) {
    throw new Error('OMNICHANNEL_OUTBOUND_CORRELATION_MISMATCH');
  }
  if (!context.approvalId) throw new Error('OMNICHANNEL_OUTBOUND_APPROVAL_CONTEXT_REQUIRED');
  if (context.approvalId !== input.approval_id) {
    throw new Error('OMNICHANNEL_OUTBOUND_APPROVAL_MISMATCH');
  }
}

function normalized(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result || undefined;
}
