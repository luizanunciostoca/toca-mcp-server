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
  consent: {
    ...scope,
    decisionId: 'consent-1',
    purpose: 'event-updates',
    channel: 'WHATSAPP',
    status: 'GRANTED',
  },
  suppression: {
    ...scope,
    decisionId: 'suppression-1',
    channel: 'WHATSAPP',
    suppressed: false,
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
  purpose: 'event-updates',
  resolvedContactCount: 10,
  ambiguousContactCount: 0,
  unresolvedContactCount: 0,
  consentUnknownCount: 0,
  consentDeniedCount: 0,
  suppressedCount: 0,
  policyDeniedCount: 0,
};

describe('omnichannel outbound eligibility', () => {
  it('accepts only a fully resolved, consented, unsuppressed and approved contact', () => {
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

  it('fails closed for unknown consent', () => {
    expect(() =>
      assertOutboundEligibility({
        ...eligible,
        consent: { ...eligible.consent, status: 'UNKNOWN' },
      }),
    ).toThrow('OMNICHANNEL_CONSENT_NOT_GRANTED');
  });

  it('fails closed for suppression and policy denial', () => {
    expect(() =>
      assertOutboundEligibility({
        ...eligible,
        suppression: { ...eligible.suppression, suppressed: true },
      }),
    ).toThrow('OMNICHANNEL_RECIPIENT_SUPPRESSED');

    expect(() =>
      assertOutboundEligibility({
        ...eligible,
        policy: { ...eligible.policy, allowed: false },
      }),
    ).toThrow('OMNICHANNEL_POLICY_DENIED');
  });

  it('requires an active approval when the operation requires approval', () => {
    const withoutApproval: OutboundEligibilityContext = {
      ...scope,
      channel: eligible.channel,
      contact: eligible.contact,
      consent: eligible.consent,
      suppression: eligible.suppression,
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

  it('rejects cross-tenant or cross-correlation proof reuse', () => {
    expect(() =>
      assertOutboundEligibility({
        ...eligible,
        consent: { ...eligible.consent, tenantId: 'tenant-2' },
      }),
    ).toThrow('OMNICHANNEL_CONSENT_SCOPE_MISMATCH');
  });
});

describe('omnichannel audience and provider guards', () => {
  it('accepts an audience snapshot only when every recipient passed the gates', () => {
    expect(() => assertAudienceEligibilitySnapshot(audience)).not.toThrow();
    expect(() =>
      assertAudienceEligibilitySnapshot({ ...audience, consentUnknownCount: 1 }),
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
