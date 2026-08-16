import { randomUUID } from 'node:crypto';
import type {
  PrivacyExecutionContext,
  PrivacyLedgerEvent,
  PrivacySubjectRequestStatus,
  PrivacySubjectRequestType,
  RetentionAction,
  SubjectRequestSnapshot,
} from './contracts.js';
import { PrivacyGovernanceCore } from './privacy-governance-core.js';
import {
  assertContext,
  isRequestType,
  privacyApprovalDescriptor,
  privacyApprovalScope,
  requireEvidence,
  requireOpaqueSubjectRef,
  requireSafeText,
  requireText,
  scopeFromContext,
  snapshotFromEvents,
  unique,
} from './privacy-governance-helpers.js';

const RETENTION_ACTIONS: readonly RetentionAction[] = ['HOLD', 'REVIEW', 'DELETE', 'ANONYMIZE'];

export class PrivacyGovernanceRights extends PrivacyGovernanceCore {
  async applyRetention(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly purposeId: string;
    readonly action: RetentionAction;
    readonly subjectBindingRef: string;
    readonly policyRef: string;
    readonly reason: string;
    readonly sourceEvidence: readonly string[];
  }): Promise<{
    readonly event: PrivacyLedgerEvent;
    readonly destructiveExecutionRequired: boolean;
  }> {
    assertContext(input.context);
    await this.assertKnownPurpose(scopeFromContext(input.context), input.purposeId);
    if (!RETENTION_ACTIONS.includes(input.action))
      throw new Error('PRIVACY_RETENTION_ACTION_INVALID');
    const event = await this.append({
      context: input.context,
      subjectRef: input.subjectRef,
      requestId: null,
      purposeId: input.purposeId,
      channel: null,
      policyRef: requireSafeText(input.policyRef, 'PRIVACY_RETENTION_POLICY_REQUIRED'),
      approvalId: null,
      capabilityId: 'privacy.retention.apply',
      eventType: 'RETENTION_APPLIED',
      payload: {
        action: input.action,
        subjectBindingRef: requireSafeText(
          input.subjectBindingRef,
          'PRIVACY_RETENTION_SUBJECT_BINDING_REQUIRED',
        ),
        reason: requireSafeText(input.reason, 'PRIVACY_RETENTION_REASON_REQUIRED'),
      },
      extraEvidence: requireEvidence(input.sourceEvidence, 'PRIVACY_RETENTION_EVIDENCE_REQUIRED'),
    });
    return {
      event,
      destructiveExecutionRequired: input.action === 'DELETE' || input.action === 'ANONYMIZE',
    };
  }

  async createSubjectRequest(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly requestType: PrivacySubjectRequestType;
    readonly policyRef: string;
    readonly identityVerificationRef: string | null;
    readonly sourceEvidence: readonly string[];
  }): Promise<SubjectRequestSnapshot> {
    assertContext(input.context);
    if (!isRequestType(input.requestType)) throw new Error('PRIVACY_SUBJECT_REQUEST_TYPE_INVALID');
    const scope = scopeFromContext(input.context);
    const existing = await this.deps.store.findByExecution(
      scope,
      input.context.executionId,
      'privacy.subject_request.create',
    );
    const identityVerificationRef =
      input.identityVerificationRef === null
        ? null
        : requireSafeText(
            input.identityVerificationRef,
            'PRIVACY_IDENTITY_VERIFICATION_REF_REQUIRED',
          );
    if (existing) {
      const expectedPayload = {
        requestType: input.requestType,
        status: identityVerificationRef ? 'IN_REVIEW' : 'IDENTITY_VERIFICATION_REQUIRED',
        identityVerificationRef,
      };
      if (
        existing.subjectRef !== requireOpaqueSubjectRef(input.subjectRef) ||
        existing.policyRef !==
          requireSafeText(input.policyRef, 'PRIVACY_SUBJECT_REQUEST_POLICY_REQUIRED') ||
        JSON.stringify(existing.payload) !== JSON.stringify(expectedPayload)
      )
        throw new Error('PRIVACY_IDEMPOTENCY_CONFLICT');
      await this.auditLedgerEvent(
        input.context,
        'privacy.subject_request.create',
        existing.approvalId,
        existing,
      );
      return snapshotFromEvents([existing]);
    }

    const requestId = randomUUID();
    const status: PrivacySubjectRequestStatus = identityVerificationRef
      ? 'IN_REVIEW'
      : 'IDENTITY_VERIFICATION_REQUIRED';
    const event = await this.append({
      context: input.context,
      subjectRef: input.subjectRef,
      requestId,
      purposeId: null,
      channel: null,
      policyRef: requireSafeText(input.policyRef, 'PRIVACY_SUBJECT_REQUEST_POLICY_REQUIRED'),
      approvalId: null,
      capabilityId: 'privacy.subject_request.create',
      eventType: 'SUBJECT_REQUEST_CREATED',
      payload: {
        requestType: input.requestType,
        status,
        identityVerificationRef,
      },
      extraEvidence: requireEvidence(
        input.sourceEvidence,
        'PRIVACY_SUBJECT_REQUEST_EVIDENCE_REQUIRED',
      ),
    });
    return snapshotFromEvents([event]);
  }

  async getSubjectRequestStatus(input: {
    readonly context: PrivacyExecutionContext;
    readonly requestId: string;
  }): Promise<SubjectRequestSnapshot> {
    assertContext(input.context);
    const events = await this.deps.store.listForRequest(
      scopeFromContext(input.context),
      requireText(input.requestId, 'PRIVACY_REQUEST_ID_REQUIRED'),
    );
    if (events.length === 0) throw new Error('PRIVACY_SUBJECT_REQUEST_NOT_FOUND');
    const snapshot = snapshotFromEvents(events);
    await this.audit(input.context, 'privacy.subject_request.status', 'SUCCEEDED', null, [
      `privacy-request:${snapshot.requestId}`,
    ]);
    return snapshot;
  }

  async prepareDataExport(input: {
    readonly context: PrivacyExecutionContext;
    readonly requestId: string;
    readonly policyRef: string;
    readonly approvalId: string;
  }): Promise<{ readonly artifactRef: string; readonly evidence: readonly string[] }> {
    assertContext(input.context);
    const replay = await this.deps.store.findByExecution(
      scopeFromContext(input.context),
      input.context.executionId,
      'privacy.data_export.prepare',
    );
    if (replay) {
      if (
        replay.requestId !== input.requestId ||
        replay.policyRef !== requireSafeText(input.policyRef, 'PRIVACY_EXPORT_POLICY_REQUIRED') ||
        typeof replay.payload.artifactRef !== 'string'
      )
        throw new Error('PRIVACY_IDEMPOTENCY_CONFLICT');
      await this.auditLedgerEvent(
        input.context,
        'privacy.data_export.prepare',
        replay.approvalId,
        replay,
      );
      return { artifactRef: replay.payload.artifactRef, evidence: replay.evidence };
    }

    const request = await this.requestForSensitiveOperation(input.context, input.requestId, [
      'ACCESS',
      'CONFIRMATION',
      'PORTABILITY',
      'INFORMATION',
    ]);
    const policyRef = requireSafeText(input.policyRef, 'PRIVACY_EXPORT_POLICY_REQUIRED');
    const descriptor = privacyApprovalDescriptor({
      capabilityId: 'privacy.data_export.prepare',
      ...scopeFromContext(input.context),
      subjectRef: request.subjectRef,
      requestId: request.requestId,
      requestType: request.requestType,
      identityVerificationRef: requireSafeText(
        request.identityVerificationRef ?? '',
        'PRIVACY_SUBJECT_IDENTITY_NOT_VERIFIED',
      ),
      policyRef,
      operationParameters: '{}',
    });
    return this.withApproval({
      context: input.context,
      approvalId: input.approvalId,
      capabilityId: 'privacy.data_export.prepare',
      descriptor,
      requiredScope: [privacyApprovalScope(input.context, request.subjectRef, 'export')],
      action: async () => {
        const result = await this.deps.dataGateway.prepareExport({
          ...scopeFromContext(input.context),
          subjectRef: request.subjectRef,
          requestId: request.requestId,
          policyRef,
          executionId: input.context.executionId,
        });
        const evidence = requireEvidence(
          result.evidence,
          'PRIVACY_EXPORT_READBACK_EVIDENCE_REQUIRED',
        );
        const artifactRef = requireSafeText(result.artifactRef, 'PRIVACY_EXPORT_ARTIFACT_REQUIRED');
        await this.append({
          context: input.context,
          subjectRef: request.subjectRef,
          requestId: request.requestId,
          purposeId: null,
          channel: null,
          policyRef,
          approvalId: input.approvalId,
          capabilityId: 'privacy.data_export.prepare',
          eventType: 'DATA_EXPORT_PREPARED',
          payload: { artifactRef },
          extraEvidence: evidence,
        });
        return { result: { artifactRef, evidence }, readbackEvidence: evidence };
      },
    });
  }

  async executeDataDelete(input: {
    readonly context: PrivacyExecutionContext;
    readonly requestId: string;
    readonly policyRef: string;
    readonly retentionPolicyRefs: readonly string[];
    readonly approvalId: string;
  }): Promise<{
    readonly receiptRef: string;
    readonly deletedTargets: readonly string[];
    readonly retainedTargets: readonly string[];
    readonly evidence: readonly string[];
  }> {
    assertContext(input.context);
    const policyRef = requireSafeText(input.policyRef, 'PRIVACY_DELETE_POLICY_REQUIRED');
    const retentionPolicyRefs = unique(
      input.retentionPolicyRefs.map((value) =>
        requireSafeText(value, 'PRIVACY_RETENTION_POLICY_REF_INVALID'),
      ),
    );
    const replay = await this.deps.store.findByExecution(
      scopeFromContext(input.context),
      input.context.executionId,
      'privacy.data_delete.execute',
    );
    if (replay) {
      const replayRetention = Array.isArray(replay.payload.retentionPolicyRefs)
        ? unique(
            replay.payload.retentionPolicyRefs.filter(
              (value): value is string => typeof value === 'string',
            ),
          )
        : [];
      if (
        replay.requestId !== input.requestId ||
        replay.policyRef !== policyRef ||
        JSON.stringify(replayRetention) !== JSON.stringify(retentionPolicyRefs) ||
        typeof replay.payload.receiptRef !== 'string' ||
        !Array.isArray(replay.payload.deletedTargets) ||
        !Array.isArray(replay.payload.retainedTargets)
      )
        throw new Error('PRIVACY_IDEMPOTENCY_CONFLICT');
      await this.auditLedgerEvent(
        input.context,
        'privacy.data_delete.execute',
        replay.approvalId,
        replay,
      );
      return {
        receiptRef: replay.payload.receiptRef,
        deletedTargets: replay.payload.deletedTargets.filter(
          (value): value is string => typeof value === 'string',
        ),
        retainedTargets: replay.payload.retainedTargets.filter(
          (value): value is string => typeof value === 'string',
        ),
        evidence: replay.evidence,
      };
    }

    const request = await this.requestForSensitiveOperation(input.context, input.requestId, [
      'DELETE',
    ]);
    const descriptor = privacyApprovalDescriptor({
      capabilityId: 'privacy.data_delete.execute',
      ...scopeFromContext(input.context),
      subjectRef: request.subjectRef,
      requestId: request.requestId,
      requestType: request.requestType,
      identityVerificationRef: requireSafeText(
        request.identityVerificationRef ?? '',
        'PRIVACY_SUBJECT_IDENTITY_NOT_VERIFIED',
      ),
      policyRef,
      operationParameters: JSON.stringify({ retentionPolicyRefs }),
    });
    return this.withApproval({
      context: input.context,
      approvalId: input.approvalId,
      capabilityId: 'privacy.data_delete.execute',
      descriptor,
      requiredScope: [privacyApprovalScope(input.context, request.subjectRef, 'delete')],
      action: async () => {
        const result = await this.deps.dataGateway.deleteSubjectData({
          ...scopeFromContext(input.context),
          subjectRef: request.subjectRef,
          requestId: request.requestId,
          policyRef,
          retentionPolicyRefs,
          executionId: input.context.executionId,
        });
        const evidence = requireEvidence(
          result.evidence,
          'PRIVACY_DELETE_READBACK_EVIDENCE_REQUIRED',
        );
        const normalized = {
          receiptRef: requireSafeText(result.receiptRef, 'PRIVACY_DELETE_RECEIPT_REQUIRED'),
          deletedTargets: unique(
            result.deletedTargets.map((value) =>
              requireSafeText(value, 'PRIVACY_DELETE_TARGET_INVALID'),
            ),
          ),
          retainedTargets: unique(
            result.retainedTargets.map((value) =>
              requireSafeText(value, 'PRIVACY_RETAINED_TARGET_INVALID'),
            ),
          ),
          evidence,
        };
        await this.append({
          context: input.context,
          subjectRef: request.subjectRef,
          requestId: request.requestId,
          purposeId: null,
          channel: null,
          policyRef,
          approvalId: input.approvalId,
          capabilityId: 'privacy.data_delete.execute',
          eventType: 'DATA_DELETE_EXECUTED',
          payload: {
            receiptRef: normalized.receiptRef,
            deletedTargets: normalized.deletedTargets,
            retainedTargets: normalized.retainedTargets,
            retentionPolicyRefs,
          },
          extraEvidence: evidence,
        });
        return { result: normalized, readbackEvidence: evidence };
      },
    });
  }
}
