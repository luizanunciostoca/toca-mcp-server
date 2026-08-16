import { randomUUID } from 'node:crypto';
import { hashApprovalDescriptor } from '../governance/approval-governance.js';
import type { AuditEvent } from '../core/audit.js';
import type {
  PrivacyCapabilityId,
  PrivacyDependencies,
  PrivacyExecutionContext,
  PrivacyLedgerEvent,
  PrivacyScope,
  PrivacySubjectRequestType,
  SubjectRequestSnapshot,
} from './contracts.js';
import {
  assertApprovalBinding,
  assertContext,
  assertIdempotentEquivalent,
  assertNoRawPii,
  isErrorCode,
  requireActorRef,
  requireEvidence,
  requireOpaqueSubjectRef,
  requireSafeText,
  requireText,
  scopeFromContext,
  snapshotFromEvents,
  unique,
  validateScope,
  type AppendInput,
} from './privacy-governance-helpers.js';

export class PrivacyGovernanceBase {
  protected readonly deps: PrivacyDependencies;

  constructor(deps: PrivacyDependencies) {
    this.deps = deps;
  }

  protected async requestForSensitiveOperation(
    context: PrivacyExecutionContext,
    requestId: string,
    allowedTypes: readonly PrivacySubjectRequestType[],
  ): Promise<SubjectRequestSnapshot> {
    assertContext(context);
    const events = await this.deps.store.listForRequest(
      scopeFromContext(context),
      requireText(requestId, 'PRIVACY_REQUEST_ID_REQUIRED'),
    );
    if (events.length === 0) throw new Error('PRIVACY_SUBJECT_REQUEST_NOT_FOUND');
    const request = snapshotFromEvents(events);
    if (!allowedTypes.includes(request.requestType))
      throw new Error('PRIVACY_SUBJECT_REQUEST_TYPE_MISMATCH');
    if (!request.identityVerificationRef) throw new Error('PRIVACY_SUBJECT_IDENTITY_NOT_VERIFIED');
    if (['REQUESTED', 'IDENTITY_VERIFICATION_REQUIRED'].includes(request.status))
      throw new Error('PRIVACY_SUBJECT_REQUEST_NOT_READY');
    if (['COMPLETED', 'DENIED', 'CANCELLED'].includes(request.status))
      throw new Error('PRIVACY_SUBJECT_REQUEST_CLOSED');
    return request;
  }

  protected async assertKnownPurpose(scope: PrivacyScope, purposeId: string): Promise<void> {
    const purpose = await this.deps.purposeRegistry.resolve(
      validateScope(scope),
      requireText(purposeId, 'PRIVACY_PURPOSE_REQUIRED'),
    );
    if (!purpose?.active) throw new Error('PRIVACY_PURPOSE_UNKNOWN_OR_INACTIVE');
  }

  protected async withApproval<T>(input: {
    readonly context: PrivacyExecutionContext;
    readonly approvalId: string;
    readonly capabilityId: 'privacy.data_export.prepare' | 'privacy.data_delete.execute';
    readonly descriptor: Readonly<Record<string, string>>;
    readonly requiredScope: readonly string[];
    readonly action: () => Promise<{
      readonly result: T;
      readonly readbackEvidence: readonly string[];
    }>;
  }): Promise<T> {
    assertContext(input.context);
    const approvalId = requireText(input.approvalId, 'PRIVACY_APPROVAL_REQUIRED');
    const approval = await this.deps.approvalStore.get(approvalId);
    if (!approval) throw new Error('PRIVACY_APPROVAL_NOT_FOUND');
    assertApprovalBinding(approval, input.context.tenantId, input.capabilityId);
    const expectation = {
      requester: input.context.requester,
      routeId: 'R16' as const,
      capabilityId: input.capabilityId,
      descriptorSha256: hashApprovalDescriptor(input.descriptor),
      targetAccount: input.context.tenantId,
      requiredScope: input.requiredScope,
    };

    await this.deps.approvalStore.transition(approvalId, {
      type: 'RESERVE',
      expectation,
      binding: {
        executionId: input.context.executionId,
        principalId: input.context.requester,
        correlationId: input.context.correlationId,
      },
    });
    try {
      await this.deps.approvalStore.transition(approvalId, {
        type: 'BEGIN_EXECUTION',
        executionId: input.context.executionId,
        evidence: input.context.evidence,
      });
      const outcome = await input.action();
      const readbackEvidence = requireEvidence(
        outcome.readbackEvidence,
        'PRIVACY_PROVIDER_READBACK_EVIDENCE_REQUIRED',
      );
      await this.deps.approvalStore.transition(approvalId, {
        type: 'PROVIDER_READBACK',
        executionId: input.context.executionId,
        evidence: readbackEvidence,
      });
      await this.deps.approvalStore.transition(approvalId, {
        type: 'CONSUME',
        executionId: input.context.executionId,
        evidence: readbackEvidence,
      });
      return outcome.result;
    } catch (error) {
      const current = await this.deps.approvalStore.get(approvalId);
      const failureEvidence = [
        `privacy:failure:${input.context.executionId}`,
        ...input.context.evidence,
      ];
      if (current?.status === 'RESERVED') {
        await this.deps.approvalStore.transition(approvalId, {
          type: 'RELEASE',
          executionId: input.context.executionId,
          evidence: failureEvidence,
          reason: 'PRIVACY_EXECUTION_FAILED_BEFORE_SIDE_EFFECT',
        });
      } else if (current && ['EXECUTING', 'PROVIDER_READBACK'].includes(current.status)) {
        await this.deps.approvalStore.transition(approvalId, {
          type: 'FAIL_REVIEW_REQUIRED',
          executionId: input.context.executionId,
          evidence: failureEvidence,
          reason: 'PRIVACY_SENSITIVE_OPERATION_REQUIRES_REVIEW',
        });
      }
      throw error;
    }
  }

  protected async append(input: AppendInput): Promise<PrivacyLedgerEvent> {
    const event = this.buildEvent(input);
    const scope = scopeFromContext(input.context);
    const existing = await this.deps.store.findByExecution(
      scope,
      input.context.executionId,
      input.capabilityId,
    );
    if (existing) {
      assertIdempotentEquivalent(existing, event);
      await this.auditLedgerEvent(input.context, input.capabilityId, input.approvalId, existing);
      return existing;
    }
    try {
      await this.deps.store.append(event);
    } catch (error) {
      if (!isErrorCode(error, 'PRIVACY_EVENT_DUPLICATE')) throw error;
      const raced = await this.deps.store.findByExecution(
        scope,
        input.context.executionId,
        input.capabilityId,
      );
      if (!raced) throw error;
      assertIdempotentEquivalent(raced, event);
      await this.auditLedgerEvent(input.context, input.capabilityId, input.approvalId, raced);
      return raced;
    }
    await this.auditLedgerEvent(input.context, input.capabilityId, input.approvalId, event);
    return event;
  }

  protected async appendConsentTransition(
    input: AppendInput,
    expectedHeadEventId: string | null,
  ): Promise<PrivacyLedgerEvent> {
    const event = this.buildEvent(input);
    const scope = scopeFromContext(input.context);
    const existing = await this.deps.store.findByExecution(
      scope,
      input.context.executionId,
      input.capabilityId,
    );
    if (existing) {
      assertIdempotentEquivalent(existing, event);
      await this.auditLedgerEvent(input.context, input.capabilityId, input.approvalId, existing);
      return existing;
    }
    try {
      await this.deps.store.appendConsentTransition(event, expectedHeadEventId);
    } catch (error) {
      if (!isErrorCode(error, 'PRIVACY_EVENT_DUPLICATE')) throw error;
      const raced = await this.deps.store.findByExecution(
        scope,
        input.context.executionId,
        input.capabilityId,
      );
      if (!raced) throw error;
      assertIdempotentEquivalent(raced, event);
      await this.auditLedgerEvent(input.context, input.capabilityId, input.approvalId, raced);
      return raced;
    }
    await this.auditLedgerEvent(input.context, input.capabilityId, input.approvalId, event);
    return event;
  }

  protected buildEvent(input: AppendInput): PrivacyLedgerEvent {
    assertContext(input.context);
    const event: PrivacyLedgerEvent = {
      eventId: randomUUID(),
      ...scopeFromContext(input.context),
      subjectRef: requireOpaqueSubjectRef(input.subjectRef),
      requestId: input.requestId,
      purposeId: input.purposeId
        ? requireSafeText(input.purposeId, 'PRIVACY_PURPOSE_REQUIRED')
        : null,
      channel: input.channel ? requireSafeText(input.channel, 'PRIVACY_CHANNEL_REQUIRED') : null,
      policyRef: input.policyRef
        ? requireSafeText(input.policyRef, 'PRIVACY_POLICY_REF_REQUIRED')
        : null,
      approvalId: input.approvalId,
      capabilityId: input.capabilityId,
      eventType: input.eventType,
      requester: requireActorRef(input.context.requester),
      executionId: requireSafeText(input.context.executionId, 'PRIVACY_EXECUTION_ID_REQUIRED'),
      correlationId: requireSafeText(
        input.context.correlationId,
        'PRIVACY_CORRELATION_ID_REQUIRED',
      ),
      occurredAt: new Date().toISOString(),
      evidence: unique([
        ...requireEvidence(input.context.evidence, 'PRIVACY_EXECUTION_EVIDENCE_REQUIRED'),
        ...input.extraEvidence,
      ]),
      payload: input.payload,
    };
    assertNoRawPii(event.evidence, 'PRIVACY_RAW_PII_EVIDENCE_REJECTED');
    assertNoRawPii(event.payload, 'PRIVACY_RAW_PII_PAYLOAD_REJECTED');
    return event;
  }

  protected async auditLedgerEvent(
    context: PrivacyExecutionContext,
    capabilityId: PrivacyCapabilityId,
    approvalId: string | null,
    event: PrivacyLedgerEvent,
  ): Promise<void> {
    await this.audit(context, capabilityId, 'SUCCEEDED', approvalId, [
      ...event.evidence,
      `privacy-ledger:${event.eventId}`,
    ]);
  }

  protected async audit(
    context: PrivacyExecutionContext,
    capabilityId: PrivacyCapabilityId,
    status: AuditEvent['status'],
    approvalId: string | null,
    evidence: readonly string[],
  ): Promise<void> {
    const event: AuditEvent = {
      executionId: context.executionId,
      correlationId: context.correlationId,
      toolName: capabilityId,
      requester: context.requester,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      organizationId: context.organizationId,
      status,
      ...(approvalId ? { approvalId } : {}),
      evidence: requireEvidence(evidence, 'PRIVACY_AUDIT_EVIDENCE_REQUIRED'),
      createdAt: new Date().toISOString(),
    };
    assertNoRawPii(event.evidence ?? [], 'PRIVACY_RAW_PII_AUDIT_REJECTED');
    await this.deps.auditSink.write(event);
  }
}
