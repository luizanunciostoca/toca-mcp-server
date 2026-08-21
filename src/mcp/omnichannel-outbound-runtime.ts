import * as z from 'zod/v4';
import type { ApprovalStore } from '../governance/approval-governance.js';
import type {
  OutboundEligibilityContext,
  ProviderMessageReadback,
} from '../omnichannel/contracts.js';
import type { OmnichannelProviderEventReadbackService } from '../omnichannel/provider-event-readback.js';
import type { WhatsAppOutboundRuntime } from '../omnichannel/whatsapp-runtime.js';
import type { CrmMessageRecordReader } from '../persistence/postgres-crm-message-record-reader.js';
import type {
  CoreCapabilityRuntimeBinding,
  CoreCapabilityRuntimeContext,
  CoreCapabilityRuntimeResolver,
} from './core-execution.js';

const whatsappSendSchema = z
  .object({
    tenant_id: z.string().min(1),
    workspace_id: z.string().min(1),
    organization_id: z.string().min(1),
    correlation_id: z.string().min(1),
    contact_record_id: z.string().min(1),
    contact_resolution_id: z.string().min(1),
    contact_resolution_status: z.literal('RESOLVED'),
    privacy_execution_id: z.string().min(1),
    privacy_subject_ref: z.string().min(1),
    privacy_state: z.literal('ALLOWED'),
    privacy_blocked: z.literal(false),
    privacy_purpose_id: z.string().min(1),
    privacy_channel: z.literal('WHATSAPP'),
    policy_decision_id: z.string().min(1),
    policy_allowed: z.literal(true),
    approval_id: z.string().min(1),
    approval_status: z.literal('APPROVED'),
    message_id: z.string().min(1),
    prepared_message_id: z.string().min(1),
    idempotency_key: z.string().min(1),
  })
  .strict();

const whatsappSendResultSchema = z
  .object({
    provider_message_id: z.string().min(1),
    provider: z.string().min(1),
    state: z.enum(['SUBMITTED', 'ACCEPTED', 'REJECTED', 'UNKNOWN']),
    accepted_at: z.string().min(1),
  })
  .strict();

type WhatsAppSendInput = z.infer<typeof whatsappSendSchema>;
type WhatsAppSendResult = z.infer<typeof whatsappSendResultSchema>;

export interface WhatsAppOutboundRuntimeBindingDependencies {
  readonly runtime: Pick<WhatsAppOutboundRuntime, 'send'>;
  readonly messages: CrmMessageRecordReader;
  readonly approvalStore: Pick<ApprovalStore, 'get'>;
  readonly providerEventReadback: Pick<OmnichannelProviderEventReadbackService, 'readWhatsApp'>;
  readonly targetAccount: string;
}

export function resolveWhatsAppOutboundRuntimeBinding(
  capabilityId: string,
  dependencies: WhatsAppOutboundRuntimeBindingDependencies | undefined,
): CoreCapabilityRuntimeBinding | undefined {
  if (capabilityId !== 'whatsapp.message.send' || !dependencies) return undefined;

  return {
    inputSchema: whatsappSendSchema,
    targetAccount: () => dependencies.targetAccount,
    idempotencyKey: (input) => whatsappSendSchema.parse(input).idempotency_key,
    sideEffectValidated: true,
    execute: async (input, context) => {
      const parsed = whatsappSendSchema.parse(input);
      const runtimeContext = requireRuntimeContext(context);
      assertScope(parsed, runtimeContext);
      if (runtimeContext.correlationId !== parsed.correlation_id) {
        throw new Error('WHATSAPP_CORE_CORRELATION_MISMATCH');
      }
      await assertReservedApproval(parsed, runtimeContext, dependencies.approvalStore);

      const message = await dependencies.messages.getMessage({
        tenantId: parsed.tenant_id,
        workspaceId: parsed.workspace_id,
        organizationId: parsed.organization_id,
        messageId: parsed.message_id,
      });
      if (!message) throw new Error('WHATSAPP_MESSAGE_RECORD_NOT_FOUND');
      if (message.contentRef !== parsed.prepared_message_id) {
        throw new Error('WHATSAPP_MESSAGE_PREPARED_REF_MISMATCH');
      }

      const eligibility: OutboundEligibilityContext = {
        tenantId: parsed.tenant_id,
        workspaceId: parsed.workspace_id,
        organizationId: parsed.organization_id,
        correlationId: parsed.correlation_id,
        channel: 'WHATSAPP',
        contact: {
          tenantId: parsed.tenant_id,
          workspaceId: parsed.workspace_id,
          organizationId: parsed.organization_id,
          correlationId: parsed.correlation_id,
          contactRecordId: parsed.contact_record_id,
          resolutionId: parsed.contact_resolution_id,
          status: 'RESOLVED',
        },
        privacy: {
          tenantId: parsed.tenant_id,
          workspaceId: parsed.workspace_id,
          organizationId: parsed.organization_id,
          correlationId: parsed.correlation_id,
          executionId: parsed.privacy_execution_id,
          subjectRef: parsed.privacy_subject_ref,
          decision: {
            state: 'ALLOWED',
            blocked: false,
            reasons: [],
            purposeId: parsed.privacy_purpose_id,
            channel: 'WHATSAPP',
          },
        },
        policy: {
          tenantId: parsed.tenant_id,
          workspaceId: parsed.workspace_id,
          organizationId: parsed.organization_id,
          correlationId: parsed.correlation_id,
          decisionId: parsed.policy_decision_id,
          allowed: true,
        },
        approval: {
          tenantId: parsed.tenant_id,
          workspaceId: parsed.workspace_id,
          organizationId: parsed.organization_id,
          correlationId: parsed.correlation_id,
          approvalId: parsed.approval_id,
          status: 'APPROVED',
        },
      };

      const readback = await dependencies.runtime.send({
        tenantId: parsed.tenant_id,
        workspaceId: parsed.workspace_id,
        organizationId: parsed.organization_id,
        message,
        preparedPayloadRef: parsed.prepared_message_id,
        purposeId: parsed.privacy_purpose_id,
        eligibility,
        executionId: runtimeContext.executionId,
        correlationId: runtimeContext.correlationId,
        actorPrincipalId: runtimeContext.identity.principal.principalId,
        idempotencyKey: parsed.idempotency_key,
        evidence: [
          `core:whatsapp-send:${runtimeContext.executionId}`,
          `crm:message:${message.messageId}`,
          `prepared-content:${parsed.prepared_message_id}`,
          `approval:${parsed.approval_id}:reserved`,
        ],
      });

      return sendResult(readback);
    },
    providerReadback: async (result, input) => {
      const parsedResult = whatsappSendResultSchema.parse(result);
      const parsedInput = whatsappSendSchema.parse(input);
      const readback = await dependencies.providerEventReadback.readWhatsApp({
        tenantId: parsedInput.tenant_id,
        workspaceId: parsedInput.workspace_id,
        organizationId: parsedInput.organization_id,
        providerMessageId: parsedResult.provider_message_id,
      });
      const providerEventEvidence = readback.evidence.filter((item) =>
        item.startsWith('whatsapp:provider-event:'),
      );
      const callbackObserved = providerEventEvidence.length > 0;
      const successfulState = readback.state === 'SENT' || readback.state === 'DELIVERED';
      return {
        verified: callbackObserved && successfulState,
        evidence: callbackObserved ? readback.evidence : [],
        externalResourceId: parsedResult.provider_message_id,
        ...(!callbackObserved
          ? { reason: 'WHATSAPP_SIGNED_CALLBACK_NOT_OBSERVED' }
          : !successfulState
            ? { reason: `WHATSAPP_PROVIDER_CALLBACK_STATE_NOT_SUCCESSFUL:${readback.state}` }
            : {}),
      };
    },
  };
}

export function createWhatsAppOutboundRuntimeResolver(
  dependencies: WhatsAppOutboundRuntimeBindingDependencies | undefined,
): CoreCapabilityRuntimeResolver {
  return (capabilityId) => resolveWhatsAppOutboundRuntimeBinding(capabilityId, dependencies);
}

async function assertReservedApproval(
  input: WhatsAppSendInput,
  context: CoreCapabilityRuntimeContext,
  approvalStore: Pick<ApprovalStore, 'get'>,
): Promise<void> {
  const approval = await approvalStore.get(input.approval_id);
  if (!approval) throw new Error('WHATSAPP_APPROVAL_NOT_FOUND');
  if (
    approval.status !== 'EXECUTING' ||
    approval.reservationExecutionId !== context.executionId ||
    approval.reservationPrincipalId !== context.identity.principal.principalId ||
    approval.reservationCorrelationId !== context.correlationId
  ) {
    throw new Error('WHATSAPP_APPROVAL_RESERVATION_MISMATCH');
  }
  if (approval.capabilityId !== 'whatsapp.message.send') {
    throw new Error('WHATSAPP_APPROVAL_CAPABILITY_MISMATCH');
  }
}

function assertScope(input: WhatsAppSendInput, context: CoreCapabilityRuntimeContext): void {
  const principal = context.identity.principal;
  if (
    principal.tenantId !== input.tenant_id ||
    principal.workspaceId !== input.workspace_id ||
    principal.organizationId !== input.organization_id
  ) {
    throw new Error('WHATSAPP_MESSAGE_SEND_SCOPE_MISMATCH');
  }
}

function requireRuntimeContext(
  context: CoreCapabilityRuntimeContext | undefined,
): CoreCapabilityRuntimeContext {
  if (!context) throw new Error('WHATSAPP_MESSAGE_SEND_CONTEXT_REQUIRED');
  return context;
}

function sendResult(readback: ProviderMessageReadback): WhatsAppSendResult {
  const state: WhatsAppSendResult['state'] =
    readback.state === 'UNKNOWN'
      ? 'UNKNOWN'
      : readback.state === 'FAILED' || readback.state === 'REJECTED'
        ? 'REJECTED'
        : 'ACCEPTED';
  return {
    provider_message_id: readback.providerMessageId,
    provider: readback.provider,
    state,
    accepted_at: readback.observedAt,
  };
}
