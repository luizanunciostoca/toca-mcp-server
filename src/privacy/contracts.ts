import type { ApprovalRecord, ApprovalStore } from '../governance/approval-governance.js';
import type { AuditSink } from '../core/audit.js';

export const PRIVACY_ROUTE_ID = 'R16' as const;

export const PRIVACY_CAPABILITY_IDS = [
  'privacy.purpose.resolve',
  'privacy.communication.resolve',
  'privacy.legal_basis.record',
  'privacy.consent.record',
  'privacy.consent.revoke',
  'privacy.opt_out.record',
  'privacy.suppression.check',
  'privacy.suppression.record',
  'privacy.preference.update',
  'privacy.provider_consent.reconcile',
  'privacy.pii.access.evaluate',
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
export type PrivacyIdentityState = 'RESOLVED' | 'AMBIGUOUS' | 'UNKNOWN';
export type CommunicationPolicyState = 'ALLOWED' | 'BLOCKED' | 'UNKNOWN_BLOCKED';
export type ProviderConsentState =
  'OPTED_IN' | 'OPTED_OUT' | 'UNSUBSCRIBED' | 'BOUNCED' | 'COMPLAINT' | 'UNKNOWN';
export type SuppressionReason =
  | 'USER_OPT_OUT'
  | 'PROVIDER_OPT_OUT'
  | 'PROVIDER_UNSUBSCRIBED'
  | 'PROVIDER_BOUNCED'
  | 'PROVIDER_COMPLAINT'
  | 'POLICY'
  | 'LEGAL'
  | 'MANUAL';
export type PiiClassification = 'PUBLIC' | 'INTERNAL' | 'PERSONAL' | 'SENSITIVE';
export type PiiAuthorizationState = 'AUTHORIZED' | 'DENIED' | 'UNKNOWN';

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
  'COMMUNICATION_POLICY_RESOLVED',
  'LEGAL_BASIS_RECORDED',
  'CONSENT_RECORDED',
  'CONSENT_REVOKED',
  'OPT_OUT_RECORDED',
  'SUPPRESSION_CHECKED',
  'SUPPRESSION_RECORDED',
  'PREFERENCE_UPDATED',
  'PROVIDER_CONSENT_RECONCILED',
  'PII_ACCESS_EVALUATED',
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

export interface PrivacyCommunicationPolicy {
  readonly channels: readonly string[];
  readonly consentRequired: boolean;
  readonly preferenceRequired: boolean;
  readonly prohibited: boolean;
  readonly validUntil: string | null;
}

export interface PrivacyPurposeDefinition extends PrivacyScope {
  readonly purposeId: string;
  readonly description: string;
  readonly policyRef: string;
  readonly active: boolean;
  readonly evidence: readonly string[];
  readonly communication?: PrivacyCommunicationPolicy;
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

export interface PrivacyContactReference {
  readonly subjectRef: string | null;
  readonly identityState: PrivacyIdentityState;
}

export interface CommunicationPolicyDecision {
  readonly state: CommunicationPolicyState;
  readonly allowed: boolean;
  readonly blocked: boolean;
  readonly reasons: readonly string[];
  readonly purposeId: string;
  readonly channel: string;
  readonly policyRef: string | null;
}

export interface ProviderConsentObservation {
  readonly provider: string;
  readonly providerSubjectRef: string;
  readonly state: ProviderConsentState;
  readonly observedAt: string;
  readonly providerEvidenceRef: string;
}

export interface PiiAuthorizationDecision {
  readonly state: PiiAuthorizationState;
  readonly decisionRef: string | null;
  readonly allowedClassifications: readonly PiiClassification[];
  readonly allowedFields: readonly string[];
}

export interface PiiAccessDecision {
  readonly state: 'ALLOWED' | 'MINIMIZED' | 'DENIED' | 'UNKNOWN_BLOCKED';
  readonly allowed: boolean;
  readonly classification: PiiClassification;
  readonly exposedFields: readonly string[];
  readonly omittedFields: readonly string[];
  readonly reasons: readonly string[];
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
