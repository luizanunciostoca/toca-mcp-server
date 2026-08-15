import { describe, expect, it } from 'vitest';
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
  privacyApprovalDescriptor,
  type PrivacyDataGateway,
  type PrivacyExecutionContext,
  type PrivacyPurposeDefinition,
} from '../src/privacy/index.js';

const tenantId = 'tenant-toca';
const subjectRef = 'subject:opaque:001';
const purpose: PrivacyPurposeDefinition = {
  tenantId,
  purposeId: 'marketing-event-updates',
  description: 'Purpose supplied by a canonical business policy fixture.',
  policyRef: 'drive://11_JURIDICO_E_COMPLIANCE/07_LGPD/purpose-policy-v1',
  active: true,
  evidence: ['fixture:canonical-purpose-policy'],
};

function context(executionId = 'exec-1'): PrivacyExecutionContext {
  return {
    tenantId,
    workspaceId: null,
    organizationId: null,
    requester: 'principal:luiz',
    executionId,
    correlationId: `corr:${executionId}`,
    evidence: [`request:${executionId}`],
  };
}

function createGateway(): PrivacyDataGateway {
  return {
    prepareExport: async ({ subjectRef: ref }) => ({
      artifactRef: `artifact:${ref}:export`,
      evidence: ['gateway:export:verified'],
    }),
    deleteSubjectData: async ({ subjectRef: ref }) => ({
      receiptRef: `receipt:${ref}:delete`,
      deletedTargets: ['privacy-controlled-store'],
      retainedTargets: ['audit-ledger'],
      evidence: ['gateway:delete:verified'],
    }),
  };
}

function createService(purposes: readonly PrivacyPurposeDefinition[] = [purpose]) {
  const store = new InMemoryPrivacyLedgerStore();
  const approvalStore = new InMemoryApprovalStore();
  const auditSink = new InMemoryAuditSink();
  const service = new PrivacyGovernanceService({
    store,
    purposeRegistry: new InMemoryPrivacyPurposeRegistry(purposes),
    approvalStore,
    auditSink,
    dataGateway: createGateway(),
  });
  return { service, store, approvalStore, auditSink };
}

function approvedPrivacyRecord(input: {
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

async function seedAllowableMarketingState(service: PrivacyGovernanceService): Promise<void> {
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

describe('PrivacyGovernanceService', () => {
  it('fails closed when purpose is unknown and never invents a purpose', async () => {
    const { service } = createService([]);
    const result = await service.resolvePurpose({
      context: context(),
      subjectRef,
      purposeId: 'unknown-purpose',
    });

    expect(result).toEqual({
      state: 'UNKNOWN_BLOCKED',
      purpose: null,
      blocked: true,
      reasons: ['PURPOSE_UNKNOWN'],
    });
  });

  it('allows only an explicitly reviewed basis, granted consent and allowed preference', async () => {
    const { service } = createService();
    await seedAllowableMarketingState(service);

    const allowed = await service.checkSuppression({
      context: context('suppression-allow'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
      preferenceRequired: true,
    });
    expect(allowed.state).toBe('ALLOWED');
    expect(allowed.blocked).toBe(false);

    await service.revokeConsent({
      context: context('revoke'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
      policyRef: purpose.policyRef,
      revokedAt: '2026-08-15T00:20:00.000Z',
      sourceEvidence: ['revocation-proof:001'],
    });

    const suppressed = await service.checkSuppression({
      context: context('suppression-deny'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
      preferenceRequired: true,
    });
    expect(suppressed.state).toBe('SUPPRESSED');
    expect(suppressed.reasons).toContain('CONSENT_REVOKED');
  });

  it('blocks unknown legal-basis state even when the purpose exists', async () => {
    const { service } = createService();
    const decision = await service.checkSuppression({
      context: context('unknown-basis'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
      preferenceRequired: false,
    });

    expect(decision.state).toBe('UNKNOWN_BLOCKED');
    expect(decision.reasons).toContain('LEGAL_BASIS_UNKNOWN');
  });

  it('isolates ledger reads by tenant', async () => {
    const { service, store } = createService();
    await service.recordConsent({
      context: context('tenant-isolation'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
      state: 'DENIED',
      noticeVersion: 'notice-v1',
      collectionMethod: 'explicit-form',
      capturedAt: '2026-08-15T00:10:00.000Z',
      policyRef: purpose.policyRef,
      sourceEvidence: ['consent-proof:tenant-isolation'],
    });

    expect(await store.listForSubject(tenantId, subjectRef)).toHaveLength(1);
    expect(await store.listForSubject('other-tenant', subjectRef)).toHaveLength(0);
  });

  it('requires a fixed, descriptor-bound approval and consumes it after export readback', async () => {
    const { service, approvalStore } = createService();
    const request = await service.createSubjectRequest({
      context: context('create-export-request'),
      subjectRef,
      requestType: 'ACCESS',
      policyRef: 'drive://privacy/subject-rights-v1',
      identityVerificationRef: 'identity-proof:001',
      sourceEvidence: ['subject-request:001'],
    });
    const executionContext = context('export-exec');
    const descriptor = privacyApprovalDescriptor({
      capabilityId: 'privacy.data_export.prepare',
      tenantId,
      subjectRef,
      requestId: request.requestId,
      policyRef: 'drive://privacy/export-policy-v1',
    });
    const approval = approvedPrivacyRecord({
      approvalId: '00000000-0000-4000-8000-000000000001',
      capabilityId: 'privacy.data_export.prepare',
      descriptor,
      scope: `privacy:subject:${subjectRef}:export`,
      requester: executionContext.requester,
      correlationId: executionContext.correlationId,
    });
    await approvalStore.put(approval);

    const result = await service.prepareDataExport({
      context: executionContext,
      requestId: request.requestId,
      policyRef: 'drive://privacy/export-policy-v1',
      approvalId: approval.approvalId,
    });

    expect(result.artifactRef).toContain(subjectRef);
    expect((await approvalStore.get(approval.approvalId))?.status).toBe('CONSUMED');
    expect(
      (
        await service.getSubjectRequestStatus({
          context: context('status'),
          requestId: request.requestId,
        })
      ).status,
    ).toBe('COMPLETED');
  });

  it('executes deletion only for a DELETE request with an approval bound to the same tenant and subject', async () => {
    const { service, approvalStore } = createService();
    const request = await service.createSubjectRequest({
      context: context('create-delete-request'),
      subjectRef,
      requestType: 'DELETE',
      policyRef: 'drive://privacy/subject-rights-v1',
      identityVerificationRef: 'identity-proof:delete',
      sourceEvidence: ['subject-request:delete'],
    });
    const executionContext = context('delete-exec');
    const descriptor = privacyApprovalDescriptor({
      capabilityId: 'privacy.data_delete.execute',
      tenantId,
      subjectRef,
      requestId: request.requestId,
      policyRef: 'drive://privacy/delete-policy-v1',
    });
    const approval = approvedPrivacyRecord({
      approvalId: '00000000-0000-4000-8000-000000000002',
      capabilityId: 'privacy.data_delete.execute',
      descriptor,
      scope: `privacy:subject:${subjectRef}:delete`,
      requester: executionContext.requester,
      correlationId: executionContext.correlationId,
    });
    await approvalStore.put(approval);

    const result = await service.executeDataDelete({
      context: executionContext,
      requestId: request.requestId,
      policyRef: 'drive://privacy/delete-policy-v1',
      retentionPolicyRefs: ['drive://privacy/retention/audit-ledger-v1'],
      approvalId: approval.approvalId,
    });

    expect(result.deletedTargets).toEqual(['privacy-controlled-store']);
    expect(result.retainedTargets).toEqual(['audit-ledger']);
    expect((await approvalStore.get(approval.approvalId))?.status).toBe('CONSUMED');
  });

  it('keeps automated-decision and profiling state unknown when evidence is absent', async () => {
    const { service } = createService();
    const explanation = await service.explainAutomatedDecision({
      context: context('decision'),
      subjectRef,
      policyRef: 'drive://privacy/automated-decisions-v1',
      evidence: null,
    });
    const review = await service.reviewProfiling({
      context: context('profiling'),
      subjectRef,
      policyRef: 'drive://privacy/profiling-v1',
      evidence: null,
    });

    expect(explanation.state).toBe('UNKNOWN_BLOCKED');
    expect(review.state).toBe('UNKNOWN_BLOCKED');
  });

  it('records retention decisions but delegates destructive execution to the delete capability', async () => {
    const { service } = createService();
    const result = await service.applyRetention({
      context: context('retention'),
      subjectRef,
      purposeId: purpose.purposeId,
      action: 'DELETE',
      policyRef: 'drive://privacy/retention-v1',
      reason: 'Explicit policy evaluation requested deletion.',
      sourceEvidence: ['retention-policy-evaluation:001'],
    });

    expect(result.destructiveExecutionRequired).toBe(true);
    expect(result.event.payload.action).toBe('DELETE');
  });
});
