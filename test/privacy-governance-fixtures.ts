import { InMemoryAuditSink } from '../src/core/audit.js';
import {
  InMemoryApprovalStore,
  hashApprovalDescriptor,
  type ApprovalRecord,
} from '../src/governance/approval-governance.js';
import {
  InMemoryPrivacyLedgerStore,
  InMemoryPrivacyPurposeRegistry,
  PrivacyGovernanceService,
  type PrivacyDataGateway,
  type PrivacyExecutionContext,
  type PrivacyPurposeDefinition,
} from '../src/privacy/index.js';

export const tenantId = 'tenant-toca';
export const workspaceId = 'workspace-marketing';
export const organizationId = 'organization-toca';
export const subjectRef = 'subject:opaque:001';
export const purpose: PrivacyPurposeDefinition = {
  tenantId,
  workspaceId,
  organizationId,
  purposeId: 'marketing-event-updates',
  description: 'Purpose supplied by a canonical business policy fixture.',
  policyRef: 'drive://11_JURIDICO_E_COMPLIANCE/07_LGPD/purpose-policy-v1',
  active: true,
  evidence: ['fixture:canonical-purpose-policy'],
};

export function context(
  executionId = 'exec-1',
  overrides: Partial<PrivacyExecutionContext> = {},
): PrivacyExecutionContext {
  return {
    tenantId,
    workspaceId,
    organizationId,
    requester: 'principal:luiz',
    executionId,
    correlationId: `corr:${executionId}`,
    evidence: [`request:${executionId}`],
    ...overrides,
  };
}

export function createGateway(): PrivacyDataGateway {
  return {
    prepareExport: ({ subjectRef: ref }) =>
      Promise.resolve({
        artifactRef: `artifact:${ref}:export`,
        evidence: ['gateway:export:verified'],
      }),
    deleteSubjectData: ({ subjectRef: ref }) =>
      Promise.resolve({
        receiptRef: `receipt:${ref}:delete`,
        deletedTargets: ['privacy-controlled-store'],
        retainedTargets: ['audit-ledger'],
        evidence: ['gateway:delete:verified'],
      }),
  };
}

export function createService(
  purposes: readonly PrivacyPurposeDefinition[] = [purpose],
  dataGateway: PrivacyDataGateway = createGateway(),
) {
  const store = new InMemoryPrivacyLedgerStore();
  const approvalStore = new InMemoryApprovalStore();
  const auditSink = new InMemoryAuditSink();
  const service = new PrivacyGovernanceService({
    store,
    purposeRegistry: new InMemoryPrivacyPurposeRegistry(purposes),
    approvalStore,
    auditSink,
    dataGateway,
  });
  return { service, store, approvalStore, auditSink };
}

export function scopedApprovalScope(subject: string, operation: 'export' | 'delete'): string {
  return ['privacy', tenantId, workspaceId, organizationId, subject, operation].join(':');
}

export function approvedPrivacyRecord(input: {
  approvalId: string;
  capabilityId: 'privacy.data_export.prepare' | 'privacy.data_delete.execute';
  descriptor: Readonly<Record<string, string>>;
  scope: string;
  requester: string;
  correlationId: string;
}): ApprovalRecord {
  return {
    approvalId: input.approvalId,
    requester: input.requester,
    approver: 'principal:accountable-owner',
    routeId: 'R16',
    capabilityId: input.capabilityId,
    descriptorSha256: hashApprovalDescriptor(input.descriptor),
    targetAccount: tenantId,
    scope: [input.scope],
    financialCeiling: null,
    requestedAt: '2026-08-15T00:00:00.000Z',
    issuedAt: '2026-08-15T00:01:00.000Z',
    expiresAt: '2999-01-01T00:00:00.000Z',
    consumedAt: null,
    revokedAt: null,
    reservationExecutionId: null,
    reservationPrincipalId: null,
    reservationCorrelationId: null,
    reservedAt: null,
    executingAt: null,
    providerReadbackAt: null,
    providerReadbackEvidence: [],
    releasedAt: null,
    releaseReason: null,
    failedReviewAt: null,
    failureReason: null,
    status: 'APPROVED',
    evidence: ['approval:fixture'],
    correlationId: input.correlationId,
    version: 1,
  };
}

export async function seedAllowableMarketingState(
  service: PrivacyGovernanceService,
): Promise<void> {
  await service.recordLegalBasis({
    context: context('basis'),
    subjectRef,
    purposeId: purpose.purposeId,
    basisReference: 'legal-review:explicit-basis-001',
    basisClass: 'CONSENT',
    statuteReference: 'LGPD:explicit-reference-from-legal-review',
    policyRef: purpose.policyRef,
    reviewStatus: 'APPROVED',
    validFrom: '2026-08-15T00:00:00.000Z',
    validUntil: null,
    sourceEvidence: ['legal-review:001'],
  });
  await service.recordConsent({
    context: context('consent'),
    subjectRef,
    purposeId: purpose.purposeId,
    channel: 'email',
    state: 'GRANTED',
    consentVersion: 1,
    noticeVersion: 'notice-v1',
    collectionMethod: 'explicit-form',
    capturedAt: '2026-08-15T00:10:00.000Z',
    policyRef: purpose.policyRef,
    sourceEvidence: ['consent-proof:001'],
  });
  await service.updatePreference({
    context: context('preference'),
    subjectRef,
    purposeId: purpose.purposeId,
    channel: 'email',
    state: 'ALLOW',
    policyRef: purpose.policyRef,
    sourceRef: 'preference-center:001',
    sourceEvidence: ['preference-proof:001'],
  });
}

export async function createVerifiedRequest(
  service: PrivacyGovernanceService,
  requestType: 'ACCESS' | 'DELETE',
  executionId: string,
) {
  return service.createSubjectRequest({
    context: context(executionId),
    subjectRef,
    requestType,
    policyRef: 'drive://privacy/subject-rights-v1',
    identityVerificationRef: `identity-proof:${executionId}`,
    sourceEvidence: [`subject-request:${executionId}`],
  });
}
