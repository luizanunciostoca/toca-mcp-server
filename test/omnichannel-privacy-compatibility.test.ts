import { describe, expect, it } from 'vitest';
import { InMemoryAuditSink } from '../src/core/audit.js';
import { createTrustedServiceExecutionIdentity } from '../src/core/identity.js';
import type { ContactRecord, CrmScope } from '../src/crm/crm-records.js';
import { InMemoryApprovalStore } from '../src/governance/approval-governance.js';
import {
  proveOutboundPrivacyEligibility,
  type PrivacySubjectRefLookup,
  type PrivacySubjectRefResolution,
} from '../src/omnichannel/privacy-compatibility.js';
import {
  InMemoryPrivacyLedgerStore,
  InMemoryPrivacyPurposeRegistry,
  PrivacyGovernanceService,
  type LegalBasisClass,
  type PrivacyDataGateway,
  type PrivacyExecutionContext,
  type PrivacyPurposeDefinition,
} from '../src/privacy/index.js';

const scope: CrmScope = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  organizationId: 'org-1',
};
const contactRecordId = 'contact-1';
const subjectRef = 'subject:opaque:contact-1';
const purpose: PrivacyPurposeDefinition = {
  tenantId: scope.tenantId,
  purposeId: 'marketing-event-updates',
  description: 'Canonical integration fixture purpose.',
  policyRef: 'policy://privacy/marketing-event-updates/v1',
  active: true,
  evidence: ['fixture:purpose'],
};

function identity() {
  return createTrustedServiceExecutionIdentity({
    principalId: 'principal:omnichannel-test',
    ...scope,
    roles: ['EXTERNAL_WRITER'],
    evidence: ['identity:fixture'],
  });
}

function contact(overrides: Partial<ContactRecord> = {}): ContactRecord {
  return {
    ...scope,
    contactId: contactRecordId,
    contactType: 'PERSON',
    displayName: 'Opaque integration fixture',
    status: 'ACTIVE',
    attributes: {},
    version: 1,
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
    ...overrides,
  };
}

function subjectLookup(
  override?: Partial<PrivacySubjectRefResolution>,
): PrivacySubjectRefLookup {
  return {
    resolve: async () => ({
      ...scope,
      status: 'RESOLVED',
      contactRecordId,
      subjectRef,
      evidence: ['subject-binding:fixture'],
      ...override,
    }),
  };
}

function dataGateway(): PrivacyDataGateway {
  return {
    prepareExport: async () => ({ artifactRef: 'unused', evidence: ['unused:export'] }),
    deleteSubjectData: async () => ({
      receiptRef: 'unused',
      deletedTargets: [],
      retainedTargets: [],
      evidence: ['unused:delete'],
    }),
  };
}

function setup(options?: {
  readonly contact?: ContactRecord | undefined;
  readonly subjectRefs?: PrivacySubjectRefLookup;
}) {
  const privacyStore = new InMemoryPrivacyLedgerStore();
  const privacy = new PrivacyGovernanceService({
    store: privacyStore,
    purposeRegistry: new InMemoryPrivacyPurposeRegistry([purpose]),
    auditSink: new InMemoryAuditSink(),
    approvalStore: new InMemoryApprovalStore(),
    dataGateway: dataGateway(),
  });
  const selectedContact = options && 'contact' in options ? options.contact : contact();
  return {
    privacy,
    privacyStore,
    deps: {
      crm: {
        getContact: async () => selectedContact,
      },
      privacy,
      privacyStore,
      subjectRefs: options?.subjectRefs ?? subjectLookup(),
    },
  };
}

function privacyContext(executionId: string): PrivacyExecutionContext {
  return {
    ...scope,
    requester: identity().principal.principalId,
    executionId,
    correlationId: `corr:${executionId}`,
    evidence: [`fixture:${executionId}`],
  };
}

async function seedLegalBasis(
  privacy: PrivacyGovernanceService,
  basisClass: LegalBasisClass,
): Promise<void> {
  await privacy.recordLegalBasis({
    context: privacyContext(`basis:${basisClass}`),
    subjectRef,
    purposeId: purpose.purposeId,
    basisReference: `legal-review:${basisClass}`,
    basisClass,
    statuteReference: 'LGPD:fixture-explicit-review',
    policyRef: purpose.policyRef,
    reviewStatus: 'APPROVED',
    validFrom: '2026-08-15T00:00:00.000Z',
    validUntil: null,
    sourceEvidence: [`legal-basis:${basisClass}`],
  });
}

async function seedConsent(
  privacy: PrivacyGovernanceService,
  state: 'GRANTED' | 'DENIED' = 'GRANTED',
): Promise<void> {
  await privacy.recordConsent({
    context: privacyContext(`consent:${state}`),
    subjectRef,
    purposeId: purpose.purposeId,
    channel: 'whatsapp',
    state,
    noticeVersion: 'notice-v1',
    collectionMethod: 'explicit-fixture',
    capturedAt: '2026-08-15T01:00:00.000Z',
    policyRef: purpose.policyRef,
    sourceEvidence: [`consent:${state}:proof`],
  });
}

async function seedPreference(
  privacy: PrivacyGovernanceService,
  state: 'ALLOW' | 'DENY',
): Promise<void> {
  await privacy.updatePreference({
    context: privacyContext(`preference:${state}`),
    subjectRef,
    purposeId: purpose.purposeId,
    channel: 'whatsapp',
    state,
    policyRef: purpose.policyRef,
    sourceRef: `preference-center:${state}`,
    sourceEvidence: [`preference:${state}:proof`],
  });
}

async function prove(
  deps: ReturnType<typeof setup>['deps'],
  preferenceRequired = false,
) {
  return proveOutboundPrivacyEligibility(deps, {
    identity: identity(),
    contactRecordId,
    purposeId: purpose.purposeId,
    channel: 'WHATSAPP',
    preferenceRequired,
    executionId: 'exec:outbound-proof',
    correlationId: 'corr:outbound-proof',
    evidence: ['request:outbound-proof'],
  });
}

describe('Privacy -> Omnichannel compatibility proof', () => {
  it('uses an explicit non-consent legal basis without inventing consent', async () => {
    const state = setup();
    await seedLegalBasis(state.privacy, 'OTHER_EXPLICIT_BASIS');

    const proof = await prove(state.deps);

    expect(proof.legalBasisClass).toBe('OTHER_EXPLICIT_BASIS');
    expect(proof.consentRequired).toBe(false);
    expect(proof.consentEventId).toBeNull();
    expect(proof.subjectRef).toBe(subjectRef);
    expect(proof.workspaceId).toBe(scope.workspaceId);
    expect(proof.organizationId).toBe(scope.organizationId);
  });

  it('fails closed when consent is required but unknown', async () => {
    const state = setup();
    await seedLegalBasis(state.privacy, 'CONSENT');

    await expect(prove(state.deps)).rejects.toThrow(
      'OMNICHANNEL_PRIVACY_BLOCKED:UNKNOWN_BLOCKED:CONSENT_UNKNOWN',
    );
  });

  it('fails closed after consent is revoked', async () => {
    const state = setup();
    await seedLegalBasis(state.privacy, 'CONSENT');
    await seedConsent(state.privacy);
    await state.privacy.revokeConsent({
      context: privacyContext('consent:revoke'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'whatsapp',
      policyRef: purpose.policyRef,
      revokedAt: '2026-08-15T02:00:00.000Z',
      sourceEvidence: ['consent:revoked:proof'],
    });

    await expect(prove(state.deps)).rejects.toThrow(
      'OMNICHANNEL_PRIVACY_BLOCKED:SUPPRESSED:CONSENT_REVOKED',
    );
  });

  it('fails closed for an incompatible required preference', async () => {
    const state = setup();
    await seedLegalBasis(state.privacy, 'OTHER_EXPLICIT_BASIS');
    await seedPreference(state.privacy, 'DENY');

    await expect(prove(state.deps, true)).rejects.toThrow(
      'OMNICHANNEL_PRIVACY_BLOCKED:SUPPRESSED:PREFERENCE_DENY',
    );
  });

  it('fails closed when retention suppresses the purpose', async () => {
    const state = setup();
    await seedLegalBasis(state.privacy, 'OTHER_EXPLICIT_BASIS');
    await state.privacy.applyRetention({
      context: privacyContext('retention:delete'),
      subjectRef,
      purposeId: purpose.purposeId,
      action: 'DELETE',
      policyRef: 'policy://privacy/retention/v1',
      reason: 'Fixture retention decision.',
      sourceEvidence: ['retention:delete:proof'],
    });

    await expect(prove(state.deps)).rejects.toThrow('RETENTION_SUPPRESSES_USE');
  });

  it('rejects a missing canonical ContactRecord', async () => {
    const state = setup({ contact: undefined });
    await expect(prove(state.deps)).rejects.toThrow('OMNICHANNEL_CONTACT_NOT_FOUND');
  });

  it('rejects cross-tenant ContactRecord reuse', async () => {
    const state = setup({ contact: contact({ tenantId: 'tenant-2' }) });
    await expect(prove(state.deps)).rejects.toThrow('OMNICHANNEL_CONTACT_SCOPE_MISMATCH');
  });

  it('rejects ambiguous privacy subject binding instead of guessing identity', async () => {
    const state = setup({
      subjectRefs: subjectLookup({ status: 'AMBIGUOUS', subjectRef: null }),
    });
    await expect(prove(state.deps)).rejects.toThrow('OMNICHANNEL_PRIVACY_SUBJECT_AMBIGUOUS');
  });

  it('binds preference and consent evidence to the exact purpose and channel', async () => {
    const state = setup();
    await seedLegalBasis(state.privacy, 'CONSENT');
    await seedConsent(state.privacy);
    await seedPreference(state.privacy, 'ALLOW');

    const proof = await prove(state.deps, true);

    expect(proof.legalBasisEventId).toBeTruthy();
    expect(proof.consentEventId).toBeTruthy();
    expect(proof.preferenceEventId).toBeTruthy();
    expect(proof.suppressionDecisionEventId).toBeTruthy();
    expect(proof.evidence).toContain('identity:fixture');
  });
});
