import { describe, expect, it } from 'vitest';
import type { PrivacyPurposeDefinition } from '../src/privacy/index.js';
import {
  context,
  createService,
  purpose,
  seedAllowableMarketingState,
  subjectRef,
} from './privacy-governance-fixtures.js';

const communicationPurpose: PrivacyPurposeDefinition = {
  ...purpose,
  communication: {
    channels: ['email', 'whatsapp'],
    consentRequired: true,
    preferenceRequired: true,
    prohibited: false,
    validUntil: '2999-01-01T00:00:00.000Z',
  },
};

function createCommunicationService(definition: PrivacyPurposeDefinition = communicationPurpose) {
  return createService([definition]);
}

describe('R16 transversal communication privacy policy', () => {
  it('allows contact only after purpose, legal basis, channel consent and preference are all known', async () => {
    const { service } = createCommunicationService();
    await seedAllowableMarketingState(service);

    const decision = await service.canContact({
      context: context('can-contact-allowed'),
      contact: { subjectRef, identityState: 'RESOLVED' },
      channel: 'email',
      purposeId: purpose.purposeId,
    });

    expect(decision).toMatchObject({
      state: 'ALLOWED',
      allowed: true,
      blocked: false,
      purposeId: purpose.purposeId,
      channel: 'email',
    });
    expect(decision.reasons).toEqual([]);
  });

  it('fails closed for unknown consent and never treats provider opt-in as canonical consent', async () => {
    const { service } = createCommunicationService();
    await service.recordLegalBasis({
      context: context('provider-optin-basis'),
      subjectRef,
      purposeId: purpose.purposeId,
      basisReference: 'legal-review:provider-optin',
      basisClass: 'CONSENT',
      statuteReference: 'LGPD:reviewed',
      policyRef: purpose.policyRef,
      reviewStatus: 'APPROVED',
      validFrom: '2026-08-15T00:00:00.000Z',
      validUntil: null,
      sourceEvidence: ['legal-review:provider-optin'],
    });
    await service.reconcileProviderConsent({
      context: context('provider-optin-observation'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
      policyRef: purpose.policyRef,
      observation: {
        provider: 'email-provider',
        providerSubjectRef: 'provider-subject:opaque:001',
        state: 'OPTED_IN',
        observedAt: '2026-08-20T04:00:00.000Z',
        providerEvidenceRef: 'provider-readback:optin:001',
      },
      sourceEvidence: ['provider-readback:optin:001'],
    });

    const decision = await service.resolveCommunicationPolicy({
      context: context('provider-optin-policy'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
    });

    expect(decision.allowed).toBe(false);
    expect(decision.state).toBe('UNKNOWN_BLOCKED');
    expect(decision.reasons).toContain('CONSENT_UNKNOWN');
    expect(decision.reasons).toContain('PREFERENCE_UNKNOWN');
  });

  it('fails closed before ledger resolution when identity is ambiguous', async () => {
    const { service, auditSink, store } = createCommunicationService();

    const decision = await service.canContact({
      context: context('ambiguous-contact'),
      contact: { subjectRef: null, identityState: 'AMBIGUOUS' },
      channel: 'email',
      purposeId: purpose.purposeId,
    });

    expect(decision).toMatchObject({
      state: 'BLOCKED',
      allowed: false,
      blocked: true,
      reasons: ['IDENTITY_AMBIGUOUS'],
    });
    expect(auditSink.list().at(-1)).toMatchObject({
      toolName: 'privacy.communication.resolve',
      status: 'DENIED',
    });
    expect(await store.listForSubject(purpose, subjectRef)).toHaveLength(0);
  });

  it('blocks prohibited purposes, disallowed channels and expired permission', async () => {
    const blockedPurpose: PrivacyPurposeDefinition = {
      ...communicationPurpose,
      communication: {
        channels: ['email'],
        consentRequired: true,
        preferenceRequired: true,
        prohibited: true,
        validUntil: '2000-01-01T00:00:00.000Z',
      },
    };
    const { service } = createCommunicationService(blockedPurpose);

    const decision = await service.resolveCommunicationPolicy({
      context: context('prohibited-purpose'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'whatsapp',
    });

    expect(decision.state).toBe('BLOCKED');
    expect(decision.reasons).toContain('PURPOSE_PROHIBITED');
    expect(decision.reasons).toContain('CHANNEL_NOT_ALLOWED_FOR_PURPOSE');
    expect(decision.reasons).toContain('PERMISSION_EXPIRED');
  });

  it('records explicit opt-out idempotently and makes subsequent contact ineligible', async () => {
    const { service } = createCommunicationService();
    await seedAllowableMarketingState(service);

    const first = await service.recordOptOut({
      context: context('explicit-optout'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
      policyRef: purpose.policyRef,
      sourceRef: 'preference-center:optout:001',
      recordedAt: '2026-08-20T04:01:00.000Z',
      sourceEvidence: ['preference-center:optout:001'],
    });
    const retry = await service.recordOptOut({
      context: context('explicit-optout'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
      policyRef: purpose.policyRef,
      sourceRef: 'preference-center:optout:001',
      recordedAt: '2026-08-20T04:01:00.000Z',
      sourceEvidence: ['preference-center:optout:001'],
    });

    expect(retry.eventId).toBe(first.eventId);
    await expect(
      service.recordOptOut({
        context: context('explicit-optout'),
        subjectRef,
        purposeId: purpose.purposeId,
        channel: 'email',
        policyRef: purpose.policyRef,
        sourceRef: 'preference-center:conflicting-retry',
        recordedAt: '2026-08-20T04:01:00.000Z',
        sourceEvidence: ['preference-center:optout:001'],
      }),
    ).rejects.toThrow('PRIVACY_IDEMPOTENCY_CONFLICT');

    const decision = await service.resolveCommunicationPolicy({
      context: context('policy-after-optout'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
    });
    expect(decision.state).toBe('BLOCKED');
    expect(decision.reasons).toContain('OPT_OUT_ACTIVE');
  });

  it('records explicit suppression and blocks communication independently of older allow preference', async () => {
    const { service } = createCommunicationService();
    await seedAllowableMarketingState(service);

    await service.suppress({
      context: context('manual-suppression'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
      reason: 'LEGAL',
      policyRef: purpose.policyRef,
      sourceRef: 'legal-review:suppression:001',
      recordedAt: '2026-08-20T04:02:00.000Z',
      sourceEvidence: ['legal-review:suppression:001'],
    });

    const decision = await service.resolveCommunicationPolicy({
      context: context('policy-after-suppression'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
    });
    expect(decision.state).toBe('BLOCKED');
    expect(decision.reasons).toContain('SUPPRESSION_ACTIVE');
  });

  it('reconciles provider unsubscribe into canonical suppression without sending anything', async () => {
    const { service, store } = createCommunicationService();
    await seedAllowableMarketingState(service);

    await service.reconcileProviderConsent({
      context: context('provider-unsubscribe'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
      policyRef: purpose.policyRef,
      observation: {
        provider: 'email-provider',
        providerSubjectRef: 'provider-subject:opaque:002',
        state: 'UNSUBSCRIBED',
        observedAt: '2026-08-20T04:03:00.000Z',
        providerEvidenceRef: 'provider-readback:unsubscribe:001',
      },
      sourceEvidence: ['provider-readback:unsubscribe:001'],
    });

    const history = await store.listForSubject(purpose, subjectRef);
    expect(history.some((event) => event.eventType === 'PROVIDER_CONSENT_RECONCILED')).toBe(true);
    expect(
      history.some(
        (event) =>
          event.eventType === 'SUPPRESSION_RECORDED' &&
          event.payload.reason === 'PROVIDER_UNSUBSCRIBED',
      ),
    ).toBe(true);

    const decision = await service.resolveCommunicationPolicy({
      context: context('policy-after-provider-unsubscribe'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
    });
    expect(decision.state).toBe('BLOCKED');
    expect(decision.reasons).toContain('SUPPRESSION_ACTIVE');
    expect(decision.reasons).toContain('PROVIDER_UNSUBSCRIBED');
  });

  it('applies PII classification, access control and minimum-necessary field minimization', async () => {
    const { service } = createCommunicationService();

    const minimized = await service.evaluatePiiAccess({
      context: context('pii-minimized'),
      subjectRef,
      purposeId: purpose.purposeId,
      policyRef: purpose.policyRef,
      classification: 'PERSONAL',
      requestedFields: ['firstName', 'emailHash', 'phoneHash'],
      minimumNecessaryFields: ['firstName', 'emailHash'],
      authorization: {
        state: 'AUTHORIZED',
        decisionRef: 'authorization:privacy:001',
        allowedClassifications: ['PERSONAL'],
        allowedFields: ['firstName', 'emailHash'],
      },
      sourceEvidence: ['authorization:privacy:001'],
    });

    expect(minimized).toEqual({
      state: 'MINIMIZED',
      allowed: true,
      classification: 'PERSONAL',
      exposedFields: ['emailHash', 'firstName'],
      omittedFields: ['phoneHash'],
      reasons: ['PII_FIELDS_MINIMIZED'],
    });

    const unknown = await service.evaluatePiiAccess({
      context: context('pii-unknown-auth'),
      subjectRef,
      purposeId: purpose.purposeId,
      policyRef: purpose.policyRef,
      classification: 'SENSITIVE',
      requestedFields: ['sensitiveAttribute'],
      minimumNecessaryFields: ['sensitiveAttribute'],
      authorization: {
        state: 'UNKNOWN',
        decisionRef: null,
        allowedClassifications: [],
        allowedFields: [],
      },
      sourceEvidence: ['authorization:unknown:001'],
    });

    expect(unknown).toMatchObject({
      state: 'UNKNOWN_BLOCKED',
      allowed: false,
      reasons: ['PII_AUTHORIZATION_UNKNOWN'],
    });
  });

  it('rejects raw provider PII from privacy evidence and identifiers', async () => {
    const { service } = createCommunicationService();

    await expect(
      service.reconcileProviderConsent({
        context: context('provider-raw-pii'),
        subjectRef,
        purposeId: purpose.purposeId,
        channel: 'email',
        policyRef: purpose.policyRef,
        observation: {
          provider: 'email-provider',
          providerSubjectRef: 'person@example.com',
          state: 'UNSUBSCRIBED',
          observedAt: '2026-08-20T04:04:00.000Z',
          providerEvidenceRef: 'provider-readback:raw-pii:001',
        },
        sourceEvidence: ['provider-readback:raw-pii:001'],
      }),
    ).rejects.toThrow('PRIVACY_SUBJECT_REF_NOT_OPAQUE');
  });
});
