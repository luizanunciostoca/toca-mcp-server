import { createHash } from 'node:crypto';
import type { AuditSink } from '../core/audit.js';
import type {
  ConversationRecord,
  CrmCommunicationStore,
  MessageRecord,
} from '../crm/communication-records.js';
import type { ContactRecord, CrmCoreStore, CrmScope } from '../crm/crm-records.js';
import {
  assertOutboundEligibility,
  assertProductionProviderBinding,
  type OutboundEligibilityContext,
  type ProviderMessageReadback,
  type WhatsAppProviderAdapter,
} from './contracts.js';
import type { PrivacyExecutionContext, SuppressionDecision } from '../privacy/contracts.js';
import type { PrivacyGovernanceCore } from '../privacy/privacy-governance-core.js';
import { MetaApiError } from '../providers/meta/meta-api-client.js';
import type {
  PreparedWhatsAppMessage,
  PreparedWhatsAppPayloadResolver,
  WhatsAppProviderReadbackStore,
} from '../providers/whatsapp/whatsapp-cloud-adapter.js';
import {
  classifyWhatsappPreferenceCommand,
  requestsHumanHandoff,
  type WhatsAppDeliveryStatusEvent,
  type WhatsAppInboundMessageEvent,
  type WhatsAppPreferenceCommand,
  type WhatsAppWebhookEvent,
} from '../providers/whatsapp/whatsapp-cloud-webhook.js';

export interface WhatsAppScopeBinding extends CrmScope {
  readonly providerAccountRef: string;
  readonly purposeId: string;
  readonly policyRef: string;
  readonly actorPrincipalId: string;
}

export interface WhatsAppScopeResolver {
  resolve(input: {
    readonly wabaId: string;
    readonly phoneNumberId: string;
  }): Promise<WhatsAppScopeBinding | undefined>;
}

export interface WhatsAppPrivacySubjectResolver {
  resolve(contact: ContactRecord): Promise<string>;
}

export interface WhatsAppPrivacyLifecycle {
  recordInboundPreference(input: {
    readonly binding: WhatsAppScopeBinding;
    readonly contact: ContactRecord;
    readonly subjectRef: string;
    readonly command: WhatsAppPreferenceCommand;
    readonly eventId: string;
    readonly occurredAt: string;
    readonly evidence: readonly string[];
  }): Promise<readonly string[]>;
}

export interface WhatsAppCrmWorkflow {
  onInboundMessage(input: {
    readonly binding: WhatsAppScopeBinding;
    readonly contact: ContactRecord;
    readonly conversation: ConversationRecord;
    readonly message: MessageRecord;
    readonly humanHandoff: boolean;
    readonly evidence: readonly string[];
  }): Promise<void>;
}

export interface WhatsAppInboundRuntimeDependencies {
  readonly scopes: WhatsAppScopeResolver;
  readonly crm: CrmCoreStore;
  readonly communications: CrmCommunicationStore;
  readonly privacySubjects: WhatsAppPrivacySubjectResolver;
  readonly privacy: WhatsAppPrivacyLifecycle;
  readonly workflow: WhatsAppCrmWorkflow;
  readonly audit: AuditSink;
}

export class WhatsAppInboundRuntime {
  constructor(private readonly deps: WhatsAppInboundRuntimeDependencies) {}

  async ingest(event: WhatsAppWebhookEvent): Promise<void> {
    const binding = await this.deps.scopes.resolve({
      wabaId: event.wabaId,
      phoneNumberId: event.phoneNumberId,
    });
    if (!binding) throw new Error('WHATSAPP_SCOPE_BINDING_NOT_FOUND');

    if (event.kind === 'STATUS') {
      await this.ingestStatus(binding, event);
      return;
    }
    await this.ingestMessage(binding, event);
  }

  private async ingestMessage(
    binding: WhatsAppScopeBinding,
    event: WhatsAppInboundMessageEvent,
  ): Promise<void> {
    const evidence = [`whatsapp:webhook:${event.eventId}`, `meta:wamid:${event.providerMessageId}`];
    const contact = await this.resolveContact(binding, event, evidence);
    const subjectRef = await this.deps.privacySubjects.resolve(contact);
    if (!subjectRef.trim()) throw new Error('WHATSAPP_PRIVACY_SUBJECT_NOT_RESOLVED');

    const conversation = await this.deps.communications.resolveConversation({
      ...binding,
      conversationId: deterministicId(
        'conversation',
        binding.tenantId,
        binding.workspaceId,
        binding.organizationId,
        contact.contactId,
        event.phoneNumberId,
      ),
      contactId: contact.contactId,
      channel: 'WHATSAPP',
      provider: 'META_WHATSAPP_CLOUD',
      direction: 'INBOUND',
      occurredAt: event.occurredAt,
      executionId: `wa-inbound:${event.eventId}`,
      correlationId: event.eventId,
      actorPrincipalId: binding.actorPrincipalId,
      idempotencyKey: event.eventId,
      evidence,
      now: event.occurredAt,
    });

    const message = await this.deps.communications.recordMessage({
      ...binding,
      messageId: deterministicId('message', event.phoneNumberId, event.providerMessageId),
      conversationId: conversation.conversationId,
      contactId: contact.contactId,
      channel: 'WHATSAPP',
      provider: 'META_WHATSAPP_CLOUD',
      direction: 'INBOUND',
      contentType: event.contentType,
      status: 'RECEIVED',
      providerMessageId: event.providerMessageId,
      replyToProviderMessageId: event.replyToProviderMessageId,
      purposeId: binding.purposeId,
      text: event.text,
      payload: event.payload,
      occurredAt: event.occurredAt,
      attachments: event.attachments.map((attachment, index) => ({
        attachmentId: deterministicId(
          'attachment',
          event.providerMessageId,
          attachment.providerMediaId,
          String(index),
        ),
        providerMediaId: attachment.providerMediaId,
        mediaUrl: null,
        mimeType: attachment.mimeType,
        fileName: attachment.fileName,
        sha256: attachment.sha256,
        sizeBytes: null,
        evidence,
      })),
      executionId: `wa-inbound:${event.eventId}`,
      correlationId: event.eventId,
      actorPrincipalId: binding.actorPrincipalId,
      idempotencyKey: event.eventId,
      evidence,
      now: event.occurredAt,
    });

    const command = classifyWhatsappPreferenceCommand(event.text);
    const privacyEvidence = await this.deps.privacy.recordInboundPreference({
      binding,
      contact,
      subjectRef,
      command,
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      evidence,
    });

    const humanHandoff = requestsHumanHandoff(event.text) || event.contentType === 'UNKNOWN';
    const finalConversation = humanHandoff
      ? await this.deps.communications.markHumanHandoff({
          ...binding,
          conversationId: conversation.conversationId,
          reason: event.contentType === 'UNKNOWN' ? 'UNSUPPORTED_WHATSAPP_CONTENT' : 'CUSTOMER_REQUEST',
          executionId: `wa-handoff:${event.eventId}`,
          correlationId: event.eventId,
          actorPrincipalId: binding.actorPrincipalId,
          idempotencyKey: `handoff:${event.eventId}`,
          evidence,
          now: event.occurredAt,
        })
      : conversation;

    await this.deps.workflow.onInboundMessage({
      binding,
      contact,
      conversation: finalConversation,
      message,
      humanHandoff,
      evidence: [...evidence, ...privacyEvidence],
    });
    await this.deps.audit.write({
      executionId: `wa-inbound:${event.eventId}`,
      correlationId: event.eventId,
      toolName: 'core.whatsapp.conversation.ingest',
      requester: binding.actorPrincipalId,
      tenantId: binding.tenantId,
      workspaceId: binding.workspaceId,
      organizationId: binding.organizationId,
      status: 'SUCCEEDED',
      externalResourceId: event.providerMessageId,
      evidence: [...evidence, ...privacyEvidence],
      createdAt: event.occurredAt,
    });
  }

  private async ingestStatus(
    binding: WhatsAppScopeBinding,
    event: WhatsAppDeliveryStatusEvent,
  ): Promise<void> {
    const evidence = [`whatsapp:webhook:${event.eventId}`, `meta:wamid:${event.providerMessageId}`];
    await this.deps.communications.recordDeliveryEvent({
      ...binding,
      deliveryEventId: deterministicId('delivery', event.eventId),
      providerMessageId: event.providerMessageId,
      providerEventId: event.eventId,
      status: event.status,
      errorCode: event.errorCode,
      errorTitle: event.errorTitle,
      observedAt: event.observedAt,
      executionId: `wa-status:${event.eventId}`,
      correlationId: event.eventId,
      actorPrincipalId: binding.actorPrincipalId,
      idempotencyKey: event.eventId,
      evidence,
      now: event.observedAt,
    });
    await this.deps.audit.write({
      executionId: `wa-status:${event.eventId}`,
      correlationId: event.eventId,
      toolName: 'core.whatsapp.message.status.ingest',
      requester: binding.actorPrincipalId,
      tenantId: binding.tenantId,
      workspaceId: binding.workspaceId,
      organizationId: binding.organizationId,
      status: 'SUCCEEDED',
      externalResourceId: event.providerMessageId,
      evidence,
      createdAt: event.observedAt,
    });
  }

  private async resolveContact(
    binding: WhatsAppScopeBinding,
    event: WhatsAppInboundMessageEvent,
    evidence: readonly string[],
  ): Promise<ContactRecord> {
    const lookup = {
      tenantId: binding.tenantId,
      workspaceId: binding.workspaceId,
      organizationId: binding.organizationId,
      channelType: 'PHONE' as const,
      value: event.senderWaId,
    };
    const existing = await this.deps.crm.findContactByChannel(lookup);
    if (existing) return existing;

    const contactId = deterministicId(
      'contact',
      binding.tenantId,
      binding.workspaceId,
      binding.organizationId,
      event.senderWaId,
    );
    try {
      return await this.deps.crm.createContact({
        ...binding,
        contactId,
        contactType: 'PERSON',
        displayName: event.contactName ?? `WhatsApp ${event.senderWaId}`,
        channels: [
          {
            channelId: deterministicId('channel', contactId, event.senderWaId),
            channelType: 'PHONE',
            value: event.senderWaId,
            primary: true,
          },
        ],
        attributes: { source: 'WHATSAPP_INBOUND' },
        executionId: `wa-contact:${event.eventId}`,
        correlationId: event.eventId,
        actorPrincipalId: binding.actorPrincipalId,
        idempotencyKey: `whatsapp-contact:${event.senderWaId}`,
        evidence,
        now: event.occurredAt,
      });
    } catch (error) {
      const raced = await this.deps.crm.findContactByChannel(lookup);
      if (raced) return raced;
      throw error;
    }
  }
}

export class CanonicalWhatsAppPrivacyLifecycle implements WhatsAppPrivacyLifecycle {
  constructor(private readonly privacy: PrivacyGovernanceCore) {}

  async recordInboundPreference(input: {
    readonly binding: WhatsAppScopeBinding;
    readonly contact: ContactRecord;
    readonly subjectRef: string;
    readonly command: WhatsAppPreferenceCommand;
    readonly eventId: string;
    readonly occurredAt: string;
    readonly evidence: readonly string[];
  }): Promise<readonly string[]> {
    if (input.command === 'NONE') return [];
    const context: PrivacyExecutionContext = {
      tenantId: input.binding.tenantId,
      workspaceId: input.binding.workspaceId,
      organizationId: input.binding.organizationId,
      requester: input.binding.actorPrincipalId,
      executionId: `wa-privacy:${input.eventId}`,
      correlationId: input.eventId,
      evidence: input.evidence,
    };
    const event = await this.privacy.updatePreference({
      context,
      subjectRef: input.subjectRef,
      purposeId: input.binding.purposeId,
      channel: 'WHATSAPP',
      state: input.command === 'OPT_OUT' ? 'DENY' : 'ALLOW',
      policyRef: input.binding.policyRef,
      sourceRef: `whatsapp-message:${input.eventId}`,
      sourceEvidence: input.evidence,
    });
    return [`privacy-ledger:${event.eventId}`, `whatsapp:preference:${input.command}`];
  }

  async checkOutbound(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly purposeId: string;
    readonly preferenceRequired: boolean;
  }): Promise<SuppressionDecision> {
    return this.privacy.checkSuppression({
      context: input.context,
      subjectRef: input.subjectRef,
      purposeId: input.purposeId,
      channel: 'WHATSAPP',
      preferenceRequired: input.preferenceRequired,
    });
  }
}

export interface WhatsAppOutboundRuntimeOptions {
  readonly throttleLimit: number;
  readonly throttleWindowSeconds: number;
  readonly maxAttempts: number;
  readonly retryDelaySeconds: number;
}

export interface WhatsAppOutboundSendInput extends CrmScope {
  readonly contactRecordId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly preparedPayloadRef: string;
  readonly purposeId: string;
  readonly providerAccountRef: string;
  readonly eligibility: OutboundEligibilityContext;
  readonly executionId: string;
  readonly correlationId: string;
  readonly actorPrincipalId: string;
  readonly idempotencyKey: string;
  readonly evidence: readonly string[];
  readonly now?: string;
}

export interface WhatsAppOutboundRuntimeDependencies {
  readonly crm: CrmCoreStore;
  readonly communications: CrmCommunicationStore;
  readonly provider: WhatsAppProviderAdapter;
  readonly preparedPayloads: PreparedWhatsAppPayloadResolver;
  readonly audit: AuditSink;
}

export class WhatsAppOutboundRuntime {
  constructor(
    private readonly deps: WhatsAppOutboundRuntimeDependencies,
    private readonly options: WhatsAppOutboundRuntimeOptions,
  ) {
    assertPositiveInteger(options.throttleLimit, 'WHATSAPP_THROTTLE_LIMIT_INVALID');
    assertPositiveInteger(options.throttleWindowSeconds, 'WHATSAPP_THROTTLE_WINDOW_INVALID');
    assertPositiveInteger(options.maxAttempts, 'WHATSAPP_MAX_ATTEMPTS_INVALID');
    assertPositiveInteger(options.retryDelaySeconds, 'WHATSAPP_RETRY_DELAY_INVALID');
  }

  async send(input: WhatsAppOutboundSendInput): Promise<ProviderMessageReadback> {
    const now = normalizeNow(input.now);
    assertOutboundEligibility(input.eligibility, { approvalRequired: true });
    assertProductionProviderBinding(this.deps.provider.binding);
    if (input.eligibility.channel !== 'WHATSAPP') throw new Error('WHATSAPP_CHANNEL_REQUIRED');
    if (input.eligibility.contact.contactRecordId !== input.contactRecordId) {
      throw new Error('WHATSAPP_CONTACT_ELIGIBILITY_MISMATCH');
    }
    if (input.eligibility.privacy.decision.purposeId !== input.purposeId) {
      throw new Error('WHATSAPP_PURPOSE_ELIGIBILITY_MISMATCH');
    }

    const contact = await this.deps.crm.getContact({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      organizationId: input.organizationId,
      contactId: input.contactRecordId,
    });
    if (!contact || contact.status !== 'ACTIVE') throw new Error('WHATSAPP_CONTACT_NOT_ACTIVE');
    const prepared = await this.deps.preparedPayloads.resolve(input.preparedPayloadRef);
    if (!prepared) throw new Error('WHATSAPP_PREPARED_PAYLOAD_NOT_FOUND');

    const conversation = await this.deps.communications.getConversation({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      organizationId: input.organizationId,
      conversationId: input.conversationId,
    });
    if (!conversation || conversation.contactId !== contact.contactId) {
      throw new Error('WHATSAPP_CONVERSATION_CONTACT_MISMATCH');
    }
    enforceCustomerServiceWindow(prepared, conversation, now);
    if (conversation.status === 'HUMAN_HANDOFF') throw new Error('WHATSAPP_HUMAN_HANDOFF_ACTIVE');

    if (prepared.kind === 'TEMPLATE') {
      const template = await this.deps.provider.validateTemplate({
        templateKey: prepared.templateKey,
        locale: prepared.locale,
        variableNames: prepared.variables.map((variable) => variable.name),
      });
      if (!template.valid) throw new Error('WHATSAPP_TEMPLATE_NOT_APPROVED');
    }

    const throttle = await this.deps.communications.consumeThrottle({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      organizationId: input.organizationId,
      contactId: contact.contactId,
      channel: 'WHATSAPP',
      provider: 'META_WHATSAPP_CLOUD',
      windowSeconds: this.options.throttleWindowSeconds,
      limit: this.options.throttleLimit,
      now,
    });
    if (!throttle.allowed) {
      throw new Error(`WHATSAPP_THROTTLED:${throttle.retryAfterSeconds}`);
    }

    const message = await this.deps.communications.recordMessage({
      ...input,
      conversationId: conversation.conversationId,
      contactId: contact.contactId,
      channel: 'WHATSAPP',
      provider: 'META_WHATSAPP_CLOUD',
      direction: 'OUTBOUND',
      contentType: preparedContentType(prepared),
      status: 'PREPARED',
      templateKey: prepared.kind === 'TEMPLATE' ? prepared.templateKey : null,
      templateLocale: prepared.kind === 'TEMPLATE' ? prepared.locale : null,
      purposeId: input.purposeId,
      text: prepared.kind === 'TEXT' ? prepared.text : null,
      payload: { preparedPayloadRef: input.preparedPayloadRef },
      occurredAt: now,
      attemptCount: 0,
      evidence: input.evidence,
      now,
    });

    return this.performProviderSend(input, message, 'PREPARED', now);
  }

  async retry(input: WhatsAppOutboundSendInput): Promise<ProviderMessageReadback> {
    const now = normalizeNow(input.now);
    assertOutboundEligibility(input.eligibility, { approvalRequired: true });
    assertProductionProviderBinding(this.deps.provider.binding);
    const message = await this.deps.communications.getMessage({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      organizationId: input.organizationId,
      messageId: input.messageId,
    });
    if (!message || message.status !== 'FAILED_RETRYABLE') {
      throw new Error('WHATSAPP_RETRY_MESSAGE_NOT_ELIGIBLE');
    }
    if (message.nextRetryAt && Date.parse(message.nextRetryAt) > Date.parse(now)) {
      throw new Error('WHATSAPP_RETRY_NOT_DUE');
    }
    if (message.attemptCount >= this.options.maxAttempts) {
      await this.deps.communications.updateMessageTransport({
        ...input,
        messageId: message.messageId,
        expectedStatus: 'FAILED_RETRYABLE',
        status: 'DEAD_LETTER',
        attemptCount: message.attemptCount,
        nextRetryAt: null,
        lastErrorCode: message.lastErrorCode ?? 'WHATSAPP_RETRY_EXHAUSTED',
        idempotencyKey: `${input.idempotencyKey}:dead-letter`,
        evidence: input.evidence,
        now,
      });
      await this.deps.communications.markHumanHandoff({
        ...input,
        conversationId: message.conversationId,
        reason: 'WHATSAPP_RETRY_EXHAUSTED',
        idempotencyKey: `${input.idempotencyKey}:handoff`,
        evidence: input.evidence,
        now,
      });
      throw new Error('WHATSAPP_RETRY_EXHAUSTED');
    }
    return this.performProviderSend(input, message, 'FAILED_RETRYABLE', now);
  }

  private async performProviderSend(
    input: WhatsAppOutboundSendInput,
    message: MessageRecord,
    expectedStatus: 'PREPARED' | 'FAILED_RETRYABLE',
    now: string,
  ): Promise<ProviderMessageReadback> {
    try {
      const receipt = await this.deps.provider.send({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        organizationId: input.organizationId,
        correlationId: input.correlationId,
        channel: 'WHATSAPP',
        contactRecordId: input.contactRecordId,
        preparedPayloadRef: input.preparedPayloadRef,
        idempotencyKey: input.idempotencyKey,
        eligibility: input.eligibility,
      });
      const submitted = await this.deps.communications.updateMessageTransport({
        ...input,
        messageId: message.messageId,
        expectedStatus,
        status: 'SUBMITTED',
        providerMessageId: receipt.providerMessageId,
        attemptCount: message.attemptCount + 1,
        nextRetryAt: null,
        lastErrorCode: null,
        idempotencyKey: `${input.idempotencyKey}:submitted:${message.attemptCount + 1}`,
        evidence: [...input.evidence, ...receipt.evidence],
        now,
      });
      const readback = await this.deps.provider.readback(receipt.providerMessageId);
      await this.deps.audit.write({
        executionId: input.executionId,
        correlationId: input.correlationId,
        toolName: 'core.whatsapp.message.send',
        requester: input.actorPrincipalId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        organizationId: input.organizationId,
        status: 'SUCCEEDED',
        approvalId: input.eligibility.approval?.approvalId,
        externalResourceId: submitted.providerMessageId ?? undefined,
        evidence: [...input.evidence, ...receipt.evidence, ...readback.evidence],
        createdAt: now,
      });
      return readback;
    } catch (error) {
      const failure = classifyProviderFailure(error, message.attemptCount + 1, now, this.options);
      await this.deps.communications.updateMessageTransport({
        ...input,
        messageId: message.messageId,
        expectedStatus,
        status: failure.status,
        attemptCount: message.attemptCount + 1,
        nextRetryAt: failure.nextRetryAt,
        lastErrorCode: failure.errorCode,
        idempotencyKey: `${input.idempotencyKey}:failed:${message.attemptCount + 1}`,
        evidence: input.evidence,
        now,
      });
      if (failure.status === 'DEAD_LETTER') {
        await this.deps.communications.markHumanHandoff({
          ...input,
          conversationId: message.conversationId,
          reason: failure.errorCode,
          idempotencyKey: `${input.idempotencyKey}:handoff:${message.attemptCount + 1}`,
          evidence: input.evidence,
          now,
        });
      }
      await this.deps.audit.write({
        executionId: input.executionId,
        correlationId: input.correlationId,
        toolName: 'core.whatsapp.message.send',
        requester: input.actorPrincipalId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        organizationId: input.organizationId,
        status: 'FAILED',
        approvalId: input.eligibility.approval?.approvalId,
        errorCode: failure.errorCode,
        evidence: input.evidence,
        createdAt: now,
      });
      throw error;
    }
  }
}

export class ScopedWhatsAppReadbackStore implements WhatsAppProviderReadbackStore {
  constructor(
    private readonly scope: CrmScope,
    private readonly communications: CrmCommunicationStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async latest(providerMessageId: string): Promise<ProviderMessageReadback | undefined> {
    const message = await this.communications.getMessageByProviderId({
      ...this.scope,
      provider: 'META_WHATSAPP_CLOUD',
      providerMessageId,
    });
    if (!message) return undefined;
    return {
      provider: 'META_WHATSAPP_CLOUD',
      providerMessageId,
      state: toReadbackState(message.status),
      observedAt: message.updatedAt || this.now(),
      evidence: [`crm-message:${message.messageId}`, `crm-message-status:${message.status}`],
    };
  }
}

function enforceCustomerServiceWindow(
  prepared: PreparedWhatsAppMessage,
  conversation: ConversationRecord,
  now: string,
): void {
  if (prepared.kind === 'TEMPLATE') return;
  if (!conversation.lastInboundAt) throw new Error('WHATSAPP_CUSTOMER_SERVICE_WINDOW_CLOSED');
  const age = Date.parse(now) - Date.parse(conversation.lastInboundAt);
  if (age < 0 || age > 24 * 60 * 60 * 1000) {
    throw new Error('WHATSAPP_CUSTOMER_SERVICE_WINDOW_CLOSED');
  }
}

function preparedContentType(prepared: PreparedWhatsAppMessage): MessageRecord['contentType'] {
  if (prepared.kind === 'TEXT') return 'TEXT';
  if (prepared.kind === 'TEMPLATE') return 'TEMPLATE';
  if (prepared.mediaType === 'image') return 'IMAGE';
  if (prepared.mediaType === 'audio') return 'AUDIO';
  if (prepared.mediaType === 'video') return 'VIDEO';
  return 'DOCUMENT';
}

function classifyProviderFailure(
  error: unknown,
  attemptCount: number,
  now: string,
  options: WhatsAppOutboundRuntimeOptions,
): {
  readonly status: 'FAILED_RETRYABLE' | 'FAILED' | 'DEAD_LETTER';
  readonly nextRetryAt: string | null;
  readonly errorCode: string;
} {
  if (error instanceof MetaApiError) {
    if (error.status === 429 && attemptCount < options.maxAttempts) {
      return {
        status: 'FAILED_RETRYABLE',
        nextRetryAt: new Date(Date.parse(now) + options.retryDelaySeconds * 1000).toISOString(),
        errorCode: `WHATSAPP_PROVIDER_RATE_LIMITED:${error.providerCode ?? error.status}`,
      };
    }
    if (error.status >= 400 && error.status < 500) {
      return {
        status: 'FAILED',
        nextRetryAt: null,
        errorCode: `WHATSAPP_PROVIDER_REJECTED:${error.providerCode ?? error.status}`,
      };
    }
    return {
      status: 'DEAD_LETTER',
      nextRetryAt: null,
      errorCode: `WHATSAPP_PROVIDER_OUTCOME_UNCERTAIN:${error.status}`,
    };
  }
  return {
    status: 'DEAD_LETTER',
    nextRetryAt: null,
    errorCode: 'WHATSAPP_PROVIDER_OUTCOME_UNCERTAIN',
  };
}

function toReadbackState(status: MessageRecord['status']): ProviderMessageReadback['state'] {
  if (status === 'SENT') return 'SENT';
  if (status === 'DELIVERED' || status === 'READ') return 'DELIVERED';
  if (status === 'FAILED' || status === 'FAILED_RETRYABLE' || status === 'DEAD_LETTER') return 'FAILED';
  if (status === 'SUBMITTED') return 'QUEUED';
  return 'UNKNOWN';
}

function normalizeNow(value: string | undefined): string {
  const now = value ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(now))) throw new Error('WHATSAPP_NOW_INVALID');
  return now;
}

function deterministicId(...parts: readonly string[]): string {
  return `wa_${createHash('sha256').update(parts.join('|')).digest('hex')}`;
}

function assertPositiveInteger(value: number, errorCode: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(errorCode);
}
