import * as z from 'zod/v4';
import { PostgresEmailCampaignSendRuntime } from '../omnichannel/email-campaign-send-runtime.js';
import type { OmnichannelProviderEventReadbackService } from '../omnichannel/provider-event-readback.js';
import { resolveEmailCampaignSendRuntimeBinding } from './email-campaign-send-runtime.js';
import type {
  CoreCapabilityRuntimeBinding,
  CoreCapabilityRuntimeContext,
  CoreCapabilityRuntimeResolver,
} from './core-execution.js';

const baseReadbackSchema = z.object({
  tenant_id: z.string().min(1),
  workspace_id: z.string().min(1),
  organization_id: z.string().min(1),
});

const emailReadbackSchema = baseReadbackSchema.extend({
  provider_dispatch_id: z.string().min(1),
});

const whatsappReadbackSchema = baseReadbackSchema.extend({
  provider_message_id: z.string().min(1),
});

export function resolveOmnichannelReadbackRuntimeBinding(
  capabilityId: string,
  service: OmnichannelProviderEventReadbackService | undefined,
): CoreCapabilityRuntimeBinding | undefined {
  if (!service) return undefined;

  if (capabilityId === 'email.campaign.send') {
    const pool = service.emailRuntimePool?.();
    return resolveEmailCampaignSendRuntimeBinding(
      capabilityId,
      pool ? new PostgresEmailCampaignSendRuntime({ pool }) : undefined,
    );
  }

  switch (capabilityId) {
    case 'email.delivery.readback':
      return {
        inputSchema: emailReadbackSchema,
        execute: async (input, context) => {
          const parsed = emailReadbackSchema.parse(input);
          assertScope(parsed, context);
          const readback = await service.readEmail({
            tenantId: parsed.tenant_id,
            workspaceId: parsed.workspace_id,
            organizationId: parsed.organization_id,
            providerMessageId: parsed.provider_dispatch_id,
          });
          return {
            provider_dispatch_id: parsed.provider_dispatch_id,
            state: readback.state,
            observed_at: readback.observedAt,
            evidence: readback.evidence,
          };
        },
      };
    case 'whatsapp.message.readback':
      return {
        inputSchema: whatsappReadbackSchema,
        execute: async (input, context) => {
          const parsed = whatsappReadbackSchema.parse(input);
          assertScope(parsed, context);
          const readback = await service.readWhatsApp({
            tenantId: parsed.tenant_id,
            workspaceId: parsed.workspace_id,
            organizationId: parsed.organization_id,
            providerMessageId: parsed.provider_message_id,
          });
          return {
            provider_message_id: parsed.provider_message_id,
            state: readback.state,
            observed_at: readback.observedAt,
            evidence: readback.evidence,
          };
        },
      };
    default:
      return undefined;
  }
}

export function createOmnichannelReadbackRuntimeResolver(
  service: OmnichannelProviderEventReadbackService | undefined,
): CoreCapabilityRuntimeResolver {
  return (capabilityId) => resolveOmnichannelReadbackRuntimeBinding(capabilityId, service);
}

function assertScope(
  input: {
    readonly tenant_id: string;
    readonly workspace_id: string;
    readonly organization_id: string;
  },
  context: CoreCapabilityRuntimeContext | undefined,
): void {
  const principal = context?.identity.principal;
  if (!principal) throw new Error('OMNICHANNEL_READBACK_IDENTITY_REQUIRED');
  if (
    principal.tenantId !== input.tenant_id ||
    principal.workspaceId !== input.workspace_id ||
    principal.organizationId !== input.organization_id
  ) {
    throw new Error('OMNICHANNEL_READBACK_SCOPE_MISMATCH');
  }
}
