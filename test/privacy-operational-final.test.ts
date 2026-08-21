import { describe, expect, it } from 'vitest';
import { CanonicalOutboundPrivacyRevalidationPort } from '../src/omnichannel/privacy-runtime-gate.js';
import {
  context,
  createService,
  purpose,
  seedAllowableMarketingState,
  subjectRef,
  tenantId,
  workspaceId,
  organizationId,
} from './privacy-governance-fixtures.js';

const communicationPurpose = {
  ...purpose,
  communication: {
    channels: ['email'],
    consentRequired: true,
    preferenceRequired: true,
    prohibited: false,
    validUntil: null,
  },
} as const;

function gateInput(executionId: string) {
  return {
    tenantId,
    workspaceId,
    organizationId,
    channel: 'EMAIL' as const,
    privacyChannel: 'email',
    subjectRef,
    purposeId: purpose.purposeId,
    requester: 'principal:email-runtime',
    executionId,
    correlationId: `corr:${executionId}`,
    evidence: [`scheduled-followup:${executionId}`],
  };
}

describe('Privacy / LGPD final operational regressions', () => {
  it('blocks a scheduled follow-up when consent is revoked after the original eligibility decision', async () => {
    const { service } = createService([communicationPurpose]);
    await seedAllowableMarketingState(service);
    const gate = new CanonicalOutboundPrivacyRevalidationPort(service);

    const before = await gate.revalidate(gateInput('followup-before-revoke'));
    expect(before.state).toBe('ALLOWED');

    await service.revokeConsent({
      context: context('followup-consent-revoked'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
      policyRef: purpose.policyRef,
      revokedAt: '2026-08-20T12:00:00.000Z',
      sourceEvidence: ['preference-center:revocation-confirmed'],
    });

    const after = await gate.revalidate(gateInput('followup-wakeup-after-revoke'));
    expect(after.allowed).toBe(false);
    expect(after.blocked).toBe(true);
    expect(after.reasons).toContain('CONSENT_REVOKED');
  });

  it.each(['UNSUBSCRIBED', 'COMPLAINT'] as const)(
    'blocks Email after provider state %s is reconciled into canonical Privacy',
    async (providerState) => {
      const { service } = createService([communicationPurpose]);
      await seedAllowableMarketingState(service);
      const gate = new CanonicalOutboundPrivacyRevalidationPort(service);

      await service.reconcileProviderConsent({
        context: context(`provider-${providerState.toLowerCase()}`),
        subjectRef,
        purposeId: purpose.purposeId,
        channel: 'email',
        policyRef: purpose.policyRef,
        observation: {
          provider: 'twilio-sendgrid',
          providerSubjectRef: `sha256:${'a'.repeat(64)}`,
          state: providerState,
          observedAt: '2026-08-20T12:10:00.000Z',
          providerEvidenceRef: `sendgrid:event:${providerState.toLowerCase()}`,
        },
        sourceEvidence: ['sendgrid:event-webhook:signature-valid'],
      });

      const decision = await gate.revalidate(
        gateInput(`email-after-${providerState.toLowerCase()}`),
      );
      expect(decision.allowed).toBe(false);
      expect(decision.blocked).toBe(true);
      expect(decision.reasons).toContain(`PROVIDER_${providerState}`);
      expect(decision.reasons).toContain('SUPPRESSION_ACTIVE');
    },
  );

  it('deduplicates a repeated provider privacy event by execution/capability and preserves one canonical event', async () => {
    const { service, store } = createService([communicationPurpose]);
    await seedAllowableMarketingState(service);
    const input = {
      context: context('duplicate-provider-privacy-event'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
      policyRef: purpose.policyRef,
      observation: {
        provider: 'twilio-sendgrid',
        providerSubjectRef: `sha256:${'b'.repeat(64)}`,
        state: 'UNSUBSCRIBED' as const,
        observedAt: '2026-08-20T12:20:00.000Z',
        providerEvidenceRef: 'sendgrid:event:duplicate-1',
      },
      sourceEvidence: ['sendgrid:event-webhook:signature-valid'],
    };

    const first = await service.reconcileProviderConsent(input);
    const second = await service.reconcileProviderConsent(input);
    expect(second.eventId).toBe(first.eventId);

    const events = await store.listForSubject(
      { tenantId, workspaceId, organizationId },
      subjectRef,
    );
    expect(
      events.filter((event) => event.eventType === 'PROVIDER_CONSENT_RECONCILED'),
    ).toHaveLength(1);
    expect(events.filter((event) => event.eventType === 'SUPPRESSION_RECORDED')).toHaveLength(1);
  });

  it('treats ANONYMIZE retention as destructive and suppresses further purpose use with audit evidence', async () => {
    const { service, auditSink } = createService([communicationPurpose]);
    await seedAllowableMarketingState(service);

    const result = await service.applyRetention({
      context: context('retention-anonymize'),
      subjectRef,
      purposeId: purpose.purposeId,
      action: 'ANONYMIZE',
      subjectBindingRef: 'crm-subject-binding:001',
      policyRef: 'drive://privacy/retention-v1',
      reason: 'Retention policy selected anonymization for expired marketing data.',
      sourceEvidence: ['retention-policy-evaluation:anonymize'],
    });
    expect(result.destructiveExecutionRequired).toBe(true);
    expect(result.event.payload.action).toBe('ANONYMIZE');

    const suppression = await service.checkSuppression({
      context: context('retention-anonymize-suppression'),
      subjectRef,
      purposeId: purpose.purposeId,
      channel: 'email',
      preferenceRequired: true,
    });
    expect(suppression.state).toBe('SUPPRESSED');
    expect(suppression.reasons).toContain('RETENTION_SUPPRESSES_USE');
    expect(auditSink.list().some((event) => event.executionId === 'retention-anonymize')).toBe(
      true,
    );
    expect(JSON.stringify(auditSink.list())).not.toContain(subjectRef);
  });
});
