import type { ApprovalRecord, ApprovalStore } from '../governance/approval-governance.js';
import type { AuditSink } from '../core/audit.js';

export const PRIVACY_ROUTE_ID = 'R16' as const;

export const PRIVACY_CAPABILITY_IDS = [
  'privacy.purpose.resolve',
  'privacy.legal_basis.record',
  'privacy.consent.record',
  'privacy.consent.revoke',
  'privacy.suppression.check',
  'privacy.preference.update',
  'privacy.retention.apply',
  'privacy.subject_request.create',
  'privacy.subject_request.status',
  'privacy.data_export.prepare',
  'privacy.data_delete.execute',
  'privacy.automated_decision.explain',
  'privacy.profiling.review',
] as const;

export type PrivacyCapabilityId = (typeof PRIVACY_CAPABILITY_IDS)[number];

export type PrivacyResolutionState = 'KNOWN' | 'UNKNOWN_BLOCKED';
export type SuppressionState = 'ALLOWED' | 'SUPPRESSED' | 'UNKNOWN_BLOCKED';
export type LegalBasisClass = 'CONSENT' | 'OTHER_EXPLICIT_BASIS';
export type LegalBasisReviewStatus = 'APPROVED' | 'PENDING';
export type ConsentState = 'GRANTED' | 'DENIED';
export type PreferenceState = 'ALLOW' | 'DENY';
export type RetentionAction = 'HOLD' | 'REVIEW' | 'DELETE' | 'ANONYMIZE';

export interface PrivacyScope {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
}

export const PRIVACY_SUBJECT_REQUEST_TYPES = [
  'CONFIRMATION',
  'ACCESS',
  'CORRECTION',
  'PORTABILITY',
  'DELETE',
  'CONSENT_REVOCATION',
  'INFORMATION',
  'AUTOMATED_DECISION_REVIEW',
  'OTHER',
] as const;
export type PrivacySubjectRequestType = (typeof PRIVACY_SUBJECT_REQUEST_TYPES)[number];

export const PRIVACY_SUBJECT_REQUEST_STATUSES = [
  'REQUESTED',
  'IDENTITY_VERIFICATION_REQUIRED',
  'IN_REVIEW',
  'APPROVAL_REQUIRED',
  'APPROVED',
  'EXECUTING',
  'COMPLETED',
  'DENIED',
  'CANCELLED',
] as const;
export type PrivacySubjectRequestStatus = (typeof PRIVACY_SUBJECT_REQUEST_STATUSES)[number];

export const PRIVACY_LEDGER_EVENT_TYPES = [
  'PURPOSE_RESOLVED',
  'LEGAL_BASIS_RECORDED',
  'CONSENT_RECORDED',
  'CONSENT_REVOKED',
  'SUPPRESSION_CHECKED',
  'PREFERENCE_UPDATED',
  'RETENTION_APPLIED',
  'SUBJECT_REQUEST_CREATED',
  'SUBJECT_REQUEST_STATUS_CHANGED',
  'DATA_EXPORT_PREPARED',
  'DATA_DELETE_EXECUTED',
  'AUTOMATED_DECISION_EXPLAINED',
  'PROFILING_REVIEWED',
] as const;
export type PrivacyLedgerEventType = (typeof PRIVACY_LEDGER_EVENT_TYPES)[number];

export interface PrivacyExecutionContext extends PrivacyScope {
  readonly requester: string;
  readonly executionId: string;
  readonly correlationId: string;
  readonly evidence: readonly string[];
}

export interface PrivacyPurposeDefinition extends PrivacyScope {
  readonly purposeId: string;
  readonly description: string;
  readonly policyRef: string;
  readonly active: boolean;
  readonly evidence: readonly string[];
}

export interface PrivacyPurposeRegistry {
  resolve(scope: PrivacyScope, purposeId: string): Promise<PrivacyPurposeDefinition | undefined>;
}

export interface PrivacyLedgerEvent extends PrivacyScope {
  readonly eventId: string;
  readonly subjectRef: string;
  readonly requestId: string | null;
  readonly purposeId: string | null;
  readonly channel: string | null;
  readonly policyRef: string | null;
  readonly approvalId: string | null;
  readonly capabilityId: PrivacyCapabilityId;
  readonly eventType: PrivacyLedgerEventType;
  readonly requester: string;
  readonly executionId: string;
  readonly correlationId: string;
  readonly occurredAt: string;
  readonly evidence: readonly string[];
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface PrivacyLedgerStore {
  append(event: PrivacyLedgerEvent): Promise<void>;
  appendConsentTransition(
    event: PrivacyLedgerEvent,
    expectedHeadEventId: string | null,
  ): Promise<void>;
  findByExecution(
    scope: PrivacyScope,
    executionId: string,
    capabilityId: PrivacyCapabilityId,
  ): Promise<PrivacyLedgerEvent | undefined>;
  listForSubject(scope: PrivacyScope, subjectRef: string): Promise<readonly PrivacyLedgerEvent[]>;
  listForRequest(scope: PrivacyScope, requestId: string): Promise<readonly PrivacyLedgerEvent[]>;
}

export interface PrivacyDataExportResult {
  readonly artifactRef: string;
  readonly evidence: readonly string[];
}

export interface PrivacyDataDeleteResult {
  readonly receiptRef: string;
  readonly deletedTargets: readonly string[];
  readonly retainedTargets: readonly string[];
  readonly evidence: readonly string[];
}

export interface PrivacyDataGateway {
  prepareExport(
    input: PrivacyScope & {
      readonly subjectRef: string;
      readonly requestId: string;
      readonly policyRef: string;
      readonly executionId: string;
    },
  ): Promise<PrivacyDataExportResult>;
  deleteSubjectData(
    input: PrivacyScope & {
      readonly subjectRef: string;
      readonly requestId: string;
      readonly policyRef: string;
      readonly retentionPolicyRefs: readonly string[];
      readonly executionId: string;
    },
  ): Promise<PrivacyDataDeleteResult>;
}

export interface PrivacyDependencies {
  readonly store: PrivacyLedgerStore;
  readonly purposeRegistry: PrivacyPurposeRegistry;
  readonly auditSink: AuditSink;
  readonly approvalStore: ApprovalStore;
  readonly dataGateway: PrivacyDataGateway;
}

export interface PurposeResolution {
  readonly state: PrivacyResolutionState;
  readonly purpose: PrivacyPurposeDefinition | null;
  readonly blocked: boolean;
  readonly reasons: readonly string[];
}

export interface SuppressionDecision {
  readonly state: SuppressionState;
  readonly blocked: boolean;
  readonly reasons: readonly string[];
  readonly purposeId: string;
  readonly channel: string;
}

export interface SubjectRequestSnapshot extends PrivacyScope {
  readonly requestId: string;
  readonly subjectRef: string;
  readonly requestType: PrivacySubjectRequestType;
  readonly status: PrivacySubjectRequestStatus;
  readonly identityVerificationRef: string | null;
  readonly requester: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly policyRef: string;
  readonly evidence: readonly string[];
}

export interface AutomatedDecisionEvidence {
  readonly decisionRef: string;
  readonly occurredAt: string;
  readonly criteriaSummary: string;
  readonly procedureSummary: string;
  readonly sourceEvidence: readonly string[];
}

export interface AutomatedDecisionExplanation {
  readonly state: PrivacyResolutionState;
  readonly decisionRef: string | null;
  readonly criteriaSummary: string | null;
  readonly procedureSummary: string | null;
  readonly reasons: readonly string[];
}

export interface ProfilingEvidence {
  readonly profilingRef: string;
  readonly purposeId: string;
  readonly automatedOnly: boolean | null;
  readonly affectsInterests: boolean | null;
  readonly legalBasisRecorded: boolean | null;
  readonly dataMinimizationReviewed: boolean | null;
  readonly sourceEvidence: readonly string[];
}

export interface ProfilingReview {
  readonly state: 'CLEAR' | 'REVIEW_REQUIRED' | 'UNKNOWN_BLOCKED';
  readonly profilingRef: string | null;
  readonly reasons: readonly string[];
}

export interface SensitiveApprovalInput {
  readonly approvalId: string;
  readonly approval: ApprovalRecord;
}

export type { ApprovalRecord, ApprovalStore, AuditSink };
