import { createHash } from 'node:crypto';
import type { AuditSink } from '../core/audit.js';
import type {
  ContactChannelRecord,
  ContactRecord,
  CrmCoreStore,
  CrmScope,
} from '../crm/crm-records.js';
import type { ConversationRecord, CrmSalesStore, MessageRecord } from '../crm/sales-engine.js';
import {
  assertOutboundEligibility,
  assertProductionProviderBinding,
  type OutboundEligibilityContext,
  type ProviderMessageReadback,
  type WhatsAppProviderAdapter,
} from './contracts.js';
import type { PrivacyExecutionContext } from '../privacy/contracts.js';
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
import {
  type WhatsAppConversationBinding,
  type WhatsAppDispatchRecord,
  type WhatsAppDispatchState,
  type WhatsAppRuntimeStore,
} from './whatsapp-runtime-contracts.js';

export interface WhatsAppScopeBinding extends CrmScope {
  readonly metaAppId: string;
  readonly wabaId: string;
  readonly phoneNumberId: string;
  readonly providerAccountRef: string;
  readonly purposeId: string;
  readonly policyRef: string;
  readonly actorPrincipalId: string;
  readonly language: string;
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
    readonly event: WhatsAppInboundMessageEvent;
    readonly humanHandoff: boolean;
    readonly evidence: readonly string[];
  }): Promise<void>;
}

export interface WhatsAppInboundRuntimeDependencies {
  readonly scopes: WhatsAppScopeResolver;
  readonly crm: CrmCoreStore;
  readonly sales: CrmSalesStore;
  readonly transport: WhatsAppRuntimeStore;
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
    if (binding.wabaId !== event.wabaId || binding.phoneNumberId !== event.phoneNumberId) {
      throw new Error('WHATSAPP_SCOPE_BINDING_MISMATCH');
    }

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
    const evidence = [
      `whatsapp:webhook:${event.eventId}`,
      `meta:app:${binding.metaAppId}`,
      `meta:waba:${binding.wabaId}`,
      `meta:phone-number-id:${binding.phoneNumberId}`,
      `meta:wamid:${event.providerMessageId}`,
    ];
    const contact = await this.resolveContact(binding, event, evidence);
    const subjectRef = await this.deps.privacySubjects.resolve(contact);
    if (!subjectRef.trim()) throw new Error('WHATSAPP_PRIVACY_SUBJECT_NOT_RESOLVED');
    const recipientSha256 = hashRecipient(event.senderWaId);
    const conversation = await this.resolveConversation(
      binding,
      contact,
      recipientSha256,
      event,
      evidence,
    );

    const messageId = deterministicId('message', binding.phoneNumberId, event.providerMessageId);
    const message = await this.deps.sales.appendMessage({
      ...scopeOf(binding),
      messageId,
      conversationId: conversation.conversationId,
      contactId: contact.contactId,
      direction: 'INBOUND',
      channel: 'WHATSAPP',
      language: binding.language,
      contentRef: `whatsapp:provider-message:${event.providerMessageId}`,
      contentSha256: hashInboundContent(event),
      providerMessageRef: event.providerMessageId,
      occurredAt: event.occurredAt,
      executionId: `wa-inbound:${event.eventId}`,
      correlationId: event.eventId,
      actorPrincipalId: binding.actorPrincipalId,
      idempotencyKey: `whatsapp-message:${event.eventId}`,
      evidence,
      now: event.occurredAt,
    });

    for (const [index, attachment] of event.attachments.entries()) {
      await this.deps.transport.recordMedia({
        ...scopeOf(binding),
        mediaRecordId: deterministicId(
          'media',
          event.providerMessageId,
          attachment.providerMediaId,
          String(index),
        ),
        messageId: message.messageId,
        direction: 'INBOUND',
        providerMediaId: attachment.providerMediaId,
        mimeType: attachment.mimeType,
        fileName: attachment.fileName,
        sha256: attachment.sha256,
        sizeBytes: null,
        storageRef: null,
        executionId: `wa-media:${event.eventId}:${index}`,
        correlationId: event.eventId,
        actorPrincipalId: binding.actorPrincipalId,
        idempotencyKey: `whatsapp-media:${event.eventId}:${index}`,
        evidence,
        now: event.occurredAt,
      });
    }

    await this.deps.transport.touchBinding({
      ...scopeOf(binding),
      conversationId: conversation.conversationId,
      direction: 'INBOUND',
      occurredAt: event.occurredAt,
      executionId: `wa-activity:${event.eventId}`,
      correlationId: event.eventId,
      actorPrincipalId: binding.actorPrincipalId,
      idempotencyKey: `whatsapp-inbound-activity:${event.eventId}`,
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
    if (humanHandoff) {
      const reason =
        event.contentType === 'UNKNOWN' ? 'UNSUPPORTED_WHATSAPP_CONTENT' : 'CUSTOMER_REQUEST';
      await this.deps.transport.markHumanHandoff({
        ...scopeOf(binding),
        conversationId: conversation.conversationId,
        reason,
        executionId: `wa-handoff:${event.eventId}`,
        correlationId: event.eventId,
        actorPrincipalId: binding.actorPrincipalId,
        idempotencyKey: `whatsapp-handoff:${event.eventId}`,
        evidence,
        now: event.occurredAt,
      });
      await this.deps.sales.appendActivity({
        ...scopeOf(binding),
        activityId: deterministicId('handoff-activity', event.eventId),
        contactId: contact.contactId,
        conversationId: conversation.conversationId,
        activityType: 'HUMAN_HANDOFF',
        channel: 'WHATSAPP',
        summary: 'WhatsApp conversation routed to human handoff.',
        outcome: reason,
        occurredAt: event.occurredAt,
        executionId: `wa-handoff-activity:${event.eventId}`,
        correlationId: event.eventId,
        actorPrincipalId: binding.actorPrincipalId,
        idempotencyKey: `whatsapp-handoff-activity:${event.eventId}`,
        evidence,
        now: event.occurredAt,
      });
    }

    await this.deps.workflow.onInboundMessage({
      binding,
      contact,
      conversation,
      message,
      event,
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
    const evidence = [
      `whatsapp:webhook:${event.eventId}`,
      `meta:app:${binding.metaAppId}`,
      `meta:waba:${binding.wabaId}`,
      `meta:phone-number-id:${binding.phoneNumberId}`,
      `meta:wamid:${event.providerMessageId}`,
    ];
    await this.deps.transport.recordProviderEvent({
      ...scopeOf(binding),
      eventId: deterministicId('provider-event', event.eventId),
      providerMessageRef: event.providerMessageId,
      providerEventRef: event.eventId,
      status: event.status,
      errorCode: event.errorCode,
      errorTitle: event.errorTitle,
      observedAt: event.observedAt,
      executionId: `wa-status:${event.eventId}`,
      correlationId: event.eventId,
      actorPrincipalId: binding.actorPrincipalId,
      idempotencyKey: `whatsapp-status:${event.eventId}`,
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
    const resolution = await this.deps.sales.resolveContact({
      ...scopeOf(binding),
      channels: [
        {
          channelType: 'PHONE',
          provider: 'META_WHATSAPP_CLOUD',
          value: event.senderWaId,
        },
      ],
    });
    if (resolution.state === 'AMBIGUOUS') throw new Error('WHATSAPP_CONTACT_AMBIGUOUS');
    if (resolution.state === 'RESOLVED' && resolution.canonicalContactId) {
      const contact = await this.deps.crm.getContact({
        ...scopeOf(binding),
        contactId: resolution.canonicalContactId,
      });
      if (!contact || contact.status !== 'ACTIVE') throw new Error('WHATSAPP_CONTACT_NOT_ACTIVE');
      return contact;
    }

    const contactId = deterministicId(
      'contact',
      binding.tenantId,
      binding.workspaceId,
      binding.organizationId,
      hashRecipient(event.senderWaId),
    );
    try {
      return await this.deps.crm.createContact({
        ...scopeOf(binding),
        contactId,
        contactType: 'PERSON',
        displayName: event.contactName ?? 'WhatsApp contact',
        channels: [
          {
            channelId: deterministicId('contact-channel', contactId, 'whatsapp'),
            channelType: 'PHONE',
            provider: 'META_WHATSAPP_CLOUD',
            value: event.senderWaId,
            primary: true,
          },
        ],
        attributes: { source: 'WHATSAPP_INBOUND' },
        executionId: `wa-contact:${event.eventId}`,
        correlationId: event.eventId,
        actorPrincipalId: binding.actorPrincipalId,
        idempotencyKey: `whatsapp-contact:${hashRecipient(event.senderWaId)}`,
        evidence,
        now: event.occurredAt,
      });
    } catch (error) {
      const raced = await this.deps.sales.resolveContact({
        ...scopeOf(binding),
        channels: [
          {
            channelType: 'PHONE',
            provider: 'META_WHATSAPP_CLOUD',
            value: event.senderWaId,
          },
        ],
      });
      if (raced.state === 'RESOLVED' && raced.canonicalContactId) {
        const contact = await this.deps.crm.getContact({
          ...scopeOf(binding),
          contactId: raced.canonicalContactId,
        });
        if (contact) return contact;
      }
      throw error;
    }
  }

  private async resolveConversation(
    binding: WhatsAppScopeBinding,
    contact: ContactRecord,
    recipientSha256: string,
    event: WhatsAppInboundMessageEvent,
    evidence: readonly string[],
  ): Promise<ConversationRecord> {
    const existingBinding = await this.deps.transport.getBindingByRecipient({
      ...scopeOf(binding),
      phoneNumberId: binding.phoneNumberId,
      recipientSha256,
    });
    const conversationId =
      existingBinding?.conversationId ??
      deterministicId(
        'conversation',
        binding.tenantId,
        binding.workspaceId,
        binding.organizationId,
        binding.phoneNumberId,
        recipientSha256,
      );
    const conversation = await this.deps.sales.createConversation({
      ...scopeOf(binding),
      conversationId,
      contactId: contact.contactId,
      channel: 'WHATSAPP',
      language: binding.language,
      attributes: {
        source: 'WHATSAPP',
        metaAppId: binding.metaAppId,
        wabaId: binding.wabaId,
        phoneNumberId: binding.phoneNumberId,
      },
      executionId: `wa-conversation:${event.eventId}`,
      correlationId: event.eventId,
      actorPrincipalId: binding.actorPrincipalId,
      idempotencyKey: `whatsapp-conversation:${binding.phoneNumberId}:${recipientSha256}`,
      evidence,
      now: event.occurredAt,
    });
    await this.deps.transport.ensureBinding({
      ...scopeOf(binding),
      bindingId: deterministicId('binding', conversationId),
      conversationId,
      contactId: contact.contactId,
      metaAppId: binding.metaAppId,
      wabaId: binding.wabaId,
      phoneNumberId: binding.phoneNumberId,
      recipientSha256,
      executionId: `wa-binding:${event.eventId}`,
      correlationId: event.eventId,
      actorPrincipalId: binding.actorPrincipalId,
      idempotencyKey: `whatsapp-binding:${binding.phoneNumberId}:${recipientSha256}`,
      evidence,
      now: event.occurredAt,
    });
    return conversation;
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
  readonly eligibility: OutboundEligibilityContext;
  readonly executionId: string;
  readonly correlationId: string;
  readonly actorPrincipalId: string;
  readonly idempotencyKey: string;
  readonly evidence: readonly string[];
  readonly language: string;
  readonly now?: string;
}

export interface WhatsAppOutboundRuntimeDependencies {
  readonly crm: CrmCoreStore;
  readonly sales: CrmSalesStore;
  readonly transport: WhatsAppRuntimeStore;
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
    this.assertEligibility(input);
    const existing = await this.deps.transport.getDispatchByIdempotencyKey({
      ...scopeOf(input),
      idempotencyKey: input.idempotencyKey,
    });
    if (existing) return this.resumeExisting(input, existing, now);

    const { contact, binding, prepared } = await this.preflight(input, now, true);
    const message = await this.deps.sales.appendMessage({
      ...scopeOf(input),
      messageId: input.messageId,
      conversationId: input.conversationId,
      contactId: contact.contactId,
      direction: 'OUTBOUND',
      channel: 'WHATSAPP',
      language: input.language,
      contentRef: input.preparedPayloadRef,
      contentSha256: hashPreparedMessage(prepared),
      providerMessageRef: null,
      occurredAt: now,
      executionId: input.executionId,
      correlationId: input.correlationId,
      actorPrincipalId: input.actorPrincipalId,
      idempotencyKey: `whatsapp-canonical-message:${input.idempotencyKey}`,
      evidence: input.evidence,
      now,
    });
    const dispatch = await this.deps.transport.createDispatch({
      ...scopeOf(input),
      dispatchId: deterministicId('dispatch', input.idempotencyKey),
      messageId: message.messageId,
      conversationId: binding.conversationId,
      contactId: contact.contactId,
      preparedPayloadRef: input.preparedPayloadRef,
      purposeId: input.purposeId,
      executionId: input.executionId,
      correlationId: input.correlationId,
      actorPrincipalId: input.actorPrincipalId,
      idempotencyKey: input.idempotencyKey,
      evidence: input.evidence,
      now,
    });
    return this.performProviderAttempt(input, dispatch, 'PREPARED', now);
  }

  async retry(input: WhatsAppOutboundSendInput): Promise<ProviderMessageReadback> {
    const now = normalizeNow(input.now);
    this.assertEligibility(input);
    const dispatch = await this.deps.transport.getDispatchByIdempotencyKey({
      ...scopeOf(input),
      idempotencyKey: input.idempotencyKey,
    });
    if (!dispatch || dispatch.state !== 'FAILED_RETRYABLE') {
      throw new Error('WHATSAPP_RETRY_DISPATCH_NOT_ELIGIBLE');
    }
    if (dispatch.nextRetryAt && Date.parse(dispatch.nextRetryAt) > Date.parse(now)) {
      throw new Error('WHATSAPP_RETRY_NOT_DUE');
    }
    if (dispatch.attemptCount >= this.options.maxAttempts) {
      await this.deadLetter(input, dispatch, 'WHATSAPP_RETRY_EXHAUSTED', now);
      throw new Error('WHATSAPP_RETRY_EXHAUSTED');
    }
    await this.preflight(input, now, true);
    return this.performProviderAttempt(input, dispatch, 'FAILED_RETRYABLE', now);
  }

  private assertEligibility(input: WhatsAppOutboundSendInput): void {
    assertOutboundEligibility(input.eligibility, { approvalRequired: true });
    assertProductionProviderBinding(this.deps.provider.binding);
    if (input.eligibility.channel !== 'WHATSAPP') throw new Error('WHATSAPP_CHANNEL_REQUIRED');
    if (input.eligibility.contact.contactRecordId !== input.contactRecordId) {
      throw new Error('WHATSAPP_CONTACT_ELIGIBILITY_MISMATCH');
    }
    if (input.eligibility.privacy.decision.purposeId !== input.purposeId) {
      throw new Error('WHATSAPP_PURPOSE_ELIGIBILITY_MISMATCH');
    }
  }

  private async preflight(
    input: WhatsAppOutboundSendInput,
    now: string,
    consumeThrottle: boolean,
  ): Promise<{
    readonly contact: ContactRecord;
    readonly binding: WhatsAppConversationBinding;
    readonly prepared: PreparedWhatsAppMessage;
  }> {
    const contact = await this.deps.crm.getContact({
      ...scopeOf(input),
      contactId: input.contactRecordId,
    });
    if (!contact || contact.status !== 'ACTIVE') throw new Error('WHATSAPP_CONTACT_NOT_ACTIVE');
    const binding = await this.deps.transport.getBindingByConversation({
      ...scopeOf(input),
      conversationId: input.conversationId,
    });
    if (!binding || binding.contactId !== contact.contactId) {
      throw new Error('WHATSAPP_CONVERSATION_CONTACT_MISMATCH');
    }
    if (binding.humanHandoffAt) throw new Error('WHATSAPP_HUMAN_HANDOFF_ACTIVE');
    const prepared = await this.deps.preparedPayloads.resolve(input.preparedPayloadRef);
    if (!prepared) throw new Error('WHATSAPP_PREPARED_PAYLOAD_NOT_FOUND');
    const contactChannels = await this.deps.crm.listContactChannels({
      ...scopeOf(input),
      contactId: contact.contactId,
    });
    assertPreparedRecipientMatchesContact(prepared, contactChannels);
    enforceCustomerServiceWindow(prepared, binding, now);
    if (prepared.kind === 'TEMPLATE') {
      const validation = await this.deps.provider.validateTemplate({
        templateKey: prepared.templateKey,
        locale: prepared.locale,
        variableNames: prepared.variables.map((variable) => variable.name),
      });
      if (!validation.valid) throw new Error('WHATSAPP_TEMPLATE_NOT_APPROVED');
    }
    if (consumeThrottle) {
      const throttle = await this.deps.transport.consumeThrottle({
        ...scopeOf(input),
        contactId: contact.contactId,
        windowSeconds: this.options.throttleWindowSeconds,
        limit: this.options.throttleLimit,
        now,
      });
      if (!throttle.allowed) throw new Error(`WHATSAPP_THROTTLED:${throttle.retryAfterSeconds}`);
    }
    return { contact, binding, prepared };
  }

  private async resumeExisting(
    input: WhatsAppOutboundSendInput,
    dispatch: WhatsAppDispatchRecord,
    now: string,
  ): Promise<ProviderMessageReadback> {
    if (
      dispatch.messageId !== input.messageId ||
      dispatch.conversationId !== input.conversationId ||
      dispatch.contactId !== input.contactRecordId ||
      dispatch.preparedPayloadRef !== input.preparedPayloadRef ||
      dispatch.purposeId !== input.purposeId
    ) {
      throw new Error('WHATSAPP_DISPATCH_IDEMPOTENCY_CONFLICT');
    }
    if (dispatch.providerMessageRef)
      return this.deps.provider.readback(dispatch.providerMessageRef);
    if (dispatch.state === 'PREPARED') {
      await this.preflight(input, now, true);
      return this.performProviderAttempt(input, dispatch, 'PREPARED', now);
    }
    if (dispatch.state === 'SUBMITTED') {
      await this.deadLetter(input, dispatch, 'WHATSAPP_PROVIDER_OUTCOME_UNCERTAIN', now);
      throw new Error('WHATSAPP_PROVIDER_OUTCOME_UNCERTAIN');
    }
    if (dispatch.state === 'FAILED_RETRYABLE') throw new Error('WHATSAPP_RETRY_REQUIRED');
    throw new Error(`WHATSAPP_DISPATCH_TERMINAL:${dispatch.state}`);
  }

  private async performProviderAttempt(
    input: WhatsAppOutboundSendInput,
    dispatch: WhatsAppDispatchRecord,
    expectedState: 'PREPARED' | 'FAILED_RETRYABLE',
    now: string,
  ): Promise<ProviderMessageReadback> {
    const attemptCount = dispatch.attemptCount + 1;
    const submitted = await this.deps.transport.updateDispatch({
      ...scopeOf(input),
      dispatchId: dispatch.dispatchId,
      expectedState,
      state: 'SUBMITTED',
      attemptCount,
      nextRetryAt: null,
      lastErrorCode: null,
      executionId: input.executionId,
      correlationId: input.correlationId,
      actorPrincipalId: input.actorPrincipalId,
      idempotencyKey: `${input.idempotencyKey}:attempt:${attemptCount}:submitted`,
      evidence: input.evidence,
      now,
    });

    try {
      const receipt = await this.deps.provider.send({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        organizationId: input.organizationId,
        correlationId: input.correlationId,
        channel: 'WHATSAPP',
        contactRecordId: input.contactRecordId,
        preparedPayloadRef: input.preparedPayloadRef,
        idempotencyKey: `${input.idempotencyKey}:provider:${attemptCount}`,
        eligibility: input.eligibility,
      });
      const accepted = await this.deps.transport.updateDispatch({
        ...scopeOf(input),
        dispatchId: submitted.dispatchId,
        expectedState: 'SUBMITTED',
        state: 'SUBMITTED',
        providerMessageRef: receipt.providerMessageId,
        attemptCount,
        nextRetryAt: null,
        lastErrorCode: null,
        executionId: input.executionId,
        correlationId: input.correlationId,
        actorPrincipalId: input.actorPrincipalId,
        idempotencyKey: `${input.idempotencyKey}:attempt:${attemptCount}:accepted`,
        evidence: [...input.evidence, ...receipt.evidence],
        now,
      });
      await this.deps.transport.touchBinding({
        ...scopeOf(input),
        conversationId: input.conversationId,
        direction: 'OUTBOUND',
        occurredAt: receipt.acceptedAt,
        executionId: input.executionId,
        correlationId: input.correlationId,
        actorPrincipalId: input.actorPrincipalId,
        idempotencyKey: `${input.idempotencyKey}:outbound-activity:${attemptCount}`,
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
        ...(input.eligibility.approval
          ? { approvalId: input.eligibility.approval.approvalId }
          : {}),
        ...(accepted.providerMessageRef ? { externalResourceId: accepted.providerMessageRef } : {}),
        evidence: [...input.evidence, ...receipt.evidence, ...readback.evidence],
        createdAt: now,
      });
      return readback;
    } catch (error) {
      const failure = classifyProviderFailure(error, attemptCount, now, this.options);
      const failed = await this.deps.transport.updateDispatch({
        ...scopeOf(input),
        dispatchId: submitted.dispatchId,
        expectedState: 'SUBMITTED',
        state: failure.state,
        attemptCount,
        nextRetryAt: failure.nextRetryAt,
        lastErrorCode: failure.errorCode,
        executionId: input.executionId,
        correlationId: input.correlationId,
        actorPrincipalId: input.actorPrincipalId,
        idempotencyKey: `${input.idempotencyKey}:attempt:${attemptCount}:failed`,
        evidence: input.evidence,
        now,
      });
      if (failed.state === 'DEAD_LETTER') {
        await this.deps.transport.markHumanHandoff({
          ...scopeOf(input),
          conversationId: input.conversationId,
          reason: failure.errorCode,
          executionId: input.executionId,
          correlationId: input.correlationId,
          actorPrincipalId: input.actorPrincipalId,
          idempotencyKey: `${input.idempotencyKey}:handoff:${attemptCount}`,
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
        ...(input.eligibility.approval
          ? { approvalId: input.eligibility.approval.approvalId }
          : {}),
        errorCode: failure.errorCode,
        evidence: input.evidence,
        createdAt: now,
      });
      throw error;
    }
  }

  private async deadLetter(
    input: WhatsAppOutboundSendInput,
    dispatch: WhatsAppDispatchRecord,
    reason: string,
    now: string,
  ): Promise<void> {
    const expectedState: WhatsAppDispatchState = dispatch.state;
    await this.deps.transport.updateDispatch({
      ...scopeOf(input),
      dispatchId: dispatch.dispatchId,
      expectedState,
      state: 'DEAD_LETTER',
      attemptCount: dispatch.attemptCount,
      nextRetryAt: null,
      lastErrorCode: reason,
      executionId: input.executionId,
      correlationId: input.correlationId,
      actorPrincipalId: input.actorPrincipalId,
      idempotencyKey: `${input.idempotencyKey}:dead-letter:${dispatch.attemptCount}`,
      evidence: input.evidence,
      now,
    });
    await this.deps.transport.markHumanHandoff({
      ...scopeOf(input),
      conversationId: dispatch.conversationId,
      reason,
      executionId: input.executionId,
      correlationId: input.correlationId,
      actorPrincipalId: input.actorPrincipalId,
      idempotencyKey: `${input.idempotencyKey}:handoff:${dispatch.attemptCount}`,
      evidence: input.evidence,
      now,
    });
  }
}

export class ScopedWhatsAppReadbackStore implements WhatsAppProviderReadbackStore {
  constructor(
    private readonly scope: CrmScope,
    private readonly transport: WhatsAppRuntimeStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async latest(providerMessageId: string): Promise<ProviderMessageReadback | undefined> {
    const dispatch = await this.transport.getDispatchByProviderMessageRef({
      ...this.scope,
      providerMessageRef: providerMessageId,
    });
    if (!dispatch) return undefined;
    return {
      provider: 'META_WHATSAPP_CLOUD',
      providerMessageId,
      state: toReadbackState(dispatch.state),
      observedAt: dispatch.updatedAt || this.now(),
      evidence: [`whatsapp-dispatch:${dispatch.dispatchId}`, `whatsapp-state:${dispatch.state}`],
    };
  }
}

function assertPreparedRecipientMatchesContact(
  prepared: PreparedWhatsAppMessage,
  channels: readonly ContactChannelRecord[],
): void {
  const recipient = normalizePhoneNumber(prepared.to);
  const matchesCanonicalChannel = channels.some(
    (channel) =>
      channel.channelType === 'PHONE' &&
      channel.provider === 'META_WHATSAPP_CLOUD' &&
      normalizePhoneNumber(channel.value) === recipient,
  );
  if (!matchesCanonicalChannel) throw new Error('WHATSAPP_RECIPIENT_CONTACT_MISMATCH');
}

function normalizePhoneNumber(value: string): string {
  const normalized = value.replace(/\D/g, '');
  if (!/^\d{7,15}$/.test(normalized)) throw new Error('WHATSAPP_RECIPIENT_INVALID');
  return normalized;
}

function enforceCustomerServiceWindow(
  prepared: PreparedWhatsAppMessage,
  binding: WhatsAppConversationBinding,
  now: string,
): void {
  if (prepared.kind === 'TEMPLATE') return;
  if (!binding.lastInboundAt) throw new Error('WHATSAPP_CUSTOMER_SERVICE_WINDOW_CLOSED');
  const age = Date.parse(now) - Date.parse(binding.lastInboundAt);
  if (age < 0 || age > 24 * 60 * 60 * 1000) {
    throw new Error('WHATSAPP_CUSTOMER_SERVICE_WINDOW_CLOSED');
  }
}

function classifyProviderFailure(
  error: unknown,
  attemptCount: number,
  now: string,
  options: WhatsAppOutboundRuntimeOptions,
): {
  readonly state: 'FAILED_RETRYABLE' | 'FAILED' | 'DEAD_LETTER';
  readonly nextRetryAt: string | null;
  readonly errorCode: string;
} {
  if (error instanceof MetaApiError) {
    if (error.status === 429 && attemptCount < options.maxAttempts) {
      return {
        state: 'FAILED_RETRYABLE',
        nextRetryAt: new Date(Date.parse(now) + options.retryDelaySeconds * 1000).toISOString(),
        errorCode: `WHATSAPP_PROVIDER_RATE_LIMITED:${error.providerCode ?? error.status}`,
      };
    }
    if (error.status >= 400 && error.status < 500) {
      return {
        state: 'FAILED',
        nextRetryAt: null,
        errorCode: `WHATSAPP_PROVIDER_REJECTED:${error.providerCode ?? error.status}`,
      };
    }
    return {
      state: 'DEAD_LETTER',
      nextRetryAt: null,
      errorCode: `WHATSAPP_PROVIDER_OUTCOME_UNCERTAIN:${error.status}`,
    };
  }
  return {
    state: 'DEAD_LETTER',
    nextRetryAt: null,
    errorCode: 'WHATSAPP_PROVIDER_OUTCOME_UNCERTAIN',
  };
}

function toReadbackState(state: WhatsAppDispatchState): ProviderMessageReadback['state'] {
  if (state === 'SENT') return 'SENT';
  if (state === 'DELIVERED' || state === 'READ') return 'DELIVERED';
  if (state === 'FAILED' || state === 'FAILED_RETRYABLE' || state === 'DEAD_LETTER') {
    return 'FAILED';
  }
  if (state === 'SUBMITTED') return 'QUEUED';
  return 'UNKNOWN';
}

function hashInboundContent(event: WhatsAppInboundMessageEvent): string {
  return hashJson({
    providerMessageId: event.providerMessageId,
    occurredAt: event.occurredAt,
    contentType: event.contentType,
    text: event.text,
    replyToProviderMessageId: event.replyToProviderMessageId,
    attachments: event.attachments,
    payload: event.payload,
  });
}

function hashPreparedMessage(message: PreparedWhatsAppMessage): string {
  return hashJson(message);
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

function hashRecipient(value: string): string {
  return createHash('sha256').update(value.trim()).digest('hex');
}

function deterministicId(...parts: readonly string[]): string {
  return `wa_${createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 40)}`;
}

function normalizeNow(value: string | undefined): string {
  const now = value ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(now))) throw new Error('WHATSAPP_NOW_INVALID');
  return new Date(now).toISOString();
}

function assertPositiveInteger(value: number, errorCode: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(errorCode);
}

function scopeOf(input: CrmScope): CrmScope {
  return {
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    organizationId: input.organizationId,
  };
}
