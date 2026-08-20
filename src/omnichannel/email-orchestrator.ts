import { createHash } from 'node:crypto';
import type { CrmScope } from '../crm/crm-records.js';
import type { MessageRecord } from '../crm/sales-engine.js';
import type {
  ApprovalDecisionProof,
  AudienceEligibilitySnapshot,
  EmailProviderAdapter,
  ProviderMessageReadback,
} from './contracts.js';
import {
  DEFAULT_EMAIL_RETRY_POLICY,
  assertCanonicalEmailMessage,
  computeEmailRetryDelayMs,
  deterministicEmailId,
  normalizeInternetMessageId,
  resolveEmailTrackingSettings,
  type EmailDeliveryState,
  type EmailDispatchRecord,
  type EmailPrivacyReconciliationPort,
  type EmailProviderEventRecord,
  type EmailRateLimitPolicy,
  type EmailRetryPolicy,
  type EmailRuntimeStore,
  type EmailThreadBinding,
} from './email-runtime.js';

export interface EmailDispatchOrchestrationStore extends EmailRuntimeStore {
  saveDispatch(record: EmailDispatchRecord): Promise<void>;
  findDispatchByProviderMessageRef(
    scope: CrmScope,
    provider: string,
    providerMessageRef: string,
  ): Promise<EmailDispatchRecord | undefined>;
}

export interface EmailProviderEventContextPort {
  resolvePrivacyContext(
    input: CrmScope & {
      readonly messageId: MessageRecord['messageId'];
      readonly provider: string;
      readonly providerMessageRef: string;
    },
  ): Promise<{
    readonly subjectRef: string;
    /** Privacy-safe opaque provider subject reference, never a raw email address. */
    readonly providerSubjectRef: string;
  }>;
}

export interface EmailEngagementAuthorizationPort {
  authorize(
    input: CrmScope & {
      readonly messageId: MessageRecord['messageId'];
      readonly eventType: 'open' | 'click';
    },
  ): Promise<{
    readonly privacyAllowed: boolean;
    readonly policyAllowed: boolean;
    readonly evidence: readonly string[];
  }>;
}

export interface EmailSendInput extends CrmScope {
  readonly correlationId: string;
  readonly message: MessageRecord;
  readonly preparedCampaignRef: string;
  readonly eligibilitySnapshot: AudienceEligibilitySnapshot;
  readonly approval: ApprovalDecisionProof;
  readonly idempotencyKey: string;
  readonly internetMessageId: string;
  readonly inReplyTo?: string | null;
  readonly references?: readonly string[];
  readonly rateLimitBucketKey: string;
  readonly rateLimitPolicy: EmailRateLimitPolicy;
  readonly retryPolicy?: EmailRetryPolicy;
  readonly now: string;
}

export interface EmailSendResult {
  readonly dispatch: EmailDispatchRecord;
  readonly reused: boolean;
  readonly accepted: boolean;
}

export interface NormalizedEmailProviderEvent {
  readonly providerEventId: string;
  readonly providerMessageRef: string;
  readonly eventType: string;
  readonly deliveryState: EmailDeliveryState | null;
  readonly privacySignal: 'BOUNCED' | 'COMPLAINT' | 'UNSUBSCRIBED' | null;
  readonly occurredAt: string;
}

export interface EmailProviderEventProcessInput extends CrmScope {
  readonly provider: string;
  readonly event: NormalizedEmailProviderEvent;
  /** SHA-256 of the exact raw signed webhook payload bytes. */
  readonly rawPayloadSha256: string;
  readonly signatureEvidence: readonly string[];
  readonly executionId: string;
  readonly correlationId: string;
}

export interface EmailProviderEventProcessResult {
  readonly duplicate: boolean;
  readonly ignored: boolean;
  readonly reason: string | null;
  readonly messageId: string | null;
  readonly privacyReconciled: boolean;
}

export class EmailDispatchCoordinator {
  constructor(
    private readonly provider: EmailProviderAdapter,
    private readonly store: EmailDispatchOrchestrationStore,
  ) {}

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    validateScope(input);
    validateMessageScope(input, input.message);
    assertCanonicalEmailMessage(input.message);
    const idempotencyKey = requireText(input.idempotencyKey, 'EMAIL_IDEMPOTENCY_KEY_REQUIRED');
    const internetMessageId = normalizeInternetMessageId(input.internetMessageId);
    const nowMs = timestampMs(input.now, 'EMAIL_SEND_NOW_INVALID');
    const retryPolicy = input.retryPolicy ?? DEFAULT_EMAIL_RETRY_POLICY;

    const existing = await this.store.findDispatchByIdempotencyKey(input, idempotencyKey);
    if (existing) {
      if (existing.messageId !== input.message.messageId) {
        throw new Error('EMAIL_IDEMPOTENCY_MESSAGE_CONFLICT');
      }
      if (existing.state === 'DEFERRED') {
        if (!existing.nextRetryAt) throw new Error('EMAIL_DEFERRED_RETRY_AT_REQUIRED');
        if (timestampMs(existing.nextRetryAt, 'EMAIL_RETRY_AT_INVALID') > nowMs) {
          return { dispatch: existing, reused: true, accepted: false };
        }
      } else {
        return {
          dispatch: existing,
          reused: true,
          accepted: isAcceptedDispatchState(existing.state),
        };
      }
    }

    const rateLimit = await this.store.consumeRateLimit(
      input,
      requireText(input.rateLimitBucketKey, 'EMAIL_RATE_LIMIT_BUCKET_REQUIRED'),
      input.rateLimitPolicy,
      input.now,
    );
    if (!rateLimit.allowed) {
      if (!rateLimit.retryAt) throw new Error('EMAIL_RATE_LIMIT_RETRY_AT_REQUIRED');
      const deferred = buildDispatch({
        input,
        provider: this.provider.binding.providerKey,
        existing,
        state: 'DEFERRED',
        providerMessageRef: existing?.providerMessageRef ?? null,
        attemptCount: existing?.attemptCount ?? 0,
        nextRetryAt: rateLimit.retryAt,
        lastError: 'EMAIL_RATE_LIMITED',
      });
      await this.store.saveDispatch(deferred);
      return { dispatch: deferred, reused: false, accepted: false };
    }

    const attemptCount = (existing?.attemptCount ?? 0) + 1;
    const prepared = buildDispatch({
      input,
      provider: this.provider.binding.providerKey,
      existing,
      state: 'SUBMITTED',
      providerMessageRef: existing?.providerMessageRef ?? null,
      attemptCount,
      nextRetryAt: null,
      lastError: null,
    });
    await this.store.saveDispatch(prepared);

    try {
      const receipt = await this.provider.sendCampaign({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        organizationId: input.organizationId,
        correlationId: input.correlationId,
        preparedCampaignRef: input.preparedCampaignRef,
        eligibilitySnapshot: input.eligibilitySnapshot,
        approval: input.approval,
        idempotencyKey,
      });
      const accepted = buildDispatch({
        input,
        provider: receipt.provider,
        existing: prepared,
        state: receipt.state === 'REJECTED' ? 'FAILED' : 'ACCEPTED',
        providerMessageRef: receipt.providerMessageId,
        attemptCount,
        nextRetryAt: null,
        lastError: receipt.state === 'REJECTED' ? 'EMAIL_PROVIDER_REJECTED' : null,
      });
      await this.store.saveDispatch(accepted);
      if (receipt.state !== 'REJECTED') {
        await this.store.persistThreadBinding(
          buildOutboundThreadBinding(
            input,
            receipt.provider,
            receipt.providerMessageId,
            internetMessageId,
          ),
        );
      }
      return {
        dispatch: accepted,
        reused: false,
        accepted: receipt.state !== 'REJECTED',
      };
    } catch (error) {
      const retryable = isRetryableProviderSendError(error);
      let state: EmailDeliveryState = 'FAILED';
      let nextRetryAt: string | null = null;
      if (retryable && attemptCount < retryPolicy.maximumAttempts) {
        const delayMs = computeEmailRetryDelayMs(attemptCount, null, retryPolicy);
        state = 'DEFERRED';
        nextRetryAt = new Date(nowMs + delayMs).toISOString();
      }
      const failed = buildDispatch({
        input,
        provider: this.provider.binding.providerKey,
        existing: prepared,
        state,
        providerMessageRef: prepared.providerMessageRef,
        attemptCount,
        nextRetryAt,
        lastError: safeErrorCode(error),
      });
      await this.store.saveDispatch(failed);
      if (state === 'DEFERRED') return { dispatch: failed, reused: false, accepted: false };
      throw error;
    }
  }

  async readback(
    input: CrmScope & {
      readonly providerMessageRef: string;
      readonly now: string;
    },
  ): Promise<{
    readonly dispatch: EmailDispatchRecord;
    readonly readback: ProviderMessageReadback;
  }> {
    validateScope(input);
    const providerMessageRef = requireText(
      input.providerMessageRef,
      'EMAIL_PROVIDER_MESSAGE_REF_REQUIRED',
    );
    const dispatch = await this.store.findDispatchByProviderMessageRef(
      input,
      this.provider.binding.providerKey,
      providerMessageRef,
    );
    if (!dispatch) throw new Error('EMAIL_DISPATCH_NOT_FOUND');
    const readback = await this.provider.readback(providerMessageRef);
    const updated: EmailDispatchRecord = {
      ...dispatch,
      state: mapReadbackState(readback.state),
      lastError:
        readback.state === 'FAILED' || readback.state === 'REJECTED'
          ? 'EMAIL_READBACK_FAILED'
          : null,
      nextRetryAt: null,
      updatedAt: input.now,
    };
    await this.store.saveDispatch(updated);
    return { dispatch: updated, readback };
  }
}

export class EmailProviderEventProcessor {
  constructor(
    private readonly store: EmailDispatchOrchestrationStore,
    private readonly privacy: EmailPrivacyReconciliationPort,
    private readonly context: EmailProviderEventContextPort,
    private readonly engagementAuthorization: EmailEngagementAuthorizationPort,
  ) {}

  async process(input: EmailProviderEventProcessInput): Promise<EmailProviderEventProcessResult> {
    validateScope(input);
    assertSha256(input.rawPayloadSha256, 'EMAIL_WEBHOOK_PAYLOAD_SHA256_INVALID');
    if (input.signatureEvidence.length === 0)
      throw new Error('EMAIL_WEBHOOK_SIGNATURE_EVIDENCE_REQUIRED');
    const event = input.event;
    const providerEventId = requireText(event.providerEventId, 'EMAIL_PROVIDER_EVENT_ID_REQUIRED');
    const providerMessageRef = requireText(
      event.providerMessageRef,
      'EMAIL_PROVIDER_MESSAGE_REF_REQUIRED',
    );
    if (await this.store.hasProviderEvent(input, providerEventId)) {
      return {
        duplicate: true,
        ignored: false,
        reason: null,
        messageId: null,
        privacyReconciled: false,
      };
    }

    const dispatch = await this.store.findDispatchByProviderMessageRef(
      input,
      input.provider,
      providerMessageRef,
    );
    const eventType = event.eventType.trim().toLowerCase();
    if (eventType === 'open' || eventType === 'click') {
      if (!dispatch) {
        return {
          duplicate: false,
          ignored: true,
          reason: 'EMAIL_ENGAGEMENT_MESSAGE_NOT_RESOLVED',
          messageId: null,
          privacyReconciled: false,
        };
      }
      const authorization = await this.engagementAuthorization.authorize({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        organizationId: input.organizationId,
        messageId: dispatch.messageId,
        eventType,
      });
      const tracking = resolveEmailTrackingSettings({
        privacyAllowed: authorization.privacyAllowed,
        policyAllowed: authorization.policyAllowed,
        openTrackingRequested: eventType === 'open',
        clickTrackingRequested: eventType === 'click',
      });
      const allowed = eventType === 'open' ? tracking.openTracking : tracking.clickTracking;
      if (!allowed) {
        return {
          duplicate: false,
          ignored: true,
          reason: tracking.blockedReasons.join(',') || 'EMAIL_ENGAGEMENT_NOT_AUTHORIZED',
          messageId: dispatch.messageId,
          privacyReconciled: false,
        };
      }
    }

    const providerEvent: EmailProviderEventRecord = {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      organizationId: input.organizationId,
      eventId: deterministicEmailId('event', input.provider, providerEventId),
      providerEventId,
      provider: input.provider,
      providerMessageRef,
      messageId: dispatch?.messageId ?? null,
      eventType,
      deliveryState: event.deliveryState,
      occurredAt: event.occurredAt,
      payloadSha256: input.rawPayloadSha256,
      evidence: input.signatureEvidence,
    };
    await this.store.appendProviderEvent(providerEvent);

    if (dispatch && event.deliveryState) {
      await this.store.saveDispatch({
        ...dispatch,
        state: event.deliveryState,
        nextRetryAt: null,
        lastError: providerEventFailureCode(event.deliveryState),
        updatedAt: event.occurredAt,
      });
    }

    let privacyReconciled = false;
    if (dispatch && event.privacySignal) {
      const privacyContext = await this.context.resolvePrivacyContext({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        organizationId: input.organizationId,
        messageId: dispatch.messageId,
        provider: input.provider,
        providerMessageRef,
      });
      await this.privacy.reconcileProviderSignal({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        organizationId: input.organizationId,
        capabilityId: 'privacy.provider_consent.reconcile',
        subjectRef: requireText(privacyContext.subjectRef, 'EMAIL_PRIVACY_SUBJECT_REF_REQUIRED'),
        provider: input.provider,
        providerSubjectRef: requireOpaqueProviderSubjectRef(privacyContext.providerSubjectRef),
        providerState: event.privacySignal,
        observedAt: event.occurredAt,
        providerEvidenceRef: providerEvent.eventId,
        executionId: input.executionId,
        correlationId: input.correlationId,
      });
      privacyReconciled = true;
    }

    return {
      duplicate: false,
      ignored: false,
      reason: null,
      messageId: dispatch?.messageId ?? null,
      privacyReconciled,
    };
  }
}

function buildDispatch(input: {
  readonly input: EmailSendInput;
  readonly provider: string;
  readonly existing: EmailDispatchRecord | undefined;
  readonly state: EmailDeliveryState;
  readonly providerMessageRef: string | null;
  readonly attemptCount: number;
  readonly nextRetryAt: string | null;
  readonly lastError: string | null;
}): EmailDispatchRecord {
  return {
    tenantId: input.input.tenantId,
    workspaceId: input.input.workspaceId,
    organizationId: input.input.organizationId,
    dispatchId:
      input.existing?.dispatchId ??
      deterministicEmailId(
        'dispatch',
        input.input.tenantId,
        input.input.workspaceId,
        input.input.organizationId,
        input.input.idempotencyKey,
      ),
    messageId: input.input.message.messageId,
    idempotencyKey: input.input.idempotencyKey,
    provider: input.provider,
    providerMessageRef: input.providerMessageRef,
    state: input.state,
    attemptCount: input.attemptCount,
    nextRetryAt: input.nextRetryAt,
    lastError: input.lastError,
    createdAt: input.existing?.createdAt ?? input.input.now,
    updatedAt: input.input.now,
  };
}

function buildOutboundThreadBinding(
  input: EmailSendInput,
  provider: string,
  providerMessageRef: string,
  internetMessageId: string,
): EmailThreadBinding {
  return {
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    organizationId: input.organizationId,
    bindingId: deterministicEmailId('thread', provider, internetMessageId),
    conversationId: input.message.conversationId,
    contactId: input.message.contactId,
    provider,
    providerMessageRef,
    internetMessageId,
    inReplyTo: input.inReplyTo ? normalizeInternetMessageId(input.inReplyTo) : null,
    references: (input.references ?? []).map(normalizeInternetMessageId),
    createdAt: input.now,
  };
}

function mapReadbackState(state: ProviderMessageReadback['state']): EmailDeliveryState {
  switch (state) {
    case 'QUEUED':
      return 'ACCEPTED';
    case 'SENT':
      return 'PROCESSED';
    case 'DELIVERED':
      return 'DELIVERED';
    case 'FAILED':
    case 'REJECTED':
      return 'FAILED';
    case 'UNKNOWN':
      return 'UNKNOWN';
  }
}

function providerEventFailureCode(state: EmailDeliveryState): string | null {
  switch (state) {
    case 'BOUNCED':
      return 'EMAIL_BOUNCED';
    case 'COMPLAINT':
      return 'EMAIL_COMPLAINT';
    case 'UNSUBSCRIBED':
      return 'EMAIL_UNSUBSCRIBED';
    case 'DROPPED':
      return 'EMAIL_DROPPED';
    case 'FAILED':
      return 'EMAIL_FAILED';
    default:
      return null;
  }
}

function isAcceptedDispatchState(state: EmailDeliveryState): boolean {
  return ['ACCEPTED', 'PROCESSED', 'DELIVERED'].includes(state);
}

function isRetryableProviderSendError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    /SENDGRID_MAIL_SEND_FAILED:(429|5\d\d):/.test(error.message) ||
    /ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT/.test(error.message)
  );
}

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'EMAIL_PROVIDER_ERROR_UNKNOWN';
  const normalized = error.message.replace(/[^A-Za-z0-9:_-]/g, '_').slice(0, 240);
  return normalized || 'EMAIL_PROVIDER_ERROR_UNKNOWN';
}

function requireOpaqueProviderSubjectRef(value: string): string {
  const normalized = requireText(value, 'EMAIL_PROVIDER_SUBJECT_REF_REQUIRED');
  if (normalized.includes('@')) throw new Error('EMAIL_PROVIDER_SUBJECT_REF_RAW_PII_FORBIDDEN');
  return normalized;
}

export function hashEmailProviderSubject(emailAddress: string): string {
  const normalized = emailAddress.trim().toLowerCase();
  if (!normalized.includes('@')) throw new Error('EMAIL_PROVIDER_SUBJECT_EMAIL_INVALID');
  return `sha256:${createHash('sha256').update(normalized).digest('hex')}`;
}

function validateMessageScope(scope: CrmScope, message: MessageRecord): void {
  if (
    message.tenantId !== scope.tenantId ||
    message.workspaceId !== scope.workspaceId ||
    message.organizationId !== scope.organizationId
  ) {
    throw new Error('EMAIL_MESSAGE_SCOPE_MISMATCH');
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

function timestampMs(value: string, code: string): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(code);
  return ms;
}

function requireText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}
