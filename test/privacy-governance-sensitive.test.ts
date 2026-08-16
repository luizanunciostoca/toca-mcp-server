import { describe, expect, it } from 'vitest';
import { privacyApprovalDescriptor } from '../src/privacy/index.js';
import {
  approvedPrivacyRecord,
  context,
  createGateway,
  createService,
  createVerifiedRequest,
  organizationId,
  purpose,
  scopedApprovalScope,
  seedAllowableMarketingState,
  subjectRef,
  tenantId,
  workspaceId,
} from './privacy-governance-fixtures.js';

describe('PrivacyGovernanceService sensitive-operation hardening', () => {
  it('is idempotent per scope/execution/capability, heals audit replay and rejects mutated retries', async () => {
    const { service, store, auditSink } = createService();
    const input = {
      context: context('idempotent-preference'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
      state: 'DENY' as const,
      policyRef: purpose.policyRef,
      sourceRef: 'preference-center:001',
      sourceEvidence: ['preference-proof:idem'],
    };
    const first = await service.updatePreference(input);
    const second = await service.updatePreference(input);
    expect(second.eventId).toBe(first.eventId);

    await expect(service.updatePreference({ ...input, state: 'ALLOW' })).rejects.toThrow(
      'PRIVACY_IDEMPOTENCY_CONFLICT',
    );

    const history = await store.listForSubject(
      { tenantId, workspaceId, organizationId },
      subjectRef,
    );
    expect(history.filter((event) => event.eventType === 'PREFERENCE_UPDATED')).toHaveLength(1);
    expect(
      auditSink.list().filter((event) => event.executionId === input.context.executionId),
    ).toHaveLength(2);
  });

  it('blocks export and deletion while subject identity remains unverified', async () => {
    const { service } = createService();
    const request = await service.createSubjectRequest({
      context: context('unverified-request'),
      subjectRef,
      requestType: 'DELETE',
      policyRef: 'drive://privacy/subject-rights-v1',
      identityVerificationRef: null,
      sourceEvidence: ['subject-request:unverified'],
    });

    await expect(
      service.executeDataDelete({
        context: context('unverified-delete'),
        requestId: request.requestId,
        policyRef: 'drive://privacy/delete-policy-v1',
        retentionPolicyRefs: [],
        approvalId: '00000000-0000-4000-8000-000000000010',
      }),
    ).rejects.toThrow('PRIVACY_SUBJECT_IDENTITY_NOT_VERIFIED');
  });

  it('binds export approval to tenant/workspace/organization, subject, request and identity proof', async () => {
    const { service, approvalStore } = createService();
    const request = await createVerifiedRequest(service, 'ACCESS', 'create-export-request');
    const executionContext = context('export-exec');
    const descriptor = privacyApprovalDescriptor({
      capabilityId: 'privacy.data_export.prepare',
      tenantId,
      workspaceId,
      organizationId,
      subjectRef,
      requestId: request.requestId,
      requestType: request.requestType,
      identityVerificationRef: request.identityVerificationRef!,
      policyRef: 'drive://privacy/export-policy-v1',
      operationParameters: '{}',
    });
    const approval = approvedPrivacyRecord({
      approvalId: '00000000-0000-4000-8000-000000000001',
      capabilityId: 'privacy.data_export.prepare',
      descriptor,
      scope: scopedApprovalScope(subjectRef, 'export'),
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
    expect((await approvalStore.get(approval.approvalId))?.providerReadbackEvidence).toEqual([
      'gateway:export:verified',
    ]);
  });

  it('rejects a valid approval from another tenant/workspace/organization scope', async () => {
    const { service, approvalStore } = createService();
    const request = await createVerifiedRequest(service, 'ACCESS', 'create-cross-scope');
    const executionContext = context('cross-scope-export');
    const descriptor = privacyApprovalDescriptor({
      capabilityId: 'privacy.data_export.prepare',
      tenantId,
      workspaceId,
      organizationId,
      subjectRef,
      requestId: request.requestId,
      requestType: request.requestType,
      identityVerificationRef: request.identityVerificationRef!,
      policyRef: 'drive://privacy/export-policy-v1',
      operationParameters: '{}',
    });
    const approval = approvedPrivacyRecord({
      approvalId: '00000000-0000-4000-8000-000000000003',
      capabilityId: 'privacy.data_export.prepare',
      descriptor,
      scope: scopedApprovalScope(subjectRef, 'export'),
      requester: executionContext.requester,
      correlationId: executionContext.correlationId,
    });
    await approvalStore.put(approval);

    await expect(
      service.prepareDataExport({
        context: {
          ...executionContext,
          workspaceId: 'workspace-other',
          executionId: 'cross-scope-export-other',
          correlationId: 'corr:cross-scope-export-other',
          evidence: ['request:cross-scope-export-other'],
        },
        requestId: request.requestId,
        policyRef: 'drive://privacy/export-policy-v1',
        approvalId: approval.approvalId,
      }),
    ).rejects.toThrow('PRIVACY_SUBJECT_REQUEST_NOT_FOUND');
  });

  it('binds retention policy refs into delete approval and rejects payload mutation after approval', async () => {
    const { service, approvalStore } = createService();
    const request = await createVerifiedRequest(service, 'DELETE', 'create-delete-request');
    const executionContext = context('delete-exec');
    const approvedRetention = ['drive://privacy/retention/audit-ledger-v1'];
    const descriptor = privacyApprovalDescriptor({
      capabilityId: 'privacy.data_delete.execute',
      tenantId,
      workspaceId,
      organizationId,
      subjectRef,
      requestId: request.requestId,
      requestType: request.requestType,
      identityVerificationRef: request.identityVerificationRef!,
      policyRef: 'drive://privacy/delete-policy-v1',
      operationParameters: JSON.stringify({ retentionPolicyRefs: approvedRetention }),
    });
    const approval = approvedPrivacyRecord({
      approvalId: '00000000-0000-4000-8000-000000000002',
      capabilityId: 'privacy.data_delete.execute',
      descriptor,
      scope: scopedApprovalScope(subjectRef, 'delete'),
      requester: executionContext.requester,
      correlationId: executionContext.correlationId,
    });
    await approvalStore.put(approval);

    await expect(
      service.executeDataDelete({
        context: executionContext,
        requestId: request.requestId,
        policyRef: 'drive://privacy/delete-policy-v1',
        retentionPolicyRefs: ['drive://privacy/retention/different-v2'],
        approvalId: approval.approvalId,
      }),
    ).rejects.toThrow(/APPROVAL_VERIFICATION_FAILED:DESCRIPTOR_MISMATCH/);
  });

  it('does not call the delete gateway without a valid approval', async () => {
    let deleteCalls = 0;
    const gateway = createGateway();
    const { service } = createService([purpose], {
      ...gateway,
      deleteSubjectData: async (input) => {
        deleteCalls += 1;
        return gateway.deleteSubjectData(input);
      },
    });
    const request = await createVerifiedRequest(service, 'DELETE', 'no-approval-delete');

    await expect(
      service.executeDataDelete({
        context: context('no-approval-delete-exec'),
        requestId: request.requestId,
        policyRef: 'drive://privacy/delete-policy-v1',
        retentionPolicyRefs: [],
        approvalId: '00000000-0000-4000-8000-000000000099',
      }),
    ).rejects.toThrow('PRIVACY_APPROVAL_NOT_FOUND');
    expect(deleteCalls).toBe(0);
  });

  it('requires an explicit subject binding before applying retention to an opaque subject', async () => {
    const { service } = createService();
    await expect(
      service.applyRetention({
        context: context('retention-wrong-subject'),
        subjectRef,
        purposeId: purpose.purposeId,
        action: 'REVIEW',
        subjectBindingRef: ' ',
        policyRef: 'drive://privacy/retention-v1',
        reason: 'Retention review requested by an explicit policy evaluation.',
        sourceEvidence: ['retention-policy-evaluation:subject-binding'],
      }),
    ).rejects.toThrow('PRIVACY_RETENTION_SUBJECT_BINDING_REQUIRED');
  });

  it('keeps suppression authoritative after retention/delete signals even if consent is granted', async () => {
    const { service } = createService();
    await seedAllowableMarketingState(service);
    await service.applyRetention({
      context: context('retention-suppress'),
      subjectRef,
      purposeId: purpose.purposeId,
      action: 'DELETE',
      subjectBindingRef: 'crm-subject-binding:001',
      policyRef: 'drive://privacy/retention-v1',
      reason: 'Explicit policy evaluation requested deletion.',
      sourceEvidence: ['retention-policy-evaluation:001'],
    });

    const decision = await service.checkSuppression({
      context: context('suppression-retention'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
      preferenceRequired: true,
    });
    expect(decision.state).toBe('SUPPRESSED');
    expect(decision.reasons).toContain('RETENTION_SUPPRESSES_USE');
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

  it('writes scoped audit events without raw subject data', async () => {
    const { service, auditSink } = createService();
    await service.resolvePurpose({
      context: context('audit-scope'),
      subjectRef,
      purposeId: purpose.purposeId,
    });
    const [event] = auditSink.list();
    expect(event?.tenantId).toBe(tenantId);
    expect(event?.workspaceId).toBe(workspaceId);
    expect(event?.organizationId).toBe(organizationId);
    expect(JSON.stringify(event)).not.toContain(subjectRef);
  });
});
