import { describe, expect, it } from 'vitest';
import {
  context,
  createService,
  organizationId,
  purpose,
  seedAllowableMarketingState,
  subjectRef,
  tenantId,
  workspaceId,
} from './privacy-governance-fixtures.js';

describe('PrivacyGovernanceService hardening', () => {
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

  it('requires full tenant/workspace/organization scope and isolates reads across each boundary', async () => {
    const { service, store } = createService();
    await service.recordConsent({
      context: context('tenant-isolation'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
      state: 'DENIED',
      consentVersion: 1,
      noticeVersion: 'notice-v1',
      collectionMethod: 'explicit-form',
      capturedAt: '2026-08-15T00:10:00.000Z',
      policyRef: purpose.policyRef,
      sourceEvidence: ['consent-proof:tenant-isolation'],
    });

    expect(
      await store.listForSubject({ tenantId, workspaceId, organizationId }, subjectRef),
    ).toHaveLength(1);
    expect(
      await store.listForSubject(
        { tenantId, workspaceId: 'workspace-other', organizationId },
        subjectRef,
      ),
    ).toHaveLength(0);
    expect(
      await store.listForSubject(
        { tenantId, workspaceId, organizationId: 'organization-other' },
        subjectRef,
      ),
    ).toHaveLength(0);
    expect(
      await store.listForSubject(
        { tenantId: 'tenant-other', workspaceId, organizationId },
        subjectRef,
      ),
    ).toHaveLength(0);
  });

  it('rejects obvious raw PII instead of allowing it into subject refs, evidence or payloads', async () => {
    const { service } = createService();
    await expect(
      service.resolvePurpose({
        context: context('raw-subject'),
        subjectRef: 'person@example.com',
        purposeId: purpose.purposeId,
      }),
    ).rejects.toThrow('PRIVACY_SUBJECT_REF_NOT_OPAQUE');

    await expect(
      service.updatePreference({
        context: context('raw-evidence'),
        subjectRef,
        purposeId: purpose.purposeId,
        channel: 'email',
        state: 'DENY',
        policyRef: purpose.policyRef,
        sourceRef: 'preference-center:001',
        sourceEvidence: ['proof:person@example.com'],
      }),
    ).rejects.toThrow('PRIVACY_RAW_PII_EVIDENCE_REJECTED');
  });

  it('fails closed for unknown legal basis, unknown preference and future legal basis', async () => {
    const { service } = createService();
    const unknownBasis = await service.checkSuppression({
      context: context('unknown-basis'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
      preferenceRequired: true,
    });
    expect(unknownBasis.state).toBe('UNKNOWN_BLOCKED');
    expect(unknownBasis.reasons).toContain('LEGAL_BASIS_UNKNOWN');
    expect(unknownBasis.reasons).toContain('PREFERENCE_UNKNOWN');

    await service.recordLegalBasis({
      context: context('future-basis'),
      subjectRef,
      purposeId: purpose.purposeId,
      basisReference: 'legal-review:future',
      basisClass: 'OTHER_EXPLICIT_BASIS',
      statuteReference: 'legal-review:source',
      policyRef: purpose.policyRef,
      reviewStatus: 'APPROVED',
      validFrom: '2999-01-01T00:00:00.000Z',
      validUntil: null,
      sourceEvidence: ['legal-review:future'],
    });
    const future = await service.checkSuppression({
      context: context('future-basis-check'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
      preferenceRequired: false,
    });
    expect(future.state).toBe('UNKNOWN_BLOCKED');
    expect(future.reasons).toContain('LEGAL_BASIS_NOT_YET_VALID');
  });

  it('keeps preferences purpose-bound and never treats an unknown preference as consent', async () => {
    const { service } = createService();
    await service.recordLegalBasis({
      context: context('basis-purpose-bound'),
      subjectRef,
      purposeId: purpose.purposeId,
      basisReference: 'legal-review:001',
      basisClass: 'CONSENT',
      statuteReference: 'LGPD:reviewed',
      policyRef: purpose.policyRef,
      reviewStatus: 'APPROVED',
      validFrom: '2026-08-15T00:00:00.000Z',
      validUntil: null,
      sourceEvidence: ['legal-review:001'],
    });
    await service.recordConsent({
      context: context('consent-purpose-bound'),
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

    const decision = await service.checkSuppression({
      context: context('preference-missing'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
      preferenceRequired: true,
    });
    expect(decision.state).toBe('UNKNOWN_BLOCKED');
    expect(decision.reasons).toContain('PREFERENCE_UNKNOWN');
  });

  it('requires monotonically increasing consent versions and blocks consent replay after revocation', async () => {
    const { service } = createService();
    await seedAllowableMarketingState(service);
    await service.revokeConsent({
      context: context('revoke-v1'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
      policyRef: purpose.policyRef,
      revokedAt: '2026-08-15T00:20:00.000Z',
      sourceEvidence: ['revocation-proof:001'],
    });

    await expect(
      service.recordConsent({
        context: context('replay-v1'),
        subjectRef,
        purposeId: purpose.purposeId,
        channel: 'email',
        state: 'GRANTED',
        consentVersion: 1,
        noticeVersion: 'notice-v1',
        collectionMethod: 'replayed-form',
        capturedAt: '2026-08-15T00:21:00.000Z',
        policyRef: purpose.policyRef,
        sourceEvidence: ['consent-proof:replay'],
      }),
    ).rejects.toThrow('PRIVACY_CONSENT_VERSION_SEQUENCE_INVALID');

    await service.recordConsent({
      context: context('reconsent-v2'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
      state: 'GRANTED',
      consentVersion: 2,
      noticeVersion: 'notice-v2',
      collectionMethod: 'explicit-form',
      capturedAt: '2026-08-15T00:22:00.000Z',
      policyRef: purpose.policyRef,
      sourceEvidence: ['consent-proof:002'],
    });

    const decision = await service.checkSuppression({
      context: context('suppression-v2'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
      preferenceRequired: true,
    });
    expect(decision.state).toBe('ALLOWED');
  });

  it('serializes concurrent revocations so only one revocation transition is appended', async () => {
    const { service, store } = createService();
    await seedAllowableMarketingState(service);

    const results = await Promise.all([
      service.revokeConsent({
        context: context('revoke-concurrent-a'),
        subjectRef,
        purposeId: purpose.purposeId,
        channel: 'email',
        policyRef: purpose.policyRef,
        revokedAt: '2026-08-15T00:20:00.000Z',
        sourceEvidence: ['revocation-proof:a'],
      }),
      service.revokeConsent({
        context: context('revoke-concurrent-b'),
        subjectRef,
        purposeId: purpose.purposeId,
        channel: 'email',
        policyRef: purpose.policyRef,
        revokedAt: '2026-08-15T00:20:01.000Z',
        sourceEvidence: ['revocation-proof:b'],
      }),
    ]);
    expect(results[0].eventId).toBe(results[1].eventId);
    const history = await store.listForSubject(
      { tenantId, workspaceId, organizationId },
      subjectRef,
    );
    expect(history.filter((event) => event.eventType === 'CONSENT_REVOKED')).toHaveLength(1);
  });
});
