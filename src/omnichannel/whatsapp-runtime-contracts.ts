import type { CrmScope } from '../crm/crm-records.js';
import type { WhatsAppDeliveryStatus } from '../providers/whatsapp/whatsapp-cloud-webhook.js';

export const WHATSAPP_PROVIDER_KEY = 'META_WHATSAPP_CLOUD' as const;

export type WhatsAppDispatchState =
  | 'PREPARED'
  | 'SUBMITTED'
  | 'SENT'
  | 'DELIVERED'
  | 'READ'
  | 'FAILED_RETRYABLE'
  | 'FAILED'
  | 'DEAD_LETTER';

export interface WhatsAppMutationMetadata {
  readonly executionId: string;
  readonly correlationId: string;
  readonly actorPrincipalId: string;
  readonly idempotencyKey: string;
  readonly evidence: readonly string[];
  readonly now?: string;
}

export interface WhatsAppConversationBinding extends CrmScope {
  readonly bindingId: string;
  readonly conversationId: string;
  readonly contactId: string;
  readonly metaAppId: string;
  readonly wabaId: string;
  readonly phoneNumberId: string;
  readonly recipientSha256: string;
  readonly lastInboundAt: string | null;
  readonly lastOutboundAt: string | null;
  readonly humanHandoffAt: string | null;
  readonly humanHandoffReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WhatsAppDispatchRecord extends CrmScope {
  readonly dispatchId: string;
  readonly messageId: string;
  readonly conversationId: string;
  readonly contactId: string;
  readonly provider: typeof WHATSAPP_PROVIDER_KEY;
  readonly preparedPayloadRef: string;
  readonly purposeId: string;
  readonly idempotencyKey: string;
  readonly providerMessageRef: string | null;
  readonly state: WhatsAppDispatchState;
  readonly attemptCount: number;
  readonly nextRetryAt: string | null;
  readonly lastErrorCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WhatsAppProviderEventRecord extends CrmScope {
  readonly eventId: string;
  readonly messageId: string;
  readonly providerMessageRef: string;
  readonly providerEventRef: string;
  readonly status: WhatsAppDeliveryStatus;
  readonly errorCode: string | null;
  readonly errorTitle: string | null;
  readonly observedAt: string;
  readonly evidence: readonly string[];
  readonly createdAt: string;
}

export interface WhatsAppMediaRecord extends CrmScope {
  readonly mediaRecordId: string;
  readonly messageId: string;
  readonly direction: 'INBOUND' | 'OUTBOUND';
  readonly providerMediaId: string;
  readonly mimeType: string | null;
  readonly fileName: string | null;
  readonly sha256: string | null;
  readonly sizeBytes: number | null;
  readonly storageRef: string | null;
  readonly evidence: readonly string[];
  readonly createdAt: string;
}

export interface WhatsAppThrottleDecision {
  readonly allowed: boolean;
  readonly count: number;
  readonly limit: number;
  readonly windowStartedAt: string;
  readonly retryAfterSeconds: number;
}

export interface EnsureWhatsAppBindingInput extends CrmScope, WhatsAppMutationMetadata {
  readonly bindingId: string;
  readonly conversationId: string;
  readonly contactId: string;
  readonly metaAppId: string;
  readonly wabaId: string;
  readonly phoneNumberId: string;
  readonly recipientSha256: string;
}

export interface TouchWhatsAppBindingInput extends CrmScope, WhatsAppMutationMetadata {
  readonly conversationId: string;
  readonly direction: 'INBOUND' | 'OUTBOUND';
  readonly occurredAt: string;
}

export interface MarkWhatsAppHandoffInput extends CrmScope, WhatsAppMutationMetadata {
  readonly conversationId: string;
  readonly reason: string;
}

export interface RecordWhatsAppMediaInput extends CrmScope, WhatsAppMutationMetadata {
  readonly mediaRecordId: string;
  readonly messageId: string;
  readonly direction: 'INBOUND' | 'OUTBOUND';
  readonly providerMediaId: string;
  readonly mimeType?: string | null;
  readonly fileName?: string | null;
  readonly sha256?: string | null;
  readonly sizeBytes?: number | null;
  readonly storageRef?: string | null;
}

export interface CreateWhatsAppDispatchInput extends CrmScope, WhatsAppMutationMetadata {
  readonly dispatchId: string;
  readonly messageId: string;
  readonly conversationId: string;
  readonly contactId: string;
  readonly preparedPayloadRef: string;
  readonly purposeId: string;
}

export interface UpdateWhatsAppDispatchInput extends CrmScope, WhatsAppMutationMetadata {
  readonly dispatchId: string;
  readonly expectedState: WhatsAppDispatchState;
  readonly state: WhatsAppDispatchState;
  readonly providerMessageRef?: string | null;
  readonly attemptCount: number;
  readonly nextRetryAt?: string | null;
  readonly lastErrorCode?: string | null;
}

export interface RecordWhatsAppProviderEventInput extends CrmScope, WhatsAppMutationMetadata {
  readonly eventId: string;
  readonly providerMessageRef: string;
  readonly providerEventRef: string;
  readonly status: WhatsAppDeliveryStatus;
  readonly errorCode?: string | null;
  readonly errorTitle?: string | null;
  readonly observedAt: string;
}

export interface ConsumeWhatsAppThrottleInput extends CrmScope {
  readonly contactId: string;
  readonly windowSeconds: number;
  readonly limit: number;
  readonly now: string;
}

export interface WhatsAppRuntimeStore {
  getBindingByRecipient(
    input: CrmScope & { readonly phoneNumberId: string; readonly recipientSha256: string },
  ): Promise<WhatsAppConversationBinding | undefined>;
  getBindingByConversation(
    input: CrmScope & { readonly conversationId: string },
  ): Promise<WhatsAppConversationBinding | undefined>;
  ensureBinding(input: EnsureWhatsAppBindingInput): Promise<WhatsAppConversationBinding>;
  touchBinding(input: TouchWhatsAppBindingInput): Promise<WhatsAppConversationBinding>;
  markHumanHandoff(input: MarkWhatsAppHandoffInput): Promise<WhatsAppConversationBinding>;
  recordMedia(input: RecordWhatsAppMediaInput): Promise<WhatsAppMediaRecord>;
  createDispatch(input: CreateWhatsAppDispatchInput): Promise<WhatsAppDispatchRecord>;
  getDispatchByIdempotencyKey(
    input: CrmScope & { readonly idempotencyKey: string },
  ): Promise<WhatsAppDispatchRecord | undefined>;
  getDispatchByProviderMessageRef(
    input: CrmScope & { readonly providerMessageRef: string },
  ): Promise<WhatsAppDispatchRecord | undefined>;
  updateDispatch(input: UpdateWhatsAppDispatchInput): Promise<WhatsAppDispatchRecord>;
  recordProviderEvent(
    input: RecordWhatsAppProviderEventInput,
  ): Promise<WhatsAppProviderEventRecord>;
  consumeThrottle(input: ConsumeWhatsAppThrottleInput): Promise<WhatsAppThrottleDecision>;
}
