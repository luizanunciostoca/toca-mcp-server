import { describe, expect, it } from 'vitest';
import {
  assertAudienceEligibilitySnapshot,
  assertOutboundEligibility,
  assertProductionProviderBinding,
  type AudienceEligibilitySnapshot,
  type OutboundEligibilityContext,
} from '../src/omnichannel/contracts.js';

const scope = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  organizationId: 'org-1',
  correlationId: 'corr-1',
} as const;

const eligible: OutboundEligibilityContext = {
  ...scope,
  channel: 'WHATSAPP',
  contact: {
    ...scope,
    contactRecordId: 'contact-1',
    resolutionId: 'resolution-1',
    status: 'RESOLVED',
  },
  privacy: {
    ...scope,
    executionId: 'privacy-execution-1',
    subjectRef: 'subject-ref-opaque-1',
    decision: {
      state: 'ALLOWED',
      blocked: false,
      reasons: [],
      purposeId: 'event-updates',
      channel: 'WHATSAPP',
    },
  },
  policy: {
    ...scope,
    decisionId: 'policy-1',
    allowed: true,
  },
  approval: {
    ...scope,
    approvalId: 'approval-1',
    status: 'APPROVED',
  },
};

const audience: AudienceEligibilitySnapshot = {
  ...scope,
  snapshotId: 'audience-1',
  purposeId: 'event-updates',
  resolvedContactCount: 10,
  ambiguousContactCount: 0,
  unresolvedContactCount: 0,
  privacyUnknownBlockedCount: 0,
  privacySuppressedCount: 0,
  policyDeniedCount: 0,
};

describe('omnichannel outbound eligibility', () => {
  it('accepts only a fully resolved contact with canonical Privacy ALLOWED and approval', () => {
    expect(() => assertOutboundEligibility(eligible)).not.toThrow();
  });

  it('fails closed for ambiguous or unresolved identity', () => {
    expect(() =>
      assertOutboundEligibility({
        ...eligible,
        contact: { ...eligible.contact, contactRecordId: null, status: 'AMBIGUOUS' },
      }),
    ).toThrow('OMNICHANNEL_CONTACT_NOT_RESOLVED');
  });

  it('fails closed for canonical Privacy UNKNOWN_BLOCKED', () => {
    expect(() =>
      assertOutboundEligibility({
        ...eligible,
        privacy: {
          ...eligible.privacy,
          decision: {
            ...eligible.privacy.decision,
            state: 'UNKNOWN_BLOCKED',
            blocked: true,
            reasons: ['CONSENT_UNKNOWN'],
          },
        },
      }),
    ).toThrow('OMNICHANNEL_PRIVACY_UNKNOWN_BLOCKED');
  });

  it('fails closed for canonical Privacy suppression and policy denial', () => {
    expect(() =>
      assertOutboundEligibility({
        ...eligible,
        privacy: {
          ...eligible.privacy,
          decision: {
            ...eligible.privacy.decision,
            state: 'SUPPRESSED',
            blocked: true,
            reasons: ['CONSENT_REVOKED'],
          },
        },
      }),
    ).toThrow('OMNICHANNEL_PRIVACY_SUPPRESSED');

    expect(() =>
      assertOutboundEligibility({
        ...eligible,
        policy: { ...eligible.policy, allowed: false },
      }),
    ).toThrow('OMNICHANNEL_POLICY_DENIED');
  });

  it('fails closed when a Privacy decision is reused for another channel', () => {
    expect(() =>
      assertOutboundEligibility({
        ...eligible,
        privacy: {
          ...eligible.privacy,
          decision: { ...eligible.privacy.decision, channel: 'EMAIL' },
        },
      }),
    ).toThrow('OMNICHANNEL_PRIVACY_CHANNEL_MISMATCH');
  });

  it('requires an active approval when the operation requires approval', () => {
    const withoutApproval: OutboundEligibilityContext = {
      ...scope,
      channel: eligible.channel,
      contact: eligible.contact,
      privacy: eligible.privacy,
      policy: eligible.policy,
    };
    expect(() => assertOutboundEligibility(withoutApproval)).toThrow(
      'OMNICHANNEL_APPROVAL_REQUIRED',
    );
    expect(() =>
      assertOutboundEligibility({
        ...eligible,
        approval: { ...eligible.approval!, status: 'REVOKED' },
      }),
    ).toThrow('OMNICHANNEL_APPROVAL_NOT_ACTIVE');
  });

  it('rejects cross-tenant or cross-correlation Privacy proof reuse', () => {
    expect(() =>
      assertOutboundEligibility({
        ...eligible,
        privacy: { ...eligible.privacy, tenantId: 'tenant-2' },
      }),
    ).toThrow('OMNICHANNEL_PRIVACY_SCOPE_MISMATCH');
  });
});

describe('omnichannel audience and provider guards', () => {
  it('accepts an audience snapshot only when every recipient passed canonical Privacy', () => {
    expect(() => assertAudienceEligibilitySnapshot(audience)).not.toThrow();
    expect(() =>
      assertAudienceEligibilitySnapshot({ ...audience, privacyUnknownBlockedCount: 1 }),
    ).toThrow('OMNICHANNEL_AUDIENCE_NOT_ELIGIBLE');
    expect(() =>
      assertAudienceEligibilitySnapshot({ ...audience, privacySuppressedCount: 1 }),
    ).toThrow('OMNICHANNEL_AUDIENCE_NOT_ELIGIBLE');
    expect(() =>
      assertAudienceEligibilitySnapshot({ ...audience, ambiguousContactCount: 1 }),
    ).toThrow('OMNICHANNEL_AUDIENCE_NOT_ELIGIBLE');
  });

  it('does not treat a connected provider as production validated', () => {
    expect(() =>
      assertProductionProviderBinding({
        providerKey: 'provider-1',
        bindingId: 'binding-1',
        state: 'CONNECTED',
      }),
    ).toThrow('OMNICHANNEL_PROVIDER_NOT_PRODUCTION_VALIDATED');

    expect(() =>
      assertProductionProviderBinding({
        providerKey: 'provider-1',
        bindingId: 'binding-1',
        state: 'PRODUCTION_VALIDATED',
      }),
    ).not.toThrow();
  });
});
