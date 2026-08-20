import { createHash } from 'node:crypto';
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
import {
  requireFreshOutboundPrivacy,
  type OutboundPrivacyRevalidationPort,
} from './privacy-runtime-gate.js';
import type { PrivacyExecutionContext } from '../privacy/contracts.js';
import type { PrivacyGovernanceCore } from '../privacy/privacy-governance-core.js';
import { MetaApiError } from '../providers/meta/meta-api-client.js';
import type {
  PreparedWhatsAppMessage,
  PreparedWhatsAppPayloadResolver,
  WhatsAppMediaMetadata,
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
import type {
  WhatsAppConversationBinding,
  WhatsAppDispatchRecord,
  WhatsAppRuntimeStore,
} from './whatsapp-runtime-contracts.js';

export interface WhatsAppScopeBinding extends CrmScope {
  readonly metaAppId: string;
  readonly wabaId: string;
  readonly phoneNumberId: string;
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
  onUnmatchedStatus?(input: {
    readonly binding: WhatsAppScopeBinding;
    readonly event: WhatsAppDeliveryStatusEvent;
  }): Promise<void>;
}

export interface WhatsAppMediaMetadataReader {
  readMediaMetadata(mediaId: string): Promise<WhatsAppMediaMetadata>;
}

export interface WhatsAppInboundRuntimeDependencies {
  readonly scopes: WhatsAppScopeResolver;
  readonly crm: CrmCoreStore;
  readonly sales: CrmSalesStore;
  readonly transport: WhatsAppRuntimeStore;
  readonly privacySubjects: WhatsAppPrivacySubjectResolver;
  readonly privacy: WhatsAppPrivacyLifecycle;
  readonly workflow: WhatsAppCrmWorkflow;
  readonly media?: WhatsAppMediaMetadataReader;
}

export class WhatsAppInboundRuntime {
  constructor(private readonly deps: WhatsAppInboundRuntimeDependencies) {}

  async ingest(event: WhatsAppWebhookEvent): Promise<void> {
    const binding = await this.deps.scopes.resolve({
      wabaId: event.wabaId,
      phoneNumberId: event.phoneNumberId,
    });
    if (!binding) throw new Error('WHATSAPP_SCOPE_BINDING_NOT_FOUND');
    assertProviderScope(binding, event.wabaId, event.phoneNumberId);

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
    const recipientSha256 = sha256(event.senderWaId);
    const existingBinding = await this.deps.transport.getBindingByRecipient({
      ...binding,
      phoneNumberId: event.phoneNumberId,
      recipientSha256,
    });

    let conversation: ConversationRecord;
    if (existingBinding) {
      if (existingBinding.contactId !== contact.contactId) {
        throw new Error('WHATSAPP_BINDING_CONTACT_MISMATCH');
      }
      conversation = canonicalConversationFromBinding(existingBinding, event.occurredAt);
    } else {
      const conversationId = deterministicId(
        'conversation',
        binding.tenantId,
        binding.workspaceId,
        binding.organizationId,
        contact.contactId,
        event.phoneNumberId,
      );
      conversation = await this.deps.sales.createConversation({
        ...binding,
        conversationId,
        contactId: contact.contactId,
        channel: 'WHATSAPP',
        language: 'und',
        attributes: {
          meta_app_id: binding.metaAppId,
          waba_id: binding.wabaId,
          phone_number_id: binding.phoneNumberId,
        },
        executionId: `wa-conversation:${event.eventId}`,
        correlationId: event.eventId,
        actorPrincipalId: binding.actorPrincipalId,
        idempotencyKey: `whatsapp-conversation:${recipientSha256}`,
        evidence,
        now: event.occurredAt,
      });
      await this.deps.transport.ensureBinding({
        ...binding,
        bindingId: deterministicId('binding', conversation.conversationId),
        conversationId: conversation.conversationId,
        contactId: contact.contactId,
        metaAppId: binding.metaAppId,
        wabaId: binding.wabaId,
        phoneNumberId: binding.phoneNumberId,
        recipientSha256,
        executionId: `wa-binding:${event.eventId}`,
        correlationId: event.eventId,
        actorPrincipalId: binding.actorPrincipalId,
        idempotencyKey: `whatsapp-binding:${recipientSha256}`,
        evidence,
        now: event.occurredAt,
      });
    }

    const preference = classifyWhatsappPreferenceCommand(event.text);
    const humanHandoff = requestsHumanHandoff(event.text) || event.contentType === 'UNKNOWN';
    const message = await this.deps.sales.appendMessage({
      ...binding,
      messageId: deterministicId('message', event.phoneNumberId, event.providerMessageId),
      conversationId: conversation.conversationId,
      contactId: contact.contactId,
      direction: 'INBOUND',
      channel: 'WHATSAPP',
      language: 'und',
      contentRef: `whatsapp:content:${event.eventId}`,
      contentSha256: contentSha256(event),
      providerMessageRef: event.providerMessageId,
      intent:
        preference !== 'NONE' ? `PRIVACY_${preference}` : humanHandoff ? 'HUMAN_HANDOFF' : null,
      urgency: humanHandoff ? 'HIGH' : null,
      occurredAt: event.occurredAt,
      executionId: `wa-message:${event.eventId}`,
      correlationId: event.eventId,
      actorPrincipalId: binding.actorPrincipalId,
      idempotencyKey: event.eventId,
      evidence,
      now: event.occurredAt,
    });

    await this.deps.transport.touchBinding({
      ...binding,
      conversationId: conversation.conversationId,
      direction: 'INBOUND',
      occurredAt: event.occurredAt,
      executionId: `wa-binding-touch:${event.eventId}`,
      correlationId: event.eventId,
      actorPrincipalId: binding.actorPrincipalId,
      idempotencyKey: `touch:${event.eventId}`,
      evidence,
      now: event.occurredAt,
    });

    for (const [index, attachment] of event.attachments.entries()) {
      const providerMetadata = await this.readMediaMetadata(attachment.providerMediaId);
      await this.deps.transport.recordMedia({
        ...binding,
        mediaRecordId: deterministicId(
          'media',
          event.providerMessageId,
          attachment.providerMediaId,
          String(index),
        ),
        messageId: message.messageId,
        direction: 'INBOUND',
        providerMediaId: attachment.providerMediaId,
        mimeType: providerMetadata?.mimeType ?? attachment.mimeType,
        fileName: attachment.fileName,
        sha256: providerMetadata?.sha256 ?? attachment.sha256,
        sizeBytes: providerMetadata?.fileSize ?? null,
        storageRef: null,
        executionId: `wa-media:${event.eventId}:${index}`,
        correlationId: event.eventId,
        actorPrincipalId: binding.actorPrincipalId,
        idempotencyKey: `media:${event.eventId}:${attachment.providerMediaId}`,
        evidence: [
          ...evidence,
          `meta:media:${attachment.providerMediaId}`,
          ...(providerMetadata ? [`meta:media-readback:${providerMetadata.id}`] : []),
        ],
        now: event.occurredAt,
      });
    }

    const subjectRef = await this.deps.privacySubjects.resolve(contact);
    if (!subjectRef.trim()) throw new Error('WHATSAPP_PRIVACY_SUBJECT_NOT_RESOLVED');
    const privacyEvidence = await this.deps.privacy.recordInboundPreference({
      binding,
      contact,
      subjectRef,
      command: preference,
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      evidence,
    });

    if (humanHandoff) {
      const reason =
        event.contentType === 'UNKNOWN' ? 'UNSUPPORTED_WHATSAPP_CONTENT' : 'CUSTOMER_REQUEST';
      await this.deps.transport.markHumanHandoff({
        ...binding,
        conversationId: conversation.conversationId,
        reason,
        executionId: `wa-handoff:${event.eventId}`,
        correlationId: event.eventId,
        actorPrincipalId: binding.actorPrincipalId,
        idempotencyKey: `handoff:${event.eventId}`,
        evidence,
        now: event.occurredAt,
      });
      await this.deps.sales.appendActivity({
        ...binding,
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
      humanHandoff,
      evidence: [...evidence, ...privacyEvidence],
    });
  }

  private async ingestStatus(
    binding: WhatsAppScopeBinding,
    event: WhatsAppDeliveryStatusEvent,
  ): Promise<void> {
    const existing = await this.deps.transport.getDispatchByProviderMessageRef({
      ...binding,
      providerMessageRef: event.providerMessageId,
    });
    if (!existing) {
      await this.deps.workflow.onUnmatchedStatus?.({ binding, event });
      return;
    }
    const evidence = [
      `whatsapp:webhook:${event.eventId}`,
      `meta:app:${binding.metaAppId}`,
      `meta:waba:${binding.wabaId}`,
      `meta:phone-number-id:${binding.phoneNumberId}`,
      `meta:wamid:${event.providerMessageId}`,
    ];
    await this.deps.transport.recordProviderEvent({
      ...binding,
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
      idempotencyKey: event.eventId,
      evidence,
      now: event.observedAt,
    });
  }

  private async resolveContact(
    binding: WhatsAppScopeBinding,
    event: WhatsAppInboundMessageEvent,
    evidence: readonly string[],
  ): Promise<ContactRecord> {
    const resolution = await this.deps.sales.resolveContact({
      tenantId: binding.tenantId,
      workspaceId: binding.workspaceId,
      organizationId: binding.organizationId,
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
        tenantId: binding.tenantId,
        workspaceId: binding.workspaceId,
        organizationId: binding.organizationId,
        contactId: resolution.canonicalContactId,
      });
      if (!contact || contact.status !== 'ACTIVE') throw new Error('WHATSAPP_CONTACT_NOT_ACTIVE');
      return contact;
    }

    const recipientSha256 = sha256(event.senderWaId);
    const contactId = deterministicId(
      'contact',
      binding.tenantId,
      binding.workspaceId,
      binding.organizationId,
      recipientSha256,
    );
    try {
      return await this.deps.crm.createContact({
        ...binding,
        contactId,
        contactType: 'PERSON',
        displayName: event.contactName ?? 'WhatsApp contact',
        channels: [
          {
            channelId: deterministicId('channel', contactId, 'whatsapp'),
            channelType: 'PHONE',
            provider: 'META_WHATSAPP_CLOUD',
            value: event.senderWaId,
            verifiedAt: event.occurredAt,
            primary: true,
          },
        ],
        attributes: { source: 'WHATSAPP_INBOUND' },
        executionId: `wa-contact:${event.eventId}`,
        correlationId: event.eventId,
        actorPrincipalId: binding.actorPrincipalId,
        idempotencyKey: `whatsapp-contact:${recipientSha256}`,
        evidence,
        now: event.occurredAt,
      });
    } catch (error) {
      const raced = await this.deps.sales.resolveContact({
        tenantId: binding.tenantId,
        workspaceId: binding.workspaceId,
        organizationId: binding.organizationId,
        channels: [
          {
            channelType: 'PHONE',
            provider: 'META_WHATSAPP_CLOUD',
            value: event.senderWaId,
          },
        ],
      });
      if (raced.state === 'AMBIGUOUS') throw new Error('WHATSAPP_CONTACT_AMBIGUOUS');
      if (raced.state === 'RESOLVED' && raced.canonicalContactId) {
        const contact = await this.deps.crm.getContact({
          tenantId: binding.tenantId,
          workspaceId: binding.workspaceId,
          organizationId: binding.organizationId,
          contactId: raced.canonicalContactId,
        });
        if (contact?.status === 'ACTIVE') return contact;
      }
      throw error;
    }
  }

  private async readMediaMetadata(mediaId: string): Promise<WhatsAppMediaMetadata | undefined> {
    if (!this.deps.media) return undefined;
    try {
      return await this.deps.media.readMediaMetadata(mediaId);
    } catch {
      return undefined;
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
}

export interface WhatsAppOutboundRuntimeOptions {
  readonly throttleLimit: number;
  readonly throttleWindowSeconds: number;
  readonly maxAttempts: number;
  readonly retryDelaySeconds: number;
}

export interface WhatsAppOutboundSendInput extends CrmScope {
  readonly message: MessageRecord;
  readonly preparedPayloadRef: string;
  readonly purposeId: string;
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
  readonly transport: WhatsAppRuntimeStore;
  readonly provider: WhatsAppProviderAdapter;
  readonly preparedPayloads: PreparedWhatsAppPayloadResolver;
  readonly privacyRevalidation: OutboundPrivacyRevalidationPort;
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
    this.assertOutboundInput(input);
    const prepared = await this.requirePrepared(input.preparedPayloadRef);
    const binding = await this.requireConversationBinding(input, now);
    await this.assertPreparedRecipientMatchesContact(input, prepared);
    enforceCustomerServiceWindow(prepared, binding, now);
    await this.validateTemplateIfNeeded(prepared);
    await this.consumeThrottle(input, now);

    const dispatch = await this.deps.transport.createDispatch({
      ...input,
      dispatchId: deterministicId('dispatch', input.idempotencyKey),
      messageId: input.message.messageId,
      conversationId: input.message.conversationId,
      contactId: input.message.contactId,
      preparedPayloadRef: input.preparedPayloadRef,
      purposeId: input.purposeId,
      executionId: input.executionId,
      correlationId: input.correlationId,
      actorPrincipalId: input.actorPrincipalId,
      idempotencyKey: input.idempotencyKey,
      evidence: input.evidence,
      now,
    });
    if (dispatch.state !== 'PREPARED') {
      if (dispatch.providerMessageRef)
        return this.deps.provider.readback(dispatch.providerMessageRef);
      if (dispatch.state === 'SUBMITTED') {
        await this.deps.transport.updateDispatch({
          ...input,
          dispatchId: dispatch.dispatchId,
          expectedState: 'SUBMITTED',
          state: 'DEAD_LETTER',
          attemptCount: dispatch.attemptCount,
          nextRetryAt: null,
          lastErrorCode: 'WHATSAPP_PROVIDER_OUTCOME_UNCERTAIN',
          idempotencyKey: `${input.idempotencyKey}:uncertain-replay`,
          evidence: input.evidence,
          now,
        });
        await this.deps.transport.markHumanHandoff({
          ...input,
          conversationId: dispatch.conversationId,
          reason: 'WHATSAPP_PROVIDER_OUTCOME_UNCERTAIN',
          executionId: input.executionId,
          correlationId: input.correlationId,
          actorPrincipalId: input.actorPrincipalId,
          idempotencyKey: `${input.idempotencyKey}:uncertain-handoff`,
          evidence: input.evidence,
          now,
        });
        throw new Error('WHATSAPP_PROVIDER_OUTCOME_UNCERTAIN');
      }
      return readbackFromDispatch(dispatch, now);
    }
    return this.performProviderSend(input, dispatch, prepared, now);
  }

  async retry(input: WhatsAppOutboundSendInput): Promise<ProviderMessageReadback> {
    const now = normalizeNow(input.now);
    this.assertOutboundInput(input);
    const dispatch = await this.deps.transport.getDispatchByIdempotencyKey({
      ...input,
      idempotencyKey: input.idempotencyKey,
    });
    if (!dispatch || dispatch.state !== 'FAILED_RETRYABLE') {
      throw new Error('WHATSAPP_RETRY_DISPATCH_NOT_ELIGIBLE');
    }
    if (dispatch.nextRetryAt && Date.parse(dispatch.nextRetryAt) > Date.parse(now)) {
      throw new Error('WHATSAPP_RETRY_NOT_DUE');
    }
    if (dispatch.attemptCount >= this.options.maxAttempts) {
      await this.deps.transport.updateDispatch({
        ...input,
        dispatchId: dispatch.dispatchId,
        expectedState: 'FAILED_RETRYABLE',
        state: 'DEAD_LETTER',
        attemptCount: dispatch.attemptCount,
        nextRetryAt: null,
        lastErrorCode: dispatch.lastErrorCode ?? 'WHATSAPP_RETRY_EXHAUSTED',
        idempotencyKey: `${input.idempotencyKey}:dead-letter`,
        evidence: input.evidence,
        now,
      });
      await this.deps.transport.markHumanHandoff({
        ...input,
        conversationId: dispatch.conversationId,
        reason: 'WHATSAPP_RETRY_EXHAUSTED',
        executionId: input.executionId,
        correlationId: input.correlationId,
        actorPrincipalId: input.actorPrincipalId,
        idempotencyKey: `${input.idempotencyKey}:handoff`,
        evidence: input.evidence,
        now,
      });
      throw new Error('WHATSAPP_RETRY_EXHAUSTED');
    }

    const prepared = await this.requirePrepared(input.preparedPayloadRef);
    const binding = await this.requireConversationBinding(input, now);
    await this.assertPreparedRecipientMatchesContact(input, prepared);
    enforceCustomerServiceWindow(prepared, binding, now);
    await this.validateTemplateIfNeeded(prepared);
    await this.consumeThrottle(input, now);
    const preparedDispatch = await this.deps.transport.updateDispatch({
      ...input,
      dispatchId: dispatch.dispatchId,
      expectedState: 'FAILED_RETRYABLE',
      state: 'PREPARED',
      attemptCount: dispatch.attemptCount,
      nextRetryAt: null,
      lastErrorCode: null,
      idempotencyKey: `${input.idempotencyKey}:retry-prepare:${dispatch.attemptCount + 1}`,
      evidence: input.evidence,
      now,
    });
    return this.performProviderSend(input, preparedDispatch, prepared, now);
  }

  private async performProviderSend(
    input: WhatsAppOutboundSendInput,
    dispatch: WhatsAppDispatchRecord,
    prepared: PreparedWhatsAppMessage,
    now: string,
  ): Promise<ProviderMessageReadback> {
    const attemptCount = dispatch.attemptCount + 1;
    try {
      await requireFreshOutboundPrivacy(this.deps.privacyRevalidation, {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        organizationId: input.organizationId,
        channel: 'WHATSAPP',
        privacyChannel: input.eligibility.privacy.decision.channel,
        subjectRef: input.eligibility.privacy.subjectRef,
        purposeId: input.purposeId,
        requester: input.actorPrincipalId,
        executionId: `${input.executionId}:privacy-pre-send:${attemptCount}`,
        correlationId: input.correlationId,
        evidence: [
          'whatsapp:privacy-pre-send',
          `whatsapp:message:${input.message.messageId}`,
          `whatsapp:privacy-proof:${input.eligibility.privacy.executionId}`,
        ],
      });
    } catch (error) {
      if (!isPrivacyRevalidationError(error)) throw error;
      await this.deps.transport.updateDispatch({
        ...input,
        dispatchId: dispatch.dispatchId,
        expectedState: 'PREPARED',
        state: 'FAILED',
        attemptCount: dispatch.attemptCount,
        nextRetryAt: null,
        lastErrorCode: 'WHATSAPP_PRIVACY_REVALIDATION_BLOCKED',
        idempotencyKey: `${input.idempotencyKey}:privacy-blocked:${attemptCount}`,
        evidence: [...input.evidence, 'whatsapp:privacy-pre-send:blocked'],
        now,
      });
      throw new Error('WHATSAPP_PRIVACY_REVALIDATION_BLOCKED');
    }

    const submitted = await this.deps.transport.updateDispatch({
      ...input,
      dispatchId: dispatch.dispatchId,
      expectedState: 'PREPARED',
      state: 'SUBMITTED',
      attemptCount,
      nextRetryAt: null,
      lastErrorCode: null,
      idempotencyKey: `${input.idempotencyKey}:submitted-before-provider:${attemptCount}`,
      evidence: input.evidence,
      now,
    });

    let receipt: Awaited<ReturnType<WhatsAppProviderAdapter['send']>>;
    try {
      receipt = await this.deps.provider.send({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        organizationId: input.organizationId,
        correlationId: input.correlationId,
        channel: 'WHATSAPP',
        contactRecordId: input.message.contactId,
        preparedPayloadRef: input.preparedPayloadRef,
        idempotencyKey: input.idempotencyKey,
        eligibility: input.eligibility,
      });
    } catch (error) {
      const failure = classifyProviderFailure(error, attemptCount, now, this.options);
      await this.deps.transport.updateDispatch({
        ...input,
        dispatchId: submitted.dispatchId,
        expectedState: 'SUBMITTED',
        state: failure.state,
        attemptCount,
        nextRetryAt: failure.nextRetryAt,
        lastErrorCode: failure.errorCode,
        idempotencyKey: `${input.idempotencyKey}:provider-failed:${attemptCount}`,
        evidence: input.evidence,
        now,
      });
      if (failure.state === 'DEAD_LETTER') {
        await this.deps.transport.markHumanHandoff({
          ...input,
          conversationId: dispatch.conversationId,
          reason: failure.errorCode,
          executionId: input.executionId,
          correlationId: input.correlationId,
          actorPrincipalId: input.actorPrincipalId,
          idempotencyKey: `${input.idempotencyKey}:handoff:${attemptCount}`,
          evidence: input.evidence,
          now,
        });
      }
      throw error;
    }

    if (receipt.state === 'REJECTED') {
      await this.deps.transport.updateDispatch({
        ...input,
        dispatchId: submitted.dispatchId,
        expectedState: 'SUBMITTED',
        state: 'FAILED',
        providerMessageRef: receipt.providerMessageId,
        attemptCount,
        nextRetryAt: null,
        lastErrorCode: 'WHATSAPP_PROVIDER_REJECTED',
        idempotencyKey: `${input.idempotencyKey}:rejected:${attemptCount}`,
        evidence: [...input.evidence, ...receipt.evidence],
        now,
      });
      throw new Error('WHATSAPP_PROVIDER_REJECTED');
    }

    let accepted: WhatsAppDispatchRecord;
    try {
      accepted = await this.deps.transport.updateDispatch({
        ...input,
        dispatchId: submitted.dispatchId,
        expectedState: 'SUBMITTED',
        state: 'SUBMITTED',
        providerMessageRef: receipt.providerMessageId,
        attemptCount,
        nextRetryAt: null,
        lastErrorCode: null,
        idempotencyKey: `${input.idempotencyKey}:provider-accepted:${attemptCount}`,
        evidence: [...input.evidence, ...receipt.evidence],
        now,
      });
    } catch (error) {
      try {
        await this.deps.transport.updateDispatch({
          ...input,
          dispatchId: submitted.dispatchId,
          expectedState: 'SUBMITTED',
          state: 'DEAD_LETTER',
          attemptCount,
          nextRetryAt: null,
          lastErrorCode: 'WHATSAPP_PROVIDER_OUTCOME_UNCERTAIN',
          idempotencyKey: `${input.idempotencyKey}:accepted-unpersisted:${attemptCount}`,
          evidence: input.evidence,
          now,
        });
        await this.deps.transport.markHumanHandoff({
          ...input,
          conversationId: dispatch.conversationId,
          reason: 'WHATSAPP_PROVIDER_OUTCOME_UNCERTAIN',
          executionId: input.executionId,
          correlationId: input.correlationId,
          actorPrincipalId: input.actorPrincipalId,
          idempotencyKey: `${input.idempotencyKey}:accepted-unpersisted-handoff:${attemptCount}`,
          evidence: input.evidence,
          now,
        });
      } catch {
        // Replay sees SUBMITTED without a provider ref and fails closed.
      }
      throw error;
    }

    await this.deps.transport.touchBinding({
      ...input,
      conversationId: input.message.conversationId,
      direction: 'OUTBOUND',
      occurredAt: receipt.acceptedAt,
      executionId: input.executionId,
      correlationId: input.correlationId,
      actorPrincipalId: input.actorPrincipalId,
      idempotencyKey: `${input.idempotencyKey}:binding-outbound:${attemptCount}`,
      evidence: [...input.evidence, ...receipt.evidence],
      now,
    });
    if (prepared.kind === 'MEDIA' && prepared.mediaId) {
      await this.deps.transport.recordMedia({
        ...input,
        mediaRecordId: deterministicId('media-outbound', accepted.messageId, prepared.mediaId),
        messageId: accepted.messageId,
        direction: 'OUTBOUND',
        providerMediaId: prepared.mediaId,
        fileName: prepared.fileName ?? null,
        executionId: input.executionId,
        correlationId: input.correlationId,
        actorPrincipalId: input.actorPrincipalId,
        idempotencyKey: `${input.idempotencyKey}:media:${prepared.mediaId}`,
        evidence: [...input.evidence, ...receipt.evidence],
        now,
      });
    }
    return this.deps.provider.readback(receipt.providerMessageId);
  }

  private assertOutboundInput(input: WhatsAppOutboundSendInput): void {
    assertOutboundEligibility(input.eligibility, { approvalRequired: true });
    assertProductionProviderBinding(this.deps.provider.binding);
    if (input.eligibility.channel !== 'WHATSAPP') throw new Error('WHATSAPP_CHANNEL_REQUIRED');
    if (input.eligibility.contact.contactRecordId !== input.message.contactId) {
      throw new Error('WHATSAPP_CONTACT_ELIGIBILITY_MISMATCH');
    }
    if (input.eligibility.privacy.decision.purposeId !== input.purposeId) {
      throw new Error('WHATSAPP_PURPOSE_ELIGIBILITY_MISMATCH');
    }
    assertMessageScope(input, input.message);
    if (input.message.channel !== 'WHATSAPP' || input.message.direction !== 'OUTBOUND') {
      throw new Error('WHATSAPP_CANONICAL_MESSAGE_INVALID');
    }
    if (input.message.providerMessageRef) {
      throw new Error('WHATSAPP_CANONICAL_MESSAGE_ALREADY_BOUND');
    }
  }

  private async requirePrepared(preparedPayloadRef: string): Promise<PreparedWhatsAppMessage> {
    const prepared = await this.deps.preparedPayloads.resolve(preparedPayloadRef);
    if (!prepared) throw new Error('WHATSAPP_PREPARED_PAYLOAD_NOT_FOUND');
    return prepared;
  }

  private async requireConversationBinding(
    input: WhatsAppOutboundSendInput,
    now: string,
  ): Promise<WhatsAppConversationBinding> {
    const contact = await this.deps.crm.getContact({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      organizationId: input.organizationId,
      contactId: input.message.contactId,
    });
    if (!contact || contact.status !== 'ACTIVE') throw new Error('WHATSAPP_CONTACT_NOT_ACTIVE');
    const binding = await this.deps.transport.getBindingByConversation({
      ...input,
      conversationId: input.message.conversationId,
    });
    if (!binding || binding.contactId !== contact.contactId) {
      throw new Error('WHATSAPP_CONVERSATION_BINDING_NOT_FOUND');
    }
    if (binding.humanHandoffAt) throw new Error('WHATSAPP_HUMAN_HANDOFF_ACTIVE');
    if (Date.parse(now) < Date.parse(binding.createdAt))
      throw new Error('WHATSAPP_NOW_BEFORE_BINDING');
    return binding;
  }

  private async assertPreparedRecipientMatchesContact(
    input: WhatsAppOutboundSendInput,
    prepared: PreparedWhatsAppMessage,
  ): Promise<void> {
    const channels = await this.deps.crm.listContactChannels({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      organizationId: input.organizationId,
      contactId: input.message.contactId,
    });
    assertPreparedRecipientMatchesContact(prepared, channels);
  }

  private async validateTemplateIfNeeded(prepared: PreparedWhatsAppMessage): Promise<void> {
    if (prepared.kind !== 'TEMPLATE') return;
    const result = await this.deps.provider.validateTemplate({
      templateKey: prepared.templateKey,
      locale: prepared.locale,
      variableNames: prepared.variables.map((variable) => variable.name),
    });
    if (!result.valid) throw new Error('WHATSAPP_TEMPLATE_NOT_APPROVED');
  }

  private async consumeThrottle(input: WhatsAppOutboundSendInput, now: string): Promise<void> {
    const throttle = await this.deps.transport.consumeThrottle({
      ...input,
      contactId: input.message.contactId,
      windowSeconds: this.options.throttleWindowSeconds,
      limit: this.options.throttleLimit,
      now,
    });
    if (!throttle.allowed) {
      throw new Error(`WHATSAPP_THROTTLED:${throttle.retryAfterSeconds}`);
    }
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
    return readbackFromDispatch(dispatch, this.now());
  }
}

function assertPreparedRecipientMatchesContact(
  prepared: PreparedWhatsAppMessage,
  channels: readonly ContactChannelRecord[],
): void {
  const recipient = normalizePhoneNumber(prepared.to);
  const matchesCanonicalChannel = channels.some((channel) => {
    if (
      channel.channelType !== 'PHONE' ||
      channel.provider !== 'META_WHATSAPP_CLOUD' ||
      channel.verifiedAt === null
    ) {
      return false;
    }
    const normalized = channel.value.replace(/\D/g, '');
    return /^\d{7,15}$/.test(normalized) && normalized === recipient;
  });
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

function isPrivacyRevalidationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith('OMNICHANNEL_PRIVACY_REVALIDATION_')
  );
}

function readbackFromDispatch(
  dispatch: WhatsAppDispatchRecord,
  observedAt: string,
): ProviderMessageReadback {
  const providerMessageId = dispatch.providerMessageRef ?? `unbound:${dispatch.dispatchId}`;
  return {
    provider: dispatch.provider,
    providerMessageId,
    state: toReadbackState(dispatch.state),
    observedAt: dispatch.updatedAt || observedAt,
    evidence: [
      `whatsapp:dispatch:${dispatch.dispatchId}`,
      `whatsapp:dispatch-state:${dispatch.state}`,
    ],
  };
}

function toReadbackState(state: WhatsAppDispatchRecord['state']): ProviderMessageReadback['state'] {
  if (state === 'SENT') return 'SENT';
  if (state === 'DELIVERED' || state === 'READ') return 'DELIVERED';
  if (state === 'FAILED' || state === 'FAILED_RETRYABLE' || state === 'DEAD_LETTER') {
    return 'FAILED';
  }
  if (state === 'SUBMITTED') return 'QUEUED';
  return 'UNKNOWN';
}

function canonicalConversationFromBinding(
  binding: WhatsAppConversationBinding,
  occurredAt: string,
): ConversationRecord {
  return {
    conversationId: binding.conversationId,
    tenantId: binding.tenantId,
    workspaceId: binding.workspaceId,
    organizationId: binding.organizationId,
    contactId: binding.contactId,
    leadId: null,
    channel: 'WHATSAPP',
    language: 'und',
    status: binding.humanHandoffAt ? 'HANDED_OFF' : 'OPEN',
    startedAt: binding.createdAt,
    lastMessageAt: occurredAt,
    closedAt: null,
    attributes: {
      meta_app_id: binding.metaAppId,
      waba_id: binding.wabaId,
      phone_number_id: binding.phoneNumberId,
    },
    version: 1,
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt,
  };
}

function contentSha256(event: WhatsAppInboundMessageEvent): string {
  return sha256(
    JSON.stringify({
      providerMessageId: event.providerMessageId,
      contentType: event.contentType,
      text: event.text,
      replyToProviderMessageId: event.replyToProviderMessageId,
      attachments: event.attachments,
      payload: event.payload,
    }),
  );
}

function assertProviderScope(
  binding: WhatsAppScopeBinding,
  wabaId: string,
  phoneNumberId: string,
): void {
  if (binding.wabaId !== wabaId || binding.phoneNumberId !== phoneNumberId) {
    throw new Error('WHATSAPP_PROVIDER_SCOPE_MISMATCH');
  }
}

function assertMessageScope(scope: CrmScope, message: MessageRecord): void {
  if (
    scope.tenantId !== message.tenantId ||
    scope.workspaceId !== message.workspaceId ||
    scope.organizationId !== message.organizationId
  ) {
    throw new Error('WHATSAPP_MESSAGE_SCOPE_MISMATCH');
  }
}

function normalizeNow(value: string | undefined): string {
  const now = value ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(now))) throw new Error('WHATSAPP_NOW_INVALID');
  return new Date(now).toISOString();
}

function deterministicId(...parts: readonly string[]): string {
  return `wa_${sha256(parts.join('|'))}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertPositiveInteger(value: number, errorCode: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(errorCode);
}
