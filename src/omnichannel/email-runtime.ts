import { createHash } from 'node:crypto';
import type { CrmScope } from '../crm/crm-records.js';
import type { ConversationRecord, CrmSalesStore, MessageRecord } from '../crm/sales-engine.js';

export const EMAIL_DELIVERY_STATES = [
  'PREPARED',
  'SUBMITTED',
  'ACCEPTED',
  'PROCESSED',
  'DELIVERED',
  'DEFERRED',
  'BOUNCED',
  'COMPLAINT',
  'UNSUBSCRIBED',
  'DROPPED',
  'FAILED',
  'UNKNOWN',
] as const;
export type EmailDeliveryState = (typeof EMAIL_DELIVERY_STATES)[number];

export type EmailProviderPrivacySignal = 'BOUNCED' | 'COMPLAINT' | 'UNSUBSCRIBED';

export interface EmailTemplateRecord extends CrmScope {
  readonly templateId: string;
  readonly templateKey: string;
  readonly version: number;
  readonly subjectTemplate: string;
  readonly htmlContentRef: string | null;
  readonly textContentRef: string | null;
  readonly requiredVariables: readonly string[];
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Provider metadata only. conversationId always references the canonical CRM
 * ConversationRecord; this module intentionally does not define an email
 * conversation or email message abstraction.
 */
export interface EmailThreadBinding extends CrmScope {
  readonly bindingId: string;
  readonly conversationId: ConversationRecord['conversationId'];
  readonly contactId: ConversationRecord['contactId'];
  readonly provider: string;
  readonly providerMessageRef: string | null;
  readonly internetMessageId: string;
  readonly inReplyTo: string | null;
  readonly references: readonly string[];
  readonly createdAt: string;
}

export interface EmailDispatchRecord extends CrmScope {
  readonly dispatchId: string;
  readonly messageId: MessageRecord['messageId'];
  readonly idempotencyKey: string;
  readonly provider: string;
  readonly providerMessageRef: string | null;
  readonly state: EmailDeliveryState;
  readonly attemptCount: number;
  readonly nextRetryAt: string | null;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EmailProviderEventRecord extends CrmScope {
  readonly eventId: string;
  readonly providerEventId: string;
  readonly provider: string;
  readonly providerMessageRef: string;
  readonly messageId: MessageRecord['messageId'] | null;
  readonly eventType: string;
  readonly deliveryState: EmailDeliveryState | null;
  readonly occurredAt: string;
  readonly payloadSha256: string;
  readonly evidence: readonly string[];
}

export interface EmailAttachmentDescriptor extends CrmScope {
  readonly attachmentId: string;
  readonly messageId: MessageRecord['messageId'];
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly contentSha256: string;
  readonly contentRef: string;
  readonly disposition: 'attachment' | 'inline';
  readonly contentId: string | null;
}

export interface EmailTrackingDecisionInput {
  readonly privacyAllowed: boolean;
  readonly policyAllowed: boolean;
  readonly openTrackingRequested: boolean;
  readonly clickTrackingRequested: boolean;
}

export interface EmailTrackingSettings {
  readonly openTracking: boolean;
  readonly clickTracking: boolean;
  readonly blockedReasons: readonly string[];
}

export interface EmailRetryPolicy {
  readonly baseDelayMs: number;
  readonly maximumDelayMs: number;
  readonly maximumAttempts: number;
}

export const DEFAULT_EMAIL_RETRY_POLICY: EmailRetryPolicy = {
  baseDelayMs: 1_000,
  maximumDelayMs: 15 * 60_000,
  maximumAttempts: 6,
};

export interface EmailRateLimitPolicy {
  readonly capacity: number;
  readonly windowSeconds: number;
}

export interface EmailRateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAt: string | null;
}

export interface EmailInboundEnvelope extends CrmScope {
  readonly provider: string;
  readonly providerEventId: string;
  readonly providerMessageRef: string | null;
  readonly internetMessageId: string;
  readonly inReplyTo: string | null;
  readonly references: readonly string[];
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly contentRef: string | null;
  readonly contentSha256: string;
  readonly language: string;
  readonly occurredAt: string;
  readonly evidence: readonly string[];
}

export interface EmailInboundIngestResult {
  readonly conversationId: ConversationRecord['conversationId'];
  readonly messageId: MessageRecord['messageId'];
  readonly contactId: string;
  readonly duplicate: boolean;
  readonly createdConversation: boolean;
}

export interface EmailRuntimeStore {
  findDispatchByIdempotencyKey(
    scope: CrmScope,
    idempotencyKey: string,
  ): Promise<EmailDispatchRecord | undefined>;
  findThreadBindingByInternetMessageIds(
    scope: CrmScope,
    messageIds: readonly string[],
  ): Promise<EmailThreadBinding | undefined>;
  persistThreadBinding(binding: EmailThreadBinding): Promise<void>;
  hasProviderEvent(scope: CrmScope, providerEventId: string): Promise<boolean>;
  appendProviderEvent(event: EmailProviderEventRecord): Promise<void>;
  consumeRateLimit(
    scope: CrmScope,
    bucketKey: string,
    policy: EmailRateLimitPolicy,
    now: string,
  ): Promise<EmailRateLimitDecision>;
}

/**
 * Port into the canonical Privacy engine. Implementations must route this to
 * privacy.provider_consent.reconcile; they must not persist a second email
 * suppression/consent ledger.
 */
export interface EmailPrivacyReconciliationPort {
  reconcileProviderSignal(
    input: CrmScope & {
      readonly capabilityId: 'privacy.provider_consent.reconcile';
      readonly subjectRef: string;
      readonly provider: string;
      readonly providerSubjectRef: string;
      readonly providerState: EmailProviderPrivacySignal;
      readonly observedAt: string;
      readonly providerEvidenceRef: string;
      readonly executionId: string;
      readonly correlationId: string;
    },
  ): Promise<void>;
}

export function resolveEmailTrackingSettings(
  input: EmailTrackingDecisionInput,
): EmailTrackingSettings {
  const blockedReasons: string[] = [];
  if (!input.privacyAllowed) blockedReasons.push('PRIVACY_NOT_ALLOWED');
  if (!input.policyAllowed) blockedReasons.push('POLICY_NOT_ALLOWED');
  const permitted = input.privacyAllowed && input.policyAllowed;
  return {
    openTracking: permitted && input.openTrackingRequested,
    clickTracking: permitted && input.clickTrackingRequested,
    blockedReasons,
  };
}

export function normalizeEmailAddress(value: string): string {
  const normalized = value.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  if (at <= 0 || at === normalized.length - 1 || normalized.includes(' ')) {
    throw new Error('EMAIL_ADDRESS_INVALID');
  }
  return normalized;
}

export function deterministicEmailId(prefix: string, ...parts: readonly string[]): string {
  const normalizedPrefix = requireText(prefix, 'EMAIL_ID_PREFIX_REQUIRED');
  if (parts.length === 0) throw new Error('EMAIL_ID_PARTS_REQUIRED');
  const digest = createHash('sha256')
    .update(parts.map((part) => requireText(part, 'EMAIL_ID_PART_REQUIRED')).join('\u001f'))
    .digest('hex');
  return `${normalizedPrefix}-${digest.slice(0, 32)}`;
}

export function assertCanonicalEmailMessage(message: MessageRecord): void {
  if (message.channel !== 'EMAIL') throw new Error('EMAIL_CANONICAL_MESSAGE_CHANNEL_MISMATCH');
  requireText(message.messageId, 'EMAIL_CANONICAL_MESSAGE_ID_REQUIRED');
  requireText(message.conversationId, 'EMAIL_CANONICAL_CONVERSATION_ID_REQUIRED');
  assertSha256(message.contentSha256, 'EMAIL_CANONICAL_CONTENT_SHA256_INVALID');
}

export function mapSendGridEventToDeliveryState(eventType: string): EmailDeliveryState | null {
  switch (eventType.trim().toLowerCase()) {
    case 'processed':
      return 'PROCESSED';
    case 'delivered':
      return 'DELIVERED';
    case 'deferred':
      return 'DEFERRED';
    case 'bounce':
      return 'BOUNCED';
    case 'spamreport':
      return 'COMPLAINT';
    case 'unsubscribe':
    case 'group_unsubscribe':
      return 'UNSUBSCRIBED';
    case 'dropped':
      return 'DROPPED';
    case 'open':
    case 'click':
    case 'group_resubscribe':
      return null;
    default:
      return 'UNKNOWN';
  }
}

export function providerPrivacySignalForEvent(
  eventType: string,
): EmailProviderPrivacySignal | null {
  switch (eventType.trim().toLowerCase()) {
    case 'bounce':
      return 'BOUNCED';
    case 'spamreport':
      return 'COMPLAINT';
    case 'unsubscribe':
    case 'group_unsubscribe':
      return 'UNSUBSCRIBED';
    default:
      return null;
  }
}

export function isTerminalEmailDeliveryState(state: EmailDeliveryState): boolean {
  return ['DELIVERED', 'BOUNCED', 'COMPLAINT', 'UNSUBSCRIBED', 'DROPPED', 'FAILED'].includes(state);
}

export function computeEmailRetryDelayMs(
  attempt: number,
  retryAfterMs: number | null = null,
  policy: EmailRetryPolicy = DEFAULT_EMAIL_RETRY_POLICY,
): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('EMAIL_RETRY_ATTEMPT_INVALID');
  validateRetryPolicy(policy);
  if (attempt >= policy.maximumAttempts) throw new Error('EMAIL_RETRY_ATTEMPTS_EXHAUSTED');
  if (retryAfterMs !== null) {
    if (!Number.isFinite(retryAfterMs) || retryAfterMs < 0) {
      throw new Error('EMAIL_RETRY_AFTER_INVALID');
    }
    return Math.min(policy.maximumDelayMs, Math.max(policy.baseDelayMs, retryAfterMs));
  }
  const exponential = policy.baseDelayMs * 2 ** (attempt - 1);
  return Math.min(policy.maximumDelayMs, exponential);
}

export function validateEmailAttachments(
  attachments: readonly EmailAttachmentDescriptor[],
  limits: { readonly maximumCount: number; readonly maximumTotalBytes: number },
): void {
  if (!Number.isInteger(limits.maximumCount) || limits.maximumCount < 0) {
    throw new Error('EMAIL_ATTACHMENT_MAXIMUM_COUNT_INVALID');
  }
  if (!Number.isInteger(limits.maximumTotalBytes) || limits.maximumTotalBytes < 0) {
    throw new Error('EMAIL_ATTACHMENT_MAXIMUM_BYTES_INVALID');
  }
  if (attachments.length > limits.maximumCount) throw new Error('EMAIL_ATTACHMENT_COUNT_EXCEEDED');
  let total = 0;
  const ids = new Set<string>();
  for (const attachment of attachments) {
    requireText(attachment.attachmentId, 'EMAIL_ATTACHMENT_ID_REQUIRED');
    if (ids.has(attachment.attachmentId)) throw new Error('EMAIL_ATTACHMENT_DUPLICATE_ID');
    ids.add(attachment.attachmentId);
    requireText(attachment.fileName, 'EMAIL_ATTACHMENT_FILENAME_REQUIRED');
    requireText(attachment.contentType, 'EMAIL_ATTACHMENT_CONTENT_TYPE_REQUIRED');
    requireText(attachment.contentRef, 'EMAIL_ATTACHMENT_CONTENT_REF_REQUIRED');
    if (!Number.isInteger(attachment.sizeBytes) || attachment.sizeBytes < 0) {
      throw new Error('EMAIL_ATTACHMENT_SIZE_INVALID');
    }
    assertSha256(attachment.contentSha256, 'EMAIL_ATTACHMENT_SHA256_INVALID');
    total += attachment.sizeBytes;
  }
  if (total > limits.maximumTotalBytes) throw new Error('EMAIL_ATTACHMENT_TOTAL_BYTES_EXCEEDED');
}

export function resolveEmailThreadLookupIds(input: {
  readonly inReplyTo: string | null;
  readonly references: readonly string[];
}): readonly string[] {
  const candidates = [input.inReplyTo, ...[...input.references].reverse()]
    .filter((value): value is string => value !== null)
    .map(normalizeInternetMessageId)
    .filter((value, index, values) => values.indexOf(value) === index);
  return candidates;
}

export async function ingestInboundEmailIntoCanonicalCrm(input: {
  readonly envelope: EmailInboundEnvelope;
  readonly crm: CrmSalesStore;
  readonly store: EmailRuntimeStore;
  readonly actorPrincipalId: string;
  readonly executionId: string;
  readonly correlationId: string;
}): Promise<EmailInboundIngestResult> {
  const { envelope, crm, store } = input;
  validateScope(envelope);
  assertSha256(envelope.contentSha256, 'EMAIL_INBOUND_CONTENT_SHA256_INVALID');
  if (await store.hasProviderEvent(envelope, envelope.providerEventId)) {
    const existing = await store.findThreadBindingByInternetMessageIds(envelope, [
      envelope.internetMessageId,
    ]);
    if (!existing) throw new Error('EMAIL_INBOUND_DUPLICATE_WITHOUT_THREAD_BINDING');
    return {
      conversationId: existing.conversationId,
      messageId: deterministicEmailId('msg', envelope.provider, envelope.providerEventId),
      contactId: existing.contactId,
      duplicate: true,
      createdConversation: false,
    };
  }

  const lookupIds = resolveEmailThreadLookupIds(envelope);
  const existingBinding =
    lookupIds.length === 0
      ? undefined
      : await store.findThreadBindingByInternetMessageIds(envelope, lookupIds);

  let conversationId: string;
  let contactId: string;
  let createdConversation = false;

  if (existingBinding) {
    conversationId = existingBinding.conversationId;
    contactId = existingBinding.contactId;
  } else {
    const sender = normalizeEmailAddress(envelope.from);
    const resolution = await crm.resolveContact({
      tenantId: envelope.tenantId,
      workspaceId: envelope.workspaceId,
      organizationId: envelope.organizationId,
      channels: [{ channelType: 'EMAIL', value: sender }],
    });
    if (resolution.state !== 'RESOLVED' || !resolution.canonicalContactId) {
      throw new Error(`EMAIL_INBOUND_CONTACT_${resolution.state}`);
    }
    contactId = resolution.canonicalContactId;
    conversationId = deterministicEmailId(
      'conv',
      envelope.tenantId,
      envelope.workspaceId,
      envelope.organizationId,
      contactId,
      envelope.internetMessageId,
    );
    await crm.createConversation({
      tenantId: envelope.tenantId,
      workspaceId: envelope.workspaceId,
      organizationId: envelope.organizationId,
      conversationId,
      contactId,
      channel: 'EMAIL',
      language: envelope.language,
      idempotencyKey: `email-inbound-conversation:${conversationId}`,
      executionId: input.executionId,
      correlationId: input.correlationId,
      actorPrincipalId: input.actorPrincipalId,
      evidence: envelope.evidence,
      now: envelope.occurredAt,
    });
    createdConversation = true;
  }

  const messageId = deterministicEmailId('msg', envelope.provider, envelope.providerEventId);
  const message = await crm.appendMessage({
    tenantId: envelope.tenantId,
    workspaceId: envelope.workspaceId,
    organizationId: envelope.organizationId,
    messageId,
    conversationId,
    contactId,
    direction: 'INBOUND',
    channel: 'EMAIL',
    language: envelope.language,
    contentRef: envelope.contentRef,
    contentSha256: envelope.contentSha256,
    providerMessageRef: envelope.providerMessageRef,
    occurredAt: envelope.occurredAt,
    idempotencyKey: `email-inbound-message:${messageId}`,
    executionId: input.executionId,
    correlationId: input.correlationId,
    actorPrincipalId: input.actorPrincipalId,
    evidence: envelope.evidence,
    now: envelope.occurredAt,
  });
  assertCanonicalEmailMessage(message);

  const normalizedInternetMessageId = normalizeInternetMessageId(envelope.internetMessageId);
  const binding: EmailThreadBinding = {
    tenantId: envelope.tenantId,
    workspaceId: envelope.workspaceId,
    organizationId: envelope.organizationId,
    bindingId: deterministicEmailId('thread', envelope.provider, normalizedInternetMessageId),
    conversationId,
    contactId,
    provider: envelope.provider,
    providerMessageRef: envelope.providerMessageRef,
    internetMessageId: normalizedInternetMessageId,
    inReplyTo: envelope.inReplyTo ? normalizeInternetMessageId(envelope.inReplyTo) : null,
    references: envelope.references.map(normalizeInternetMessageId),
    createdAt: envelope.occurredAt,
  };
  await store.persistThreadBinding(binding);

  const event: EmailProviderEventRecord = {
    tenantId: envelope.tenantId,
    workspaceId: envelope.workspaceId,
    organizationId: envelope.organizationId,
    eventId: deterministicEmailId('event', envelope.provider, envelope.providerEventId),
    providerEventId: envelope.providerEventId,
    provider: envelope.provider,
    providerMessageRef: envelope.providerMessageRef ?? normalizedInternetMessageId,
    messageId,
    eventType: 'inbound',
    deliveryState: null,
    occurredAt: envelope.occurredAt,
    payloadSha256: envelope.contentSha256,
    evidence: envelope.evidence,
  };
  await store.appendProviderEvent(event);

  return { conversationId, messageId, contactId, duplicate: false, createdConversation };
}

export function normalizeInternetMessageId(value: string): string {
  const normalized = requireText(value, 'EMAIL_INTERNET_MESSAGE_ID_REQUIRED').trim();
  const unwrapped =
    normalized.startsWith('<') && normalized.endsWith('>')
      ? normalized.slice(1, -1).trim()
      : normalized;
  if (!unwrapped || unwrapped.includes(' ') || !unwrapped.includes('@')) {
    throw new Error('EMAIL_INTERNET_MESSAGE_ID_INVALID');
  }
  return `<${unwrapped}>`;
}

function validateRetryPolicy(policy: EmailRetryPolicy): void {
  if (!Number.isFinite(policy.baseDelayMs) || policy.baseDelayMs <= 0) {
    throw new Error('EMAIL_RETRY_BASE_DELAY_INVALID');
  }
  if (!Number.isFinite(policy.maximumDelayMs) || policy.maximumDelayMs < policy.baseDelayMs) {
    throw new Error('EMAIL_RETRY_MAXIMUM_DELAY_INVALID');
  }
  if (!Number.isInteger(policy.maximumAttempts) || policy.maximumAttempts < 2) {
    throw new Error('EMAIL_RETRY_MAXIMUM_ATTEMPTS_INVALID');
  }
}

function validateScope(scope: CrmScope): void {
  requireText(scope.tenantId, 'EMAIL_TENANT_ID_REQUIRED');
  requireText(scope.workspaceId, 'EMAIL_WORKSPACE_ID_REQUIRED');
  requireText(scope.organizationId, 'EMAIL_ORGANIZATION_ID_REQUIRED');
}

function assertSha256(value: string, code: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(code);
}

function requireText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}
