import type { CrmScope } from './crm-records.js';

export const CRM_COMMUNICATION_CHANNELS = ['WHATSAPP', 'EMAIL', 'INSTAGRAM', 'OTHER'] as const;
export type CrmCommunicationChannel = (typeof CRM_COMMUNICATION_CHANNELS)[number];

export const CRM_CONVERSATION_STATUSES = ['OPEN', 'HUMAN_HANDOFF', 'CLOSED'] as const;
export type CrmConversationStatus = (typeof CRM_CONVERSATION_STATUSES)[number];

export const CRM_MESSAGE_DIRECTIONS = ['INBOUND', 'OUTBOUND'] as const;
export type CrmMessageDirection = (typeof CRM_MESSAGE_DIRECTIONS)[number];

export const CRM_MESSAGE_CONTENT_TYPES = [
  'TEXT',
  'IMAGE',
  'AUDIO',
  'VIDEO',
  'DOCUMENT',
  'STICKER',
  'LOCATION',
  'CONTACT',
  'INTERACTIVE',
  'TEMPLATE',
  'UNKNOWN',
] as const;
export type CrmMessageContentType = (typeof CRM_MESSAGE_CONTENT_TYPES)[number];

export const CRM_MESSAGE_STATUSES = [
  'RECEIVED',
  'PREPARED',
  'SUBMITTED',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED_RETRYABLE',
  'FAILED',
  'DEAD_LETTER',
] as const;
export type CrmMessageStatus = (typeof CRM_MESSAGE_STATUSES)[number];

export const CRM_DELIVERY_STATUSES = ['SENT', 'DELIVERED', 'READ', 'FAILED'] as const;
export type CrmDeliveryStatus = (typeof CRM_DELIVERY_STATUSES)[number];

export interface CrmCommunicationMutationMetadata {
  readonly executionId: string;
  readonly correlationId: string;
  readonly actorPrincipalId: string;
  readonly idempotencyKey: string;
  readonly evidence: readonly string[];
  readonly now?: string;
}

export interface ConversationRecord extends CrmScope {
  readonly conversationId: string;
  readonly contactId: string;
  readonly channel: CrmCommunicationChannel;
  readonly provider: string;
  readonly providerAccountRef: string;
  readonly status: CrmConversationStatus;
  readonly lastInboundAt: string | null;
  readonly lastOutboundAt: string | null;
  readonly humanHandoffAt: string | null;
  readonly humanHandoffReason: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MessageRecord extends CrmScope {
  readonly messageId: string;
  readonly conversationId: string;
  readonly contactId: string;
  readonly channel: CrmCommunicationChannel;
  readonly provider: string;
  readonly direction: CrmMessageDirection;
  readonly contentType: CrmMessageContentType;
  readonly status: CrmMessageStatus;
  readonly providerMessageId: string | null;
  readonly replyToProviderMessageId: string | null;
  readonly templateKey: string | null;
  readonly templateLocale: string | null;
  readonly purposeId: string | null;
  readonly text: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly attemptCount: number;
  readonly nextRetryAt: string | null;
  readonly lastErrorCode: string | null;
  readonly occurredAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MessageAttachmentRecord extends CrmScope {
  readonly attachmentId: string;
  readonly messageId: string;
  readonly providerMediaId: string | null;
  readonly mediaUrl: string | null;
  readonly mimeType: string | null;
  readonly fileName: string | null;
  readonly sha256: string | null;
  readonly sizeBytes: number | null;
  readonly evidence: readonly string[];
  readonly createdAt: string;
}

export interface MessageDeliveryEventRecord extends CrmScope {
  readonly deliveryEventId: string;
  readonly messageId: string;
  readonly providerMessageId: string;
  readonly providerEventId: string;
  readonly status: CrmDeliveryStatus;
  readonly errorCode: string | null;
  readonly errorTitle: string | null;
  readonly observedAt: string;
  readonly evidence: readonly string[];
  readonly createdAt: string;
}

export interface ResolveConversationInput extends CrmScope, CrmCommunicationMutationMetadata {
  readonly conversationId: string;
  readonly contactId: string;
  readonly channel: CrmCommunicationChannel;
  readonly provider: string;
  readonly providerAccountRef: string;
  readonly direction: CrmMessageDirection;
  readonly occurredAt: string;
}

export interface RecordCommunicationMessageInput
  extends CrmScope,
    CrmCommunicationMutationMetadata {
  readonly messageId: string;
  readonly conversationId: string;
  readonly contactId: string;
  readonly channel: CrmCommunicationChannel;
  readonly provider: string;
  readonly direction: CrmMessageDirection;
  readonly contentType: CrmMessageContentType;
  readonly status: CrmMessageStatus;
  readonly providerMessageId?: string | null;
  readonly replyToProviderMessageId?: string | null;
  readonly templateKey?: string | null;
  readonly templateLocale?: string | null;
  readonly purposeId?: string | null;
  readonly text?: string | null;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly attemptCount?: number;
  readonly nextRetryAt?: string | null;
  readonly lastErrorCode?: string | null;
  readonly occurredAt: string;
  readonly attachments?: readonly Omit<
    MessageAttachmentRecord,
    keyof CrmScope | 'messageId' | 'createdAt'
  >[];
}

export interface RecordDeliveryEventInput extends CrmScope, CrmCommunicationMutationMetadata {
  readonly deliveryEventId: string;
  readonly providerMessageId: string;
  readonly providerEventId: string;
  readonly status: CrmDeliveryStatus;
  readonly errorCode?: string | null;
  readonly errorTitle?: string | null;
  readonly observedAt: string;
}

export interface UpdateMessageTransportInput extends CrmScope, CrmCommunicationMutationMetadata {
  readonly messageId: string;
  readonly expectedStatus: CrmMessageStatus;
  readonly status: CrmMessageStatus;
  readonly providerMessageId?: string | null;
  readonly attemptCount: number;
  readonly nextRetryAt?: string | null;
  readonly lastErrorCode?: string | null;
}

export interface MarkHumanHandoffInput extends CrmScope, CrmCommunicationMutationMetadata {
  readonly conversationId: string;
  readonly reason: string;
}

export interface ConsumeCommunicationThrottleInput extends CrmScope {
  readonly contactId: string;
  readonly channel: CrmCommunicationChannel;
  readonly provider: string;
  readonly windowSeconds: number;
  readonly limit: number;
  readonly now: string;
}

export interface CommunicationThrottleDecision {
  readonly allowed: boolean;
  readonly count: number;
  readonly limit: number;
  readonly windowStartedAt: string;
  readonly retryAfterSeconds: number;
}

export interface CrmCommunicationStore {
  resolveConversation(input: ResolveConversationInput): Promise<ConversationRecord>;
  getConversation(input: CrmScope & { readonly conversationId: string }): Promise<ConversationRecord | undefined>;
  recordMessage(input: RecordCommunicationMessageInput): Promise<MessageRecord>;
  getMessage(input: CrmScope & { readonly messageId: string }): Promise<MessageRecord | undefined>;
  getMessageByProviderId(
    input: CrmScope & { readonly provider: string; readonly providerMessageId: string },
  ): Promise<MessageRecord | undefined>;
  recordDeliveryEvent(input: RecordDeliveryEventInput): Promise<MessageDeliveryEventRecord>;
  updateMessageTransport(input: UpdateMessageTransportInput): Promise<MessageRecord>;
  markHumanHandoff(input: MarkHumanHandoffInput): Promise<ConversationRecord>;
  consumeThrottle(input: ConsumeCommunicationThrottleInput): Promise<CommunicationThrottleDecision>;
}

export function validateConversationRecord(record: ConversationRecord): void {
  validateCommunicationScope(record);
  requireCommunicationText(record.conversationId, 'CRM_CONVERSATION_ID_REQUIRED');
  requireCommunicationText(record.contactId, 'CRM_CONTACT_ID_REQUIRED');
  if (!CRM_COMMUNICATION_CHANNELS.includes(record.channel)) throw new Error('CRM_COMMUNICATION_CHANNEL_INVALID');
  requireCommunicationText(record.provider, 'CRM_COMMUNICATION_PROVIDER_REQUIRED');
  requireCommunicationText(record.providerAccountRef, 'CRM_COMMUNICATION_PROVIDER_ACCOUNT_REQUIRED');
  if (!CRM_CONVERSATION_STATUSES.includes(record.status)) throw new Error('CRM_CONVERSATION_STATUS_INVALID');
  assertNullableTimestamp(record.lastInboundAt, 'CRM_CONVERSATION_LAST_INBOUND_INVALID');
  assertNullableTimestamp(record.lastOutboundAt, 'CRM_CONVERSATION_LAST_OUTBOUND_INVALID');
  assertNullableTimestamp(record.humanHandoffAt, 'CRM_CONVERSATION_HANDOFF_AT_INVALID');
  if ((record.humanHandoffAt === null) !== (record.humanHandoffReason === null)) {
    throw new Error('CRM_CONVERSATION_HANDOFF_STATE_INVALID');
  }
  if (record.humanHandoffReason !== null) requireCommunicationText(record.humanHandoffReason, 'CRM_CONVERSATION_HANDOFF_REASON_REQUIRED');
  if (!Number.isSafeInteger(record.version) || record.version < 1) throw new Error('CRM_CONVERSATION_VERSION_INVALID');
  assertCommunicationTimestamp(record.createdAt, 'CRM_CONVERSATION_CREATED_AT_INVALID');
  assertCommunicationTimestamp(record.updatedAt, 'CRM_CONVERSATION_UPDATED_AT_INVALID');
}

export function validateMessageRecord(record: MessageRecord): void {
  validateCommunicationScope(record);
  requireCommunicationText(record.messageId, 'CRM_MESSAGE_ID_REQUIRED');
  requireCommunicationText(record.conversationId, 'CRM_CONVERSATION_ID_REQUIRED');
  requireCommunicationText(record.contactId, 'CRM_CONTACT_ID_REQUIRED');
  if (!CRM_COMMUNICATION_CHANNELS.includes(record.channel)) throw new Error('CRM_COMMUNICATION_CHANNEL_INVALID');
  requireCommunicationText(record.provider, 'CRM_COMMUNICATION_PROVIDER_REQUIRED');
  if (!CRM_MESSAGE_DIRECTIONS.includes(record.direction)) throw new Error('CRM_MESSAGE_DIRECTION_INVALID');
  if (!CRM_MESSAGE_CONTENT_TYPES.includes(record.contentType)) throw new Error('CRM_MESSAGE_CONTENT_TYPE_INVALID');
  if (!CRM_MESSAGE_STATUSES.includes(record.status)) throw new Error('CRM_MESSAGE_STATUS_INVALID');
  if (record.providerMessageId !== null) requireCommunicationText(record.providerMessageId, 'CRM_PROVIDER_MESSAGE_ID_INVALID');
  if (record.replyToProviderMessageId !== null) requireCommunicationText(record.replyToProviderMessageId, 'CRM_REPLY_TO_PROVIDER_MESSAGE_ID_INVALID');
  if ((record.templateKey === null) !== (record.templateLocale === null)) throw new Error('CRM_MESSAGE_TEMPLATE_STATE_INVALID');
  if (record.templateKey !== null) requireCommunicationText(record.templateKey, 'CRM_MESSAGE_TEMPLATE_KEY_INVALID');
  if (record.templateLocale !== null) requireCommunicationText(record.templateLocale, 'CRM_MESSAGE_TEMPLATE_LOCALE_INVALID');
  if (record.purposeId !== null) requireCommunicationText(record.purposeId, 'CRM_MESSAGE_PURPOSE_INVALID');
  if (record.text !== null && record.text.length > 16384) throw new Error('CRM_MESSAGE_TEXT_TOO_LARGE');
  if (!Number.isSafeInteger(record.attemptCount) || record.attemptCount < 0) throw new Error('CRM_MESSAGE_ATTEMPT_COUNT_INVALID');
  assertNullableTimestamp(record.nextRetryAt, 'CRM_MESSAGE_NEXT_RETRY_INVALID');
  if (record.lastErrorCode !== null) requireCommunicationText(record.lastErrorCode, 'CRM_MESSAGE_ERROR_CODE_INVALID');
  assertCommunicationTimestamp(record.occurredAt, 'CRM_MESSAGE_OCCURRED_AT_INVALID');
  assertCommunicationTimestamp(record.createdAt, 'CRM_MESSAGE_CREATED_AT_INVALID');
  assertCommunicationTimestamp(record.updatedAt, 'CRM_MESSAGE_UPDATED_AT_INVALID');
  assertJsonObject(record.payload, 'CRM_MESSAGE_PAYLOAD_INVALID');
}

export function validateCommunicationScope(scope: CrmScope): void {
  requireCommunicationText(scope.tenantId, 'CRM_TENANT_ID_REQUIRED');
  requireCommunicationText(scope.workspaceId, 'CRM_WORKSPACE_ID_REQUIRED');
  requireCommunicationText(scope.organizationId, 'CRM_ORGANIZATION_ID_REQUIRED');
}

export function requireCommunicationEvidence(evidence: readonly string[]): readonly string[] {
  const normalized = [...new Set(evidence.map((item) => item.trim()).filter(Boolean))].sort();
  if (normalized.length === 0) throw new Error('CRM_COMMUNICATION_EVIDENCE_REQUIRED');
  return normalized;
}

export function requireCommunicationText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

export function assertCommunicationTimestamp(value: string, errorCode: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(errorCode);
  return value;
}

function assertNullableTimestamp(value: string | null, errorCode: string): void {
  if (value !== null) assertCommunicationTimestamp(value, errorCode);
}

function assertJsonObject(value: Readonly<Record<string, unknown>>, errorCode: string): void {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined || Array.isArray(value)) throw new Error(errorCode);
  } catch {
    throw new Error(errorCode);
  }
}
