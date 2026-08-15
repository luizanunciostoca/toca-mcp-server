import type { ExecutionIdentity } from '../core/identity.js';
import type { ContactRecord, CrmCoreStore, CrmScope } from '../crm/crm-records.js';
import type {
  LegalBasisClass,
  PrivacyExecutionContext,
  PrivacyGovernanceService,
  PrivacyLedgerEvent,
  PrivacyLedgerStore,
} from '../privacy/index.js';

export const OMNICHANNEL_PRIVACY_CHANNELS = ['WHATSAPP', 'EMAIL'] as const;
export type OmnichannelPrivacyChannel = (typeof OMNICHANNEL_PRIVACY_CHANNELS)[number];

/**
 * Temporary compatibility seam only.
 *
 * It MUST be backed by the canonical CRM <-> Privacy subject binding once that
 * binding is available. It deliberately has no persistence API and must never
 * infer a subject reference from raw personal data.
 */
export interface PrivacySubjectRefResolution extends CrmScope {
  readonly status: 'RESOLVED' | 'NOT_FOUND' | 'AMBIGUOUS';
  readonly contactRecordId: ContactRecord['contactId'];
  readonly subjectRef: string | null;
  readonly evidence: readonly string[];
}

export interface PrivacySubjectRefLookup {
  resolve(
    input: CrmScope & { readonly contactRecordId: ContactRecord['contactId'] },
  ): Promise<PrivacySubjectRefResolution>;
}

export interface OmnichannelPrivacyCompatibilityDependencies {
  readonly crm: Pick<CrmCoreStore, 'getContact'>;
  readonly privacy: PrivacyGovernanceService;
  readonly privacyStore: PrivacyLedgerStore;
  readonly subjectRefs: PrivacySubjectRefLookup;
}

export interface OutboundPrivacyEligibilityProof extends CrmScope {
  readonly requesterPrincipalId: string;
  readonly contactRecordId: ContactRecord['contactId'];
  readonly subjectRef: string;
  readonly purposeId: string;
  readonly channel: OmnichannelPrivacyChannel;
  readonly privacyChannel: 'whatsapp' | 'email';
  readonly legalBasisClass: LegalBasisClass;
  readonly consentRequired: boolean;
  readonly preferenceRequired: boolean;
  readonly purposeDecisionEventId: string;
  readonly suppressionDecisionEventId: string;
  readonly legalBasisEventId: string;
  readonly consentEventId: string | null;
  readonly preferenceEventId: string | null;
  readonly retentionEventId: string | null;
  readonly evidence: readonly string[];
}

export async function proveOutboundPrivacyEligibility(
  deps: OmnichannelPrivacyCompatibilityDependencies,
  input: {
    readonly identity: ExecutionIdentity;
    readonly contactRecordId: ContactRecord['contactId'];
    readonly purposeId: string;
    readonly channel: OmnichannelPrivacyChannel;
    readonly preferenceRequired: boolean;
    readonly executionId: string;
    readonly correlationId: string;
    readonly evidence: readonly string[];
  },
): Promise<OutboundPrivacyEligibilityProof> {
  const scope = scopeFromIdentity(input.identity);
  const contactRecordId = requireText(input.contactRecordId, 'OMNICHANNEL_CONTACT_ID_REQUIRED');
  const purposeId = requireText(input.purposeId, 'OMNICHANNEL_PURPOSE_REQUIRED');
  const executionId = requireText(input.executionId, 'OMNICHANNEL_EXECUTION_ID_REQUIRED');
  const correlationId = requireText(input.correlationId, 'OMNICHANNEL_CORRELATION_ID_REQUIRED');
  const evidence = requireEvidence(input.evidence, 'OMNICHANNEL_EVIDENCE_REQUIRED');

  const contact = await deps.crm.getContact({ ...scope, contactId: contactRecordId });
  if (!contact) throw new Error('OMNICHANNEL_CONTACT_NOT_FOUND');
  assertScopeMatch(scope, contact, 'CONTACT');
  if (contact.status !== 'ACTIVE') throw new Error('OMNICHANNEL_CONTACT_NOT_ACTIVE');

  const subject = await deps.subjectRefs.resolve({ ...scope, contactRecordId });
  if (subject.status === 'AMBIGUOUS') throw new Error('OMNICHANNEL_PRIVACY_SUBJECT_AMBIGUOUS');
  if (subject.status !== 'RESOLVED' || !subject.subjectRef?.trim()) {
    throw new Error('OMNICHANNEL_PRIVACY_SUBJECT_NOT_FOUND');
  }
  assertScopeMatch(scope, subject, 'PRIVACY_SUBJECT');
  if (subject.contactRecordId !== contactRecordId) {
    throw new Error('OMNICHANNEL_PRIVACY_SUBJECT_CONTACT_MISMATCH');
  }

  const privacyChannel = toPrivacyChannel(input.channel);
  const privacyContext: PrivacyExecutionContext = {
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    organizationId: scope.organizationId,
    requester: input.identity.principal.principalId,
    executionId,
    correlationId,
    evidence: mergeEvidence(
      evidence,
      input.identity.principal.evidence,
      input.identity.authorization.evidence,
      subject.evidence,
    ),
  };

  const purpose = await deps.privacy.resolvePurpose({
    context: privacyContext,
    subjectRef: subject.subjectRef,
    purposeId,
  });
  if (purpose.blocked || purpose.state !== 'KNOWN') {
    throw new Error(`OMNICHANNEL_PRIVACY_PURPOSE_BLOCKED:${purpose.reasons.join(',')}`);
  }

  const decision = await deps.privacy.checkSuppression({
    context: privacyContext,
    subjectRef: subject.subjectRef,
    purposeId,
    channel: privacyChannel,
    preferenceRequired: input.preferenceRequired,
  });
  if (decision.blocked || decision.state !== 'ALLOWED') {
    throw new Error(`OMNICHANNEL_PRIVACY_BLOCKED:${decision.state}:${decision.reasons.join(',')}`);
  }

  const events = await deps.privacyStore.listForSubject(scope.tenantId, subject.subjectRef);
  const purposeDecision = findExecutionEvent(events, {
    eventType: 'PURPOSE_RESOLVED',
    executionId,
    correlationId,
    purposeId,
    channel: null,
  });
  const suppressionDecision = findExecutionEvent(events, {
    eventType: 'SUPPRESSION_CHECKED',
    executionId,
    correlationId,
    purposeId,
    channel: privacyChannel,
  });
  const legalBasis = latestEvent(
    events,
    (event) => event.eventType === 'LEGAL_BASIS_RECORDED' && event.purposeId === purposeId,
  );
  if (!legalBasis) throw new Error('OMNICHANNEL_PRIVACY_LEGAL_BASIS_PROOF_MISSING');
  const legalBasisClass = legalBasis.payload.basisClass;
  if (legalBasisClass !== 'CONSENT' && legalBasisClass !== 'OTHER_EXPLICIT_BASIS') {
    throw new Error('OMNICHANNEL_PRIVACY_LEGAL_BASIS_CLASS_INVALID');
  }

  const consentRequired = legalBasisClass === 'CONSENT';
  const consent = consentRequired
    ? latestEvent(
        events,
        (event) =>
          event.purposeId === purposeId &&
          event.channel === privacyChannel &&
          (event.eventType === 'CONSENT_RECORDED' || event.eventType === 'CONSENT_REVOKED'),
      )
    : undefined;
  if (consentRequired && !consent) throw new Error('OMNICHANNEL_PRIVACY_CONSENT_PROOF_MISSING');

  const preference = input.preferenceRequired
    ? latestEvent(
        events,
        (event) =>
          event.eventType === 'PREFERENCE_UPDATED' &&
          event.purposeId === purposeId &&
          event.channel === privacyChannel,
      )
    : undefined;
  if (input.preferenceRequired && !preference) {
    throw new Error('OMNICHANNEL_PRIVACY_PREFERENCE_PROOF_MISSING');
  }

  const retention = latestEvent(
    events,
    (event) => event.eventType === 'RETENTION_APPLIED' && event.purposeId === purposeId,
  );

  return {
    ...scope,
    requesterPrincipalId: input.identity.principal.principalId,
    contactRecordId,
    subjectRef: subject.subjectRef,
    purposeId,
    channel: input.channel,
    privacyChannel,
    legalBasisClass,
    consentRequired,
    preferenceRequired: input.preferenceRequired,
    purposeDecisionEventId: purposeDecision.eventId,
    suppressionDecisionEventId: suppressionDecision.eventId,
    legalBasisEventId: legalBasis.eventId,
    consentEventId: consent?.eventId ?? null,
    preferenceEventId: preference?.eventId ?? null,
    retentionEventId: retention?.eventId ?? null,
    evidence: mergeEvidence(
      privacyContext.evidence,
      purposeDecision.evidence,
      suppressionDecision.evidence,
      legalBasis.evidence,
      consent?.evidence ?? [],
      preference?.evidence ?? [],
      retention?.evidence ?? [],
    ),
  };
}

function scopeFromIdentity(identity: ExecutionIdentity): CrmScope {
  const principalId = requireText(identity.principal.principalId, 'OMNICHANNEL_REQUESTER_REQUIRED');
  if (identity.authorization.principalId !== principalId) {
    throw new Error('OMNICHANNEL_AUTHORIZATION_PRINCIPAL_MISMATCH');
  }
  const tenantId = requireText(identity.principal.tenantId, 'OMNICHANNEL_TENANT_ID_REQUIRED');
  if (identity.authorization.tenantId !== tenantId) {
    throw new Error('OMNICHANNEL_AUTHORIZATION_TENANT_MISMATCH');
  }
  return {
    tenantId,
    workspaceId: requireText(
      identity.principal.workspaceId,
      'OMNICHANNEL_WORKSPACE_ID_REQUIRED',
    ),
    organizationId: requireText(
      identity.principal.organizationId,
      'OMNICHANNEL_ORGANIZATION_ID_REQUIRED',
    ),
  };
}

function toPrivacyChannel(channel: OmnichannelPrivacyChannel): 'whatsapp' | 'email' {
  if (channel === 'WHATSAPP') return 'whatsapp';
  if (channel === 'EMAIL') return 'email';
  throw new Error('OMNICHANNEL_CHANNEL_INVALID');
}

function assertScopeMatch(expected: CrmScope, actual: CrmScope, component: string): void {
  if (
    expected.tenantId !== actual.tenantId ||
    expected.workspaceId !== actual.workspaceId ||
    expected.organizationId !== actual.organizationId
  ) {
    throw new Error(`OMNICHANNEL_${component}_SCOPE_MISMATCH`);
  }
}

function findExecutionEvent(
  events: readonly PrivacyLedgerEvent[],
  expected: {
    readonly eventType: PrivacyLedgerEvent['eventType'];
    readonly executionId: string;
    readonly correlationId: string;
    readonly purposeId: string;
    readonly channel: string | null;
  },
): PrivacyLedgerEvent {
  const matches = events.filter(
    (event) =>
      event.eventType === expected.eventType &&
      event.executionId === expected.executionId &&
      event.correlationId === expected.correlationId &&
      event.purposeId === expected.purposeId &&
      event.channel === expected.channel,
  );
  if (matches.length !== 1) {
    throw new Error(`OMNICHANNEL_PRIVACY_DECISION_PROOF_INVALID:${expected.eventType}`);
  }
  return matches[0]!;
}

function latestEvent(
  events: readonly PrivacyLedgerEvent[],
  predicate: (event: PrivacyLedgerEvent) => boolean,
): PrivacyLedgerEvent | undefined {
  return events.filter(predicate).at(-1);
}

function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

function requireEvidence(values: readonly string[], errorCode: string): readonly string[] {
  const evidence = mergeEvidence(values);
  if (evidence.length === 0) throw new Error(errorCode);
  return evidence;
}

function mergeEvidence(...sources: readonly (readonly string[])[]): readonly string[] {
  return [...new Set(sources.flat().map((value) => value.trim()).filter(Boolean))].sort();
}
