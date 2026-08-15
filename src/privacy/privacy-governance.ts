import { randomUUID } from 'node:crypto';
import { hashApprovalDescriptor, type ApprovalRecord } from '../governance/approval-governance.js';
import type { AuditEvent } from '../core/audit.js';
import type {
  AutomatedDecisionEvidence,
  AutomatedDecisionExplanation,
  ConsentState,
  LegalBasisClass,
  LegalBasisReviewStatus,
  PreferenceState,
  PrivacyCapabilityId,
  PrivacyDependencies,
  PrivacyExecutionContext,
  PrivacyLedgerEvent,
  PrivacyLedgerEventType,
  PrivacySubjectRequestStatus,
  PrivacySubjectRequestType,
  ProfilingEvidence,
  ProfilingReview,
  PurposeResolution,
  RetentionAction,
  SubjectRequestSnapshot,
  SuppressionDecision,
} from './contracts.js';

export class PrivacyGovernanceService {
  readonly #deps: PrivacyDependencies;

  constructor(deps: PrivacyDependencies) {
    this.#deps = deps;
  }

  async resolvePurpose(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly purposeId: string;
  }): Promise<PurposeResolution> {
    const { context } = input;
    assertContext(context);
    const subjectRef = requireText(input.subjectRef, 'PRIVACY_SUBJECT_REQUIRED');
    const purposeId = requireText(input.purposeId, 'PRIVACY_PURPOSE_REQUIRED');
    const purpose = await this.#deps.purposeRegistry.resolve(context.tenantId, purposeId);
    const resolution: PurposeResolution = purpose?.active
      ? { state: 'KNOWN', purpose, blocked: false, reasons: [] }
      : {
          state: 'UNKNOWN_BLOCKED',
          purpose: null,
          blocked: true,
          reasons: [purpose ? 'PURPOSE_INACTIVE' : 'PURPOSE_UNKNOWN'],
        };

    await this.#append({
      context,
      subjectRef,
      requestId: null,
      purposeId,
      channel: null,
      policyRef: purpose?.policyRef ?? null,
      approvalId: null,
      capabilityId: 'privacy.purpose.resolve',
      eventType: 'PURPOSE_RESOLVED',
      payload: {
        resolution: resolution.state,
        blocked: resolution.blocked,
        reasons: resolution.reasons,
      },
      extraEvidence: purpose?.evidence ?? [],
    });
    return resolution;
  }

  async recordLegalBasis(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly purposeId: string;
    readonly basisReference: string;
    readonly basisClass: LegalBasisClass;
    readonly statuteReference: string;
    readonly policyRef: string;
    readonly reviewStatus: LegalBasisReviewStatus;
    readonly validFrom: string;
    readonly validUntil: string | null;
    readonly sourceEvidence: readonly string[];
  }): Promise<PrivacyLedgerEvent> {
    assertContext(input.context);
    await this.#assertKnownPurpose(input.context.tenantId, input.purposeId);
    const sourceEvidence = requireEvidence(
      input.sourceEvidence,
      'PRIVACY_LEGAL_BASIS_EVIDENCE_REQUIRED',
    );
    const validFrom = requireTimestamp(input.validFrom, 'PRIVACY_LEGAL_BASIS_VALID_FROM_INVALID');
    const validUntil = input.validUntil
      ? requireTimestamp(input.validUntil, 'PRIVACY_LEGAL_BASIS_VALID_UNTIL_INVALID')
      : null;
    if (validUntil && Date.parse(validUntil) <= Date.parse(validFrom))
      throw new Error('PRIVACY_LEGAL_BASIS_VALIDITY_INVALID');

    return this.#append({
      context: input.context,
      subjectRef: input.subjectRef,
      requestId: null,
      purposeId: input.purposeId,
      channel: null,
      policyRef: requireText(input.policyRef, 'PRIVACY_POLICY_REF_REQUIRED'),
      approvalId: null,
      capabilityId: 'privacy.legal_basis.record',
      eventType: 'LEGAL_BASIS_RECORDED',
      payload: {
        basisReference: requireText(input.basisReference, 'PRIVACY_LEGAL_BASIS_REFERENCE_REQUIRED'),
        basisClass: input.basisClass,
        statuteReference: requireText(
          input.statuteReference,
          'PRIVACY_LEGAL_BASIS_STATUTE_REFERENCE_REQUIRED',
        ),
        reviewStatus: input.reviewStatus,
        validFrom,
        validUntil,
      },
      extraEvidence: sourceEvidence,
    });
  }

  async recordConsent(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly purposeId: string;
    readonly channel: string;
    readonly state: ConsentState;
    readonly noticeVersion: string;
    readonly collectionMethod: string;
    readonly capturedAt: string;
    readonly policyRef: string;
    readonly sourceEvidence: readonly string[];
  }): Promise<PrivacyLedgerEvent> {
    assertContext(input.context);
    await this.#assertKnownPurpose(input.context.tenantId, input.purposeId);
    return this.#append({
      context: input.context,
      subjectRef: input.subjectRef,
      requestId: null,
      purposeId: input.purposeId,
      channel: requireText(input.channel, 'PRIVACY_CHANNEL_REQUIRED'),
      policyRef: requireText(input.policyRef, 'PRIVACY_POLICY_REF_REQUIRED'),
      approvalId: null,
      capabilityId: 'privacy.consent.record',
      eventType: 'CONSENT_RECORDED',
      payload: {
        state: input.state,
        noticeVersion: requireText(input.noticeVersion, 'PRIVACY_NOTICE_VERSION_REQUIRED'),
        collectionMethod: requireText(
          input.collectionMethod,
          'PRIVACY_CONSENT_COLLECTION_METHOD_REQUIRED',
        ),
        capturedAt: requireTimestamp(input.capturedAt, 'PRIVACY_CONSENT_TIMESTAMP_INVALID'),
      },
      extraEvidence: requireEvidence(input.sourceEvidence, 'PRIVACY_CONSENT_EVIDENCE_REQUIRED'),
    });
  }

  async revokeConsent(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly purposeId: string;
    readonly channel: string;
    readonly policyRef: string;
    readonly revokedAt: string;
    readonly sourceEvidence: readonly string[];
  }): Promise<PrivacyLedgerEvent> {
    assertContext(input.context);
    const events = await this.#deps.store.listForSubject(input.context.tenantId, input.subjectRef);
    const consent = latest(
      events,
      (event) =>
        event.purposeId === input.purposeId &&
        event.channel === input.channel &&
        (event.eventType === 'CONSENT_RECORDED' || event.eventType === 'CONSENT_REVOKED'),
    );
    if (!consent) throw new Error('PRIVACY_CONSENT_NOT_FOUND');
    if (consent.eventType === 'CONSENT_REVOKED') return consent;
    if (consent.payload.state !== 'GRANTED') throw new Error('PRIVACY_CONSENT_NOT_GRANTED');

    return this.#append({
      context: input.context,
      subjectRef: input.subjectRef,
      requestId: null,
      purposeId: input.purposeId,
      channel: input.channel,
      policyRef: requireText(input.policyRef, 'PRIVACY_POLICY_REF_REQUIRED'),
      approvalId: null,
      capabilityId: 'privacy.consent.revoke',
      eventType: 'CONSENT_REVOKED',
      payload: {
        consentEventId: consent.eventId,
        revokedAt: requireTimestamp(
          input.revokedAt,
          'PRIVACY_CONSENT_REVOCATION_TIMESTAMP_INVALID',
        ),
      },
      extraEvidence: requireEvidence(
        input.sourceEvidence,
        'PRIVACY_CONSENT_REVOCATION_EVIDENCE_REQUIRED',
      ),
    });
  }

  async checkSuppression(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly purposeId: string;
    readonly channel: string;
    readonly preferenceRequired: boolean;
  }): Promise<SuppressionDecision> {
    assertContext(input.context);
    const subjectRef = requireText(input.subjectRef, 'PRIVACY_SUBJECT_REQUIRED');
    const purposeId = requireText(input.purposeId, 'PRIVACY_PURPOSE_REQUIRED');
    const channel = requireText(input.channel, 'PRIVACY_CHANNEL_REQUIRED');
    const purpose = await this.#deps.purposeRegistry.resolve(input.context.tenantId, purposeId);
    const events = await this.#deps.store.listForSubject(input.context.tenantId, subjectRef);
    const reasons: string[] = [];
    let state: SuppressionDecision['state'] = 'ALLOWED';

    if (!purpose?.active) {
      state = 'UNKNOWN_BLOCKED';
      reasons.push(purpose ? 'PURPOSE_INACTIVE' : 'PURPOSE_UNKNOWN');
    }

    const deletion = latest(events, (event) => event.eventType === 'DATA_DELETE_EXECUTED');
    const retention = latest(
      events,
      (event) => event.eventType === 'RETENTION_APPLIED' && event.purposeId === purposeId,
    );
    if (
      deletion ||
      retention?.payload.action === 'DELETE' ||
      retention?.payload.action === 'ANONYMIZE'
    ) {
      state = 'SUPPRESSED';
      reasons.push(deletion ? 'DATA_DELETE_EXECUTED' : 'RETENTION_SUPPRESSES_USE');
    }

    const basis = latest(
      events,
      (event) => event.eventType === 'LEGAL_BASIS_RECORDED' && event.purposeId === purposeId,
    );
    if (!basis) {
      if (state === 'ALLOWED') state = 'UNKNOWN_BLOCKED';
      reasons.push('LEGAL_BASIS_UNKNOWN');
    } else if (basis.payload.reviewStatus !== 'APPROVED') {
      if (state === 'ALLOWED') state = 'UNKNOWN_BLOCKED';
      reasons.push('LEGAL_BASIS_NOT_APPROVED');
    } else if (
      basis.payload.validUntil &&
      Date.parse(String(basis.payload.validUntil)) <= Date.now()
    ) {
      if (state === 'ALLOWED') state = 'UNKNOWN_BLOCKED';
      reasons.push('LEGAL_BASIS_EXPIRED');
    } else if (basis.payload.basisClass === 'CONSENT') {
      const consent = latest(
        events,
        (event) =>
          event.purposeId === purposeId &&
          event.channel === channel &&
          (event.eventType === 'CONSENT_RECORDED' || event.eventType === 'CONSENT_REVOKED'),
      );
      if (!consent) {
        if (state === 'ALLOWED') state = 'UNKNOWN_BLOCKED';
        reasons.push('CONSENT_UNKNOWN');
      } else if (consent.eventType === 'CONSENT_REVOKED' || consent.payload.state !== 'GRANTED') {
        state = 'SUPPRESSED';
        reasons.push(
          consent.eventType === 'CONSENT_REVOKED' ? 'CONSENT_REVOKED' : 'CONSENT_DENIED',
        );
      }
    }

    if (input.preferenceRequired) {
      const preference = latest(
        events,
        (event) =>
          event.eventType === 'PREFERENCE_UPDATED' &&
          event.purposeId === purposeId &&
          event.channel === channel,
      );
      if (!preference) {
        if (state === 'ALLOWED') state = 'UNKNOWN_BLOCKED';
        reasons.push('PREFERENCE_UNKNOWN');
      } else if (preference.payload.state !== 'ALLOW') {
        state = 'SUPPRESSED';
        reasons.push('PREFERENCE_DENY');
      }
    }

    const decision: SuppressionDecision = {
      state,
      blocked: state !== 'ALLOWED',
      reasons: unique(reasons),
      purposeId,
      channel,
    };
    await this.#append({
      context: input.context,
      subjectRef,
      requestId: null,
      purposeId,
      channel,
      policyRef: purpose?.policyRef ?? null,
      approvalId: null,
      capabilityId: 'privacy.suppression.check',
      eventType: 'SUPPRESSION_CHECKED',
      payload: decision,
      extraEvidence: purpose?.evidence ?? [],
    });
    return decision;
  }

  async updatePreference(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly purposeId: string;
    readonly channel: string;
    readonly state: PreferenceState;
    readonly policyRef: string;
    readonly sourceRef: string;
    readonly sourceEvidence: readonly string[];
  }): Promise<PrivacyLedgerEvent> {
    assertContext(input.context);
    await this.#assertKnownPurpose(input.context.tenantId, input.purposeId);
    return this.#append({
      context: input.context,
      subjectRef: input.subjectRef,
      requestId: null,
      purposeId: input.purposeId,
      channel: input.channel,
      policyRef: requireText(input.policyRef, 'PRIVACY_POLICY_REF_REQUIRED'),
      approvalId: null,
      capabilityId: 'privacy.preference.update',
      eventType: 'PREFERENCE_UPDATED',
      payload: {
        state: input.state,
        sourceRef: requireText(input.sourceRef, 'PRIVACY_PREFERENCE_SOURCE_REQUIRED'),
      },
      extraEvidence: requireEvidence(input.sourceEvidence, 'PRIVACY_PREFERENCE_EVIDENCE_REQUIRED'),
    });
  }

  async applyRetention(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly purposeId: string;
    readonly action: RetentionAction;
    readonly policyRef: string;
    readonly reason: string;
    readonly sourceEvidence: readonly string[];
  }): Promise<{
    readonly event: PrivacyLedgerEvent;
    readonly destructiveExecutionRequired: boolean;
  }> {
    assertContext(input.context);
    await this.#assertKnownPurpose(input.context.tenantId, input.purposeId);
    const event = await this.#append({
      context: input.context,
      subjectRef: input.subjectRef,
      requestId: null,
      purposeId: input.purposeId,
      channel: null,
      policyRef: requireText(input.policyRef, 'PRIVACY_RETENTION_POLICY_REQUIRED'),
      approvalId: null,
      capabilityId: 'privacy.retention.apply',
      eventType: 'RETENTION_APPLIED',
      payload: {
        action: input.action,
        reason: requireText(input.reason, 'PRIVACY_RETENTION_REASON_REQUIRED'),
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
    const requestId = randomUUID();
    const status: PrivacySubjectRequestStatus = input.identityVerificationRef
      ? 'IN_REVIEW'
      : 'IDENTITY_VERIFICATION_REQUIRED';
    const event = await this.#append({
      context: input.context,
      subjectRef: input.subjectRef,
      requestId,
      purposeId: null,
      channel: null,
      policyRef: requireText(input.policyRef, 'PRIVACY_SUBJECT_REQUEST_POLICY_REQUIRED'),
      approvalId: null,
      capabilityId: 'privacy.subject_request.create',
      eventType: 'SUBJECT_REQUEST_CREATED',
      payload: {
        requestType: input.requestType,
        status,
        identityVerificationRef: input.identityVerificationRef,
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
    const events = await this.#deps.store.listForRequest(
      input.context.tenantId,
      requireText(input.requestId, 'PRIVACY_REQUEST_ID_REQUIRED'),
    );
    if (events.length === 0) throw new Error('PRIVACY_SUBJECT_REQUEST_NOT_FOUND');
    const snapshot = snapshotFromEvents(events);
    await this.#audit(input.context, 'privacy.subject_request.status', 'SUCCEEDED', null, [
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
    const request = await this.#requestForSensitiveOperation(input.context, input.requestId, [
      'ACCESS',
      'CONFIRMATION',
      'PORTABILITY',
      'INFORMATION',
      'OTHER',
    ]);
    const policyRef = requireText(input.policyRef, 'PRIVACY_EXPORT_POLICY_REQUIRED');
    const descriptor = privacyApprovalDescriptor({
      capabilityId: 'privacy.data_export.prepare',
      tenantId: input.context.tenantId,
      subjectRef: request.subjectRef,
      requestId: request.requestId,
      policyRef,
    });
    return this.#withApproval({
      context: input.context,
      approvalId: input.approvalId,
      capabilityId: 'privacy.data_export.prepare',
      descriptor,
      requiredScope: [`privacy:subject:${request.subjectRef}:export`],
      action: async () => {
        const result = await this.#deps.dataGateway.prepareExport({
          tenantId: input.context.tenantId,
          subjectRef: request.subjectRef,
          requestId: request.requestId,
          policyRef,
          executionId: input.context.executionId,
        });
        const evidence = requireEvidence(
          result.evidence,
          'PRIVACY_EXPORT_READBACK_EVIDENCE_REQUIRED',
        );
        await this.#append({
          context: input.context,
          subjectRef: request.subjectRef,
          requestId: request.requestId,
          purposeId: null,
          channel: null,
          policyRef,
          approvalId: input.approvalId,
          capabilityId: 'privacy.data_export.prepare',
          eventType: 'DATA_EXPORT_PREPARED',
          payload: {
            artifactRef: requireText(result.artifactRef, 'PRIVACY_EXPORT_ARTIFACT_REQUIRED'),
          },
          extraEvidence: evidence,
        });
        return { artifactRef: result.artifactRef, evidence };
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
    const request = await this.#requestForSensitiveOperation(input.context, input.requestId, [
      'DELETE',
    ]);
    const policyRef = requireText(input.policyRef, 'PRIVACY_DELETE_POLICY_REQUIRED');
    const retentionPolicyRefs = unique(
      input.retentionPolicyRefs.map((value) => value.trim()).filter(Boolean),
    );
    const descriptor = privacyApprovalDescriptor({
      capabilityId: 'privacy.data_delete.execute',
      tenantId: input.context.tenantId,
      subjectRef: request.subjectRef,
      requestId: request.requestId,
      policyRef,
    });
    return this.#withApproval({
      context: input.context,
      approvalId: input.approvalId,
      capabilityId: 'privacy.data_delete.execute',
      descriptor,
      requiredScope: [`privacy:subject:${request.subjectRef}:delete`],
      action: async () => {
        const result = await this.#deps.dataGateway.deleteSubjectData({
          tenantId: input.context.tenantId,
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
        await this.#append({
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
            receiptRef: requireText(result.receiptRef, 'PRIVACY_DELETE_RECEIPT_REQUIRED'),
            deletedTargets: unique(result.deletedTargets),
            retainedTargets: unique(result.retainedTargets),
            retentionPolicyRefs,
          },
          extraEvidence: evidence,
        });
        return {
          receiptRef: result.receiptRef,
          deletedTargets: unique(result.deletedTargets),
          retainedTargets: unique(result.retainedTargets),
          evidence,
        };
      },
    });
  }

  async explainAutomatedDecision(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly policyRef: string;
    readonly evidence: AutomatedDecisionEvidence | null;
  }): Promise<AutomatedDecisionExplanation> {
    assertContext(input.context);
    const decision = input.evidence;
    const explanation: AutomatedDecisionExplanation = decision
      ? {
          state: 'KNOWN',
          decisionRef: requireText(decision.decisionRef, 'PRIVACY_DECISION_REF_REQUIRED'),
          criteriaSummary: requireText(
            decision.criteriaSummary,
            'PRIVACY_DECISION_CRITERIA_REQUIRED',
          ),
          procedureSummary: requireText(
            decision.procedureSummary,
            'PRIVACY_DECISION_PROCEDURE_REQUIRED',
          ),
          reasons: [],
        }
      : {
          state: 'UNKNOWN_BLOCKED',
          decisionRef: null,
          criteriaSummary: null,
          procedureSummary: null,
          reasons: ['AUTOMATED_DECISION_EVIDENCE_UNKNOWN'],
        };
    await this.#append({
      context: input.context,
      subjectRef: input.subjectRef,
      requestId: null,
      purposeId: null,
      channel: null,
      policyRef: requireText(input.policyRef, 'PRIVACY_AUTOMATED_DECISION_POLICY_REQUIRED'),
      approvalId: null,
      capabilityId: 'privacy.automated_decision.explain',
      eventType: 'AUTOMATED_DECISION_EXPLAINED',
      payload: explanation,
      extraEvidence: decision
        ? requireEvidence(decision.sourceEvidence, 'PRIVACY_DECISION_EVIDENCE_REQUIRED')
        : [],
    });
    return explanation;
  }

  async reviewProfiling(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly policyRef: string;
    readonly evidence: ProfilingEvidence | null;
  }): Promise<ProfilingReview> {
    assertContext(input.context);
    const evidence = input.evidence;
    let review: ProfilingReview;
    if (!evidence) {
      review = {
        state: 'UNKNOWN_BLOCKED',
        profilingRef: null,
        reasons: ['PROFILING_EVIDENCE_UNKNOWN'],
      };
    } else {
      const reasons: string[] = [];
      if (evidence.automatedOnly === null) reasons.push('AUTOMATION_STATUS_UNKNOWN');
      if (evidence.affectsInterests === null) reasons.push('IMPACT_STATUS_UNKNOWN');
      if (evidence.legalBasisRecorded !== true) reasons.push('LEGAL_BASIS_NOT_CONFIRMED');
      if (evidence.dataMinimizationReviewed !== true)
        reasons.push('DATA_MINIMIZATION_NOT_CONFIRMED');
      if (evidence.automatedOnly === true && evidence.affectsInterests === true)
        reasons.push('AUTOMATED_DECISION_REVIEW_APPLIES');
      const hasUnknown = evidence.automatedOnly === null || evidence.affectsInterests === null;
      review = {
        state: hasUnknown ? 'UNKNOWN_BLOCKED' : reasons.length > 0 ? 'REVIEW_REQUIRED' : 'CLEAR',
        profilingRef: requireText(evidence.profilingRef, 'PRIVACY_PROFILING_REF_REQUIRED'),
        reasons,
      };
    }
    await this.#append({
      context: input.context,
      subjectRef: input.subjectRef,
      requestId: null,
      purposeId: evidence?.purposeId ?? null,
      channel: null,
      policyRef: requireText(input.policyRef, 'PRIVACY_PROFILING_POLICY_REQUIRED'),
      approvalId: null,
      capabilityId: 'privacy.profiling.review',
      eventType: 'PROFILING_REVIEWED',
      payload: review,
      extraEvidence: evidence
        ? requireEvidence(evidence.sourceEvidence, 'PRIVACY_PROFILING_EVIDENCE_REQUIRED')
        : [],
    });
    return review;
  }

  async #requestForSensitiveOperation(
    context: PrivacyExecutionContext,
    requestId: string,
    allowedTypes: readonly PrivacySubjectRequestType[],
  ): Promise<SubjectRequestSnapshot> {
    assertContext(context);
    const events = await this.#deps.store.listForRequest(
      context.tenantId,
      requireText(requestId, 'PRIVACY_REQUEST_ID_REQUIRED'),
    );
    if (events.length === 0) throw new Error('PRIVACY_SUBJECT_REQUEST_NOT_FOUND');
    const request = snapshotFromEvents(events);
    if (!allowedTypes.includes(request.requestType))
      throw new Error('PRIVACY_SUBJECT_REQUEST_TYPE_MISMATCH');
    if (['COMPLETED', 'DENIED', 'CANCELLED'].includes(request.status))
      throw new Error('PRIVACY_SUBJECT_REQUEST_CLOSED');
    return request;
  }

  async #assertKnownPurpose(tenantId: string, purposeId: string): Promise<void> {
    const purpose = await this.#deps.purposeRegistry.resolve(
      requireText(tenantId, 'PRIVACY_TENANT_REQUIRED'),
      requireText(purposeId, 'PRIVACY_PURPOSE_REQUIRED'),
    );
    if (!purpose?.active) throw new Error('PRIVACY_PURPOSE_UNKNOWN_OR_INACTIVE');
  }

  async #withApproval<T>(input: {
    readonly context: PrivacyExecutionContext;
    readonly approvalId: string;
    readonly capabilityId: 'privacy.data_export.prepare' | 'privacy.data_delete.execute';
    readonly descriptor: Readonly<Record<string, string>>;
    readonly requiredScope: readonly string[];
    readonly action: () => Promise<T>;
  }): Promise<T> {
    assertContext(input.context);
    const approvalId = requireText(input.approvalId, 'PRIVACY_APPROVAL_REQUIRED');
    const approval = await this.#deps.approvalStore.get(approvalId);
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

    await this.#deps.approvalStore.transition(approvalId, {
      type: 'RESERVE',
      expectation,
      binding: {
        executionId: input.context.executionId,
        principalId: input.context.requester,
        correlationId: input.context.correlationId,
      },
    });
    try {
      await this.#deps.approvalStore.transition(approvalId, {
        type: 'BEGIN_EXECUTION',
        executionId: input.context.executionId,
        evidence: input.context.evidence,
      });
      const result = await input.action();
      const readbackEvidence = [
        `privacy:${input.capabilityId}:${input.context.executionId}:readback`,
      ];
      await this.#deps.approvalStore.transition(approvalId, {
        type: 'PROVIDER_READBACK',
        executionId: input.context.executionId,
        evidence: readbackEvidence,
      });
      await this.#deps.approvalStore.transition(approvalId, {
        type: 'CONSUME',
        executionId: input.context.executionId,
        evidence: readbackEvidence,
      });
      return result;
    } catch (error) {
      const current = await this.#deps.approvalStore.get(approvalId);
      const failureEvidence = [
        `privacy:failure:${input.context.executionId}`,
        ...input.context.evidence,
      ];
      if (current?.status === 'RESERVED') {
        await this.#deps.approvalStore.transition(approvalId, {
          type: 'RELEASE',
          executionId: input.context.executionId,
          evidence: failureEvidence,
          reason: 'PRIVACY_EXECUTION_FAILED_BEFORE_SIDE_EFFECT',
        });
      } else if (current && ['EXECUTING', 'PROVIDER_READBACK'].includes(current.status)) {
        await this.#deps.approvalStore.transition(approvalId, {
          type: 'FAIL_REVIEW_REQUIRED',
          executionId: input.context.executionId,
          evidence: failureEvidence,
          reason: 'PRIVACY_SENSITIVE_OPERATION_REQUIRES_REVIEW',
        });
      }
      throw error;
    }
  }

  async #append(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly requestId: string | null;
    readonly purposeId: string | null;
    readonly channel: string | null;
    readonly policyRef: string | null;
    readonly approvalId: string | null;
    readonly capabilityId: PrivacyCapabilityId;
    readonly eventType: PrivacyLedgerEventType;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly extraEvidence: readonly string[];
  }): Promise<PrivacyLedgerEvent> {
    assertContext(input.context);
    const event: PrivacyLedgerEvent = {
      eventId: randomUUID(),
      tenantId: input.context.tenantId,
      subjectRef: requireText(input.subjectRef, 'PRIVACY_SUBJECT_REQUIRED'),
      requestId: input.requestId,
      purposeId: input.purposeId,
      channel: input.channel,
      policyRef: input.policyRef,
      approvalId: input.approvalId,
      capabilityId: input.capabilityId,
      eventType: input.eventType,
      requester: input.context.requester,
      executionId: input.context.executionId,
      correlationId: input.context.correlationId,
      occurredAt: new Date().toISOString(),
      evidence: unique([...input.context.evidence, ...input.extraEvidence]),
      payload: input.payload,
    };
    await this.#deps.store.append(event);
    await this.#audit(
      input.context,
      input.capabilityId,
      'SUCCEEDED',
      input.approvalId,
      event.evidence,
    );
    return event;
  }

  async #audit(
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
      ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
      ...(context.organizationId ? { organizationId: context.organizationId } : {}),
      status,
      ...(approvalId ? { approvalId } : {}),
      evidence: unique(evidence),
      createdAt: new Date().toISOString(),
    };
    await this.#deps.auditSink.write(event);
  }
}

export function privacyApprovalDescriptor(input: {
  readonly capabilityId: 'privacy.data_export.prepare' | 'privacy.data_delete.execute';
  readonly tenantId: string;
  readonly subjectRef: string;
  readonly requestId: string;
  readonly policyRef: string;
}): Readonly<Record<string, string>> {
  return {
    capabilityId: input.capabilityId,
    tenantId: requireText(input.tenantId, 'PRIVACY_TENANT_REQUIRED'),
    subjectRef: requireText(input.subjectRef, 'PRIVACY_SUBJECT_REQUIRED'),
    requestId: requireText(input.requestId, 'PRIVACY_REQUEST_ID_REQUIRED'),
    policyRef: requireText(input.policyRef, 'PRIVACY_POLICY_REF_REQUIRED'),
  };
}

function snapshotFromEvents(events: readonly PrivacyLedgerEvent[]): SubjectRequestSnapshot {
  const created = events.find((event) => event.eventType === 'SUBJECT_REQUEST_CREATED');
  if (!created || !created.requestId || !created.policyRef)
    throw new Error('PRIVACY_SUBJECT_REQUEST_CORRUPT');
  const statusEvent = latest(
    events,
    (event) =>
      event.eventType === 'SUBJECT_REQUEST_STATUS_CHANGED' ||
      event.eventType === 'DATA_EXPORT_PREPARED' ||
      event.eventType === 'DATA_DELETE_EXECUTED',
  );
  const inferredStatus: PrivacySubjectRequestStatus =
    statusEvent?.eventType === 'DATA_EXPORT_PREPARED' ||
    statusEvent?.eventType === 'DATA_DELETE_EXECUTED'
      ? 'COMPLETED'
      : isRequestStatus(statusEvent?.payload.status)
        ? statusEvent.payload.status
        : isRequestStatus(created.payload.status)
          ? created.payload.status
          : 'REQUESTED';
  const requestType = created.payload.requestType;
  if (!isRequestType(requestType)) throw new Error('PRIVACY_SUBJECT_REQUEST_TYPE_INVALID');
  return {
    requestId: created.requestId,
    tenantId: created.tenantId,
    subjectRef: created.subjectRef,
    requestType,
    status: inferredStatus,
    createdAt: created.occurredAt,
    updatedAt: statusEvent?.occurredAt ?? created.occurredAt,
    policyRef: created.policyRef,
    evidence: unique(events.flatMap((event) => event.evidence)),
  };
}

function assertApprovalBinding(
  approval: ApprovalRecord,
  tenantId: string,
  capabilityId: PrivacyCapabilityId,
): void {
  if (approval.routeId !== 'R16') throw new Error('PRIVACY_APPROVAL_ROUTE_MISMATCH');
  if (approval.capabilityId !== capabilityId)
    throw new Error('PRIVACY_APPROVAL_CAPABILITY_MISMATCH');
  if (approval.targetAccount !== tenantId) throw new Error('PRIVACY_APPROVAL_TENANT_MISMATCH');
}

function latest(
  events: readonly PrivacyLedgerEvent[],
  predicate: (event: PrivacyLedgerEvent) => boolean,
): PrivacyLedgerEvent | undefined {
  return events.filter(predicate).at(-1);
}

function isRequestStatus(value: unknown): value is PrivacySubjectRequestStatus {
  return (
    typeof value === 'string' &&
    [
      'REQUESTED',
      'IDENTITY_VERIFICATION_REQUIRED',
      'IN_REVIEW',
      'APPROVAL_REQUIRED',
      'APPROVED',
      'EXECUTING',
      'COMPLETED',
      'DENIED',
      'CANCELLED',
    ].includes(value)
  );
}

function isRequestType(value: unknown): value is PrivacySubjectRequestType {
  return (
    typeof value === 'string' &&
    [
      'CONFIRMATION',
      'ACCESS',
      'CORRECTION',
      'PORTABILITY',
      'DELETE',
      'CONSENT_REVOCATION',
      'INFORMATION',
      'AUTOMATED_DECISION_REVIEW',
      'OTHER',
    ].includes(value)
  );
}

function assertContext(context: PrivacyExecutionContext): void {
  requireText(context.tenantId, 'PRIVACY_TENANT_REQUIRED');
  requireText(context.requester, 'PRIVACY_REQUESTER_REQUIRED');
  requireText(context.executionId, 'PRIVACY_EXECUTION_ID_REQUIRED');
  requireText(context.correlationId, 'PRIVACY_CORRELATION_ID_REQUIRED');
  requireEvidence(context.evidence, 'PRIVACY_EXECUTION_EVIDENCE_REQUIRED');
}

function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

function requireTimestamp(value: string, errorCode: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(errorCode);
  return new Date(value).toISOString();
}

function requireEvidence(values: readonly string[], errorCode: string): readonly string[] {
  const evidence = unique(values.map((value) => value.trim()).filter(Boolean));
  if (evidence.length === 0) throw new Error(errorCode);
  return evidence;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}
