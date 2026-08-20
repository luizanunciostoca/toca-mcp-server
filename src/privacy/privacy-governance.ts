import type {
  AutomatedDecisionEvidence,
  AutomatedDecisionExplanation,
  CommunicationPolicyDecision,
  PiiAccessDecision,
  PiiAuthorizationDecision,
  PiiClassification,
  PrivacyContactReference,
  PrivacyExecutionContext,
  PrivacyLedgerEvent,
  ProfilingEvidence,
  ProfilingReview,
  ProviderConsentObservation,
  ProviderConsentState,
  SuppressionReason,
} from './contracts.js';
import { PrivacyGovernanceRights } from './privacy-governance-rights.js';
import {
  assertContext,
  latest,
  latestConsentTransition,
  requireEvidence,
  requireOpaqueSubjectRef,
  requireSafeText,
  requireText,
  requireTimestamp,
  scopeFromContext,
  unique,
} from './privacy-governance-helpers.js';

const IDENTITY_STATES = ['RESOLVED', 'AMBIGUOUS', 'UNKNOWN'] as const;
const PROVIDER_CONSENT_STATES: readonly ProviderConsentState[] = [
  'OPTED_IN',
  'OPTED_OUT',
  'UNSUBSCRIBED',
  'BOUNCED',
  'COMPLAINT',
  'UNKNOWN',
];
const SUPPRESSING_PROVIDER_STATES: readonly ProviderConsentState[] = [
  'OPTED_OUT',
  'UNSUBSCRIBED',
  'BOUNCED',
  'COMPLAINT',
];
const PII_CLASSIFICATIONS: readonly PiiClassification[] = [
  'PUBLIC',
  'INTERNAL',
  'PERSONAL',
  'SENSITIVE',
];

export class PrivacyGovernanceService extends PrivacyGovernanceRights {
  async canContact(input: {
    readonly context: PrivacyExecutionContext;
    readonly contact: PrivacyContactReference;
    readonly channel: string;
    readonly purposeId: string;
  }): Promise<CommunicationPolicyDecision> {
    assertContext(input.context);
    const channel = requireSafeText(input.channel, 'PRIVACY_CHANNEL_REQUIRED');
    const purposeId = requireText(input.purposeId, 'PRIVACY_PURPOSE_REQUIRED');
    const identityState = IDENTITY_STATES.includes(input.contact.identityState)
      ? input.contact.identityState
      : 'UNKNOWN';

    if (identityState !== 'RESOLVED' || !input.contact.subjectRef) {
      const reason = identityState === 'AMBIGUOUS' ? 'IDENTITY_AMBIGUOUS' : 'IDENTITY_UNKNOWN';
      await this.audit(input.context, 'privacy.communication.resolve', 'DENIED', null, [
        ...input.context.evidence,
        `privacy:communication:${reason}`,
      ]);
      return {
        state: identityState === 'AMBIGUOUS' ? 'BLOCKED' : 'UNKNOWN_BLOCKED',
        allowed: false,
        blocked: true,
        reasons: [reason],
        purposeId,
        channel,
        policyRef: null,
      };
    }

    return this.resolveCommunicationPolicy({
      context: input.context,
      subjectRef: input.contact.subjectRef,
      channel,
      purposeId,
    });
  }

  async resolveCommunicationPolicy(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly channel: string;
    readonly purposeId: string;
  }): Promise<CommunicationPolicyDecision> {
    assertContext(input.context);
    const scope = scopeFromContext(input.context);
    const subjectRef = requireOpaqueSubjectRef(input.subjectRef);
    const channel = requireSafeText(input.channel, 'PRIVACY_CHANNEL_REQUIRED');
    const purposeId = requireText(input.purposeId, 'PRIVACY_PURPOSE_REQUIRED');
    const purpose = await this.deps.purposeRegistry.resolve(scope, purposeId);
    const reasons: string[] = [];
    let state: CommunicationPolicyDecision['state'] = 'ALLOWED';

    if (!purpose?.active) {
      state = 'UNKNOWN_BLOCKED';
      reasons.push(purpose ? 'PURPOSE_INACTIVE' : 'PURPOSE_UNKNOWN');
    }

    const communication = purpose?.communication;
    if (purpose?.active && !communication) {
      state = 'UNKNOWN_BLOCKED';
      reasons.push('COMMUNICATION_POLICY_UNKNOWN');
    }

    if (communication) {
      const allowedChannels = unique(
        communication.channels.map((value) =>
          requireSafeText(value, 'PRIVACY_COMMUNICATION_CHANNEL_INVALID'),
        ),
      );
      if (communication.prohibited) {
        state = 'BLOCKED';
        reasons.push('PURPOSE_PROHIBITED');
      }
      if (allowedChannels.length === 0) {
        if (state !== 'BLOCKED') state = 'UNKNOWN_BLOCKED';
        reasons.push('COMMUNICATION_CHANNELS_UNKNOWN');
      } else if (!allowedChannels.includes(channel)) {
        state = 'BLOCKED';
        reasons.push('CHANNEL_NOT_ALLOWED_FOR_PURPOSE');
      }
      if (communication.validUntil) {
        const validUntil = Date.parse(communication.validUntil);
        if (!Number.isFinite(validUntil)) {
          if (state !== 'BLOCKED') state = 'UNKNOWN_BLOCKED';
          reasons.push('PERMISSION_EXPIRY_INVALID');
        } else if (validUntil <= Date.now()) {
          state = 'BLOCKED';
          reasons.push('PERMISSION_EXPIRED');
        }
      }
    }

    if (purpose?.active && communication) {
      const events = await this.deps.store.listForSubject(scope, subjectRef);
      const explicitSuppression = latest(
        events,
        (event) =>
          event.eventType === 'SUPPRESSION_RECORDED' &&
          event.purposeId === purposeId &&
          event.channel === channel,
      );
      if (explicitSuppression) {
        state = 'BLOCKED';
        reasons.push('SUPPRESSION_ACTIVE');
      }

      const optOut = latest(
        events,
        (event) =>
          event.eventType === 'OPT_OUT_RECORDED' &&
          event.purposeId === purposeId &&
          event.channel === channel,
      );
      if (optOut) {
        state = 'BLOCKED';
        reasons.push('OPT_OUT_ACTIVE');
      }

      const providerConsent = latest(
        events,
        (event) =>
          event.eventType === 'PROVIDER_CONSENT_RECONCILED' &&
          event.purposeId === purposeId &&
          event.channel === channel,
      );
      if (providerConsent) {
        const providerState = providerConsent.payload.state;
        if (!isProviderConsentState(providerState)) {
          if (state !== 'BLOCKED') state = 'UNKNOWN_BLOCKED';
          reasons.push('PROVIDER_CONSENT_STATE_INVALID');
        } else if (providerState === 'UNKNOWN') {
          if (state !== 'BLOCKED') state = 'UNKNOWN_BLOCKED';
          reasons.push('PROVIDER_CONSENT_UNKNOWN');
        } else if (SUPPRESSING_PROVIDER_STATES.includes(providerState)) {
          state = 'BLOCKED';
          reasons.push(`PROVIDER_${providerState}`);
        }
      }

      const suppression = await this.checkSuppression({
        context: input.context,
        subjectRef,
        purposeId,
        channel,
        preferenceRequired: communication.preferenceRequired,
      });
      reasons.push(...suppression.reasons);
      if (suppression.state === 'SUPPRESSED') {
        state = 'BLOCKED';
      } else if (suppression.state === 'UNKNOWN_BLOCKED' && state !== 'BLOCKED') {
        state = 'UNKNOWN_BLOCKED';
      }

      if (communication.consentRequired) {
        const consent = latestConsentTransition(events, purposeId, channel);
        if (!consent) {
          if (state !== 'BLOCKED') state = 'UNKNOWN_BLOCKED';
          reasons.push('CONSENT_UNKNOWN');
        } else if (consent.eventType === 'CONSENT_REVOKED') {
          state = 'BLOCKED';
          reasons.push('CONSENT_REVOKED');
        } else if (consent.payload.state !== 'GRANTED') {
          state = 'BLOCKED';
          reasons.push('CONSENT_NOT_GRANTED');
        }
      }
    }

    const decision: CommunicationPolicyDecision = {
      state,
      allowed: state === 'ALLOWED',
      blocked: state !== 'ALLOWED',
      reasons: unique(reasons),
      purposeId,
      channel,
      policyRef: purpose?.policyRef ?? null,
    };
    await this.append({
      context: input.context,
      subjectRef,
      requestId: null,
      purposeId,
      channel,
      policyRef: purpose?.policyRef ?? null,
      approvalId: null,
      capabilityId: 'privacy.communication.resolve',
      eventType: 'COMMUNICATION_POLICY_RESOLVED',
      payload: { ...decision },
      extraEvidence: purpose?.evidence ?? [],
    });
    return decision;
  }

  async recordOptOut(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly purposeId: string;
    readonly channel: string;
    readonly policyRef: string;
    readonly sourceRef: string;
    readonly recordedAt: string;
    readonly sourceEvidence: readonly string[];
  }): Promise<PrivacyLedgerEvent> {
    assertContext(input.context);
    await this.assertKnownPurpose(scopeFromContext(input.context), input.purposeId);
    return this.append({
      context: input.context,
      subjectRef: input.subjectRef,
      requestId: null,
      purposeId: input.purposeId,
      channel: requireSafeText(input.channel, 'PRIVACY_CHANNEL_REQUIRED'),
      policyRef: requireSafeText(input.policyRef, 'PRIVACY_POLICY_REF_REQUIRED'),
      approvalId: null,
      capabilityId: 'privacy.opt_out.record',
      eventType: 'OPT_OUT_RECORDED',
      payload: {
        sourceRef: requireSafeText(input.sourceRef, 'PRIVACY_OPT_OUT_SOURCE_REQUIRED'),
        recordedAt: requireTimestamp(input.recordedAt, 'PRIVACY_OPT_OUT_TIMESTAMP_INVALID'),
      },
      extraEvidence: requireEvidence(input.sourceEvidence, 'PRIVACY_OPT_OUT_EVIDENCE_REQUIRED'),
    });
  }

  async suppress(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly purposeId: string;
    readonly channel: string;
    readonly reason: SuppressionReason;
    readonly policyRef: string;
    readonly sourceRef: string;
    readonly recordedAt: string;
    readonly sourceEvidence: readonly string[];
  }): Promise<PrivacyLedgerEvent> {
    assertContext(input.context);
    await this.assertKnownPurpose(scopeFromContext(input.context), input.purposeId);
    return this.append({
      context: input.context,
      subjectRef: input.subjectRef,
      requestId: null,
      purposeId: input.purposeId,
      channel: requireSafeText(input.channel, 'PRIVACY_CHANNEL_REQUIRED'),
      policyRef: requireSafeText(input.policyRef, 'PRIVACY_POLICY_REF_REQUIRED'),
      approvalId: null,
      capabilityId: 'privacy.suppression.record',
      eventType: 'SUPPRESSION_RECORDED',
      payload: {
        reason: input.reason,
        sourceRef: requireSafeText(input.sourceRef, 'PRIVACY_SUPPRESSION_SOURCE_REQUIRED'),
        recordedAt: requireTimestamp(input.recordedAt, 'PRIVACY_SUPPRESSION_TIMESTAMP_INVALID'),
      },
      extraEvidence: requireEvidence(input.sourceEvidence, 'PRIVACY_SUPPRESSION_EVIDENCE_REQUIRED'),
    });
  }

  async reconcileProviderConsent(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly purposeId: string;
    readonly channel: string;
    readonly policyRef: string;
    readonly observation: ProviderConsentObservation;
    readonly sourceEvidence: readonly string[];
  }): Promise<PrivacyLedgerEvent> {
    assertContext(input.context);
    await this.assertKnownPurpose(scopeFromContext(input.context), input.purposeId);
    if (!PROVIDER_CONSENT_STATES.includes(input.observation.state))
      throw new Error('PRIVACY_PROVIDER_CONSENT_STATE_INVALID');

    const event = await this.append({
      context: input.context,
      subjectRef: input.subjectRef,
      requestId: null,
      purposeId: input.purposeId,
      channel: requireSafeText(input.channel, 'PRIVACY_CHANNEL_REQUIRED'),
      policyRef: requireSafeText(input.policyRef, 'PRIVACY_POLICY_REF_REQUIRED'),
      approvalId: null,
      capabilityId: 'privacy.provider_consent.reconcile',
      eventType: 'PROVIDER_CONSENT_RECONCILED',
      payload: {
        provider: requireSafeText(input.observation.provider, 'PRIVACY_PROVIDER_REQUIRED'),
        providerSubjectRef: requireOpaqueSubjectRef(input.observation.providerSubjectRef),
        state: input.observation.state,
        observedAt: requireTimestamp(
          input.observation.observedAt,
          'PRIVACY_PROVIDER_CONSENT_TIMESTAMP_INVALID',
        ),
        providerEvidenceRef: requireSafeText(
          input.observation.providerEvidenceRef,
          'PRIVACY_PROVIDER_EVIDENCE_REF_REQUIRED',
        ),
      },
      extraEvidence: requireEvidence(
        input.sourceEvidence,
        'PRIVACY_PROVIDER_CONSENT_EVIDENCE_REQUIRED',
      ),
    });

    const suppressionReason = providerSuppressionReason(input.observation.state);
    if (suppressionReason) {
      await this.suppress({
        context: input.context,
        subjectRef: input.subjectRef,
        purposeId: input.purposeId,
        channel: input.channel,
        reason: suppressionReason,
        policyRef: input.policyRef,
        sourceRef: input.observation.providerEvidenceRef,
        recordedAt: input.observation.observedAt,
        sourceEvidence: input.sourceEvidence,
      });
    }
    return event;
  }

  async evaluatePiiAccess(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly purposeId: string;
    readonly policyRef: string;
    readonly classification: PiiClassification;
    readonly requestedFields: readonly string[];
    readonly minimumNecessaryFields: readonly string[];
    readonly authorization: PiiAuthorizationDecision;
    readonly sourceEvidence: readonly string[];
  }): Promise<PiiAccessDecision> {
    assertContext(input.context);
    await this.assertKnownPurpose(scopeFromContext(input.context), input.purposeId);
    if (!PII_CLASSIFICATIONS.includes(input.classification))
      throw new Error('PRIVACY_PII_CLASSIFICATION_INVALID');

    const requestedFields = safeFieldNames(input.requestedFields, 'PRIVACY_PII_FIELDS_REQUIRED');
    const minimumNecessaryFields = safeFieldNames(
      input.minimumNecessaryFields,
      'PRIVACY_PII_MINIMUM_NECESSARY_REQUIRED',
    );
    const authorizedFields = safeFieldNames(
      input.authorization.allowedFields,
      'PRIVACY_PII_AUTHORIZED_FIELDS_REQUIRED',
      true,
    );
    const reasons: string[] = [];
    let state: PiiAccessDecision['state'];
    let exposedFields: readonly string[] = [];

    if (input.authorization.state === 'UNKNOWN' || !input.authorization.decisionRef) {
      state = 'UNKNOWN_BLOCKED';
      reasons.push('PII_AUTHORIZATION_UNKNOWN');
    } else if (input.authorization.state === 'DENIED') {
      state = 'DENIED';
      reasons.push('PII_ACCESS_DENIED');
    } else if (!input.authorization.allowedClassifications.includes(input.classification)) {
      state = 'DENIED';
      reasons.push('PII_CLASSIFICATION_NOT_AUTHORIZED');
    } else {
      const minimumNecessary = new Set(minimumNecessaryFields);
      const allowed = new Set(authorizedFields);
      exposedFields = requestedFields.filter(
        (field) => minimumNecessary.has(field) && allowed.has(field),
      );
      if (exposedFields.length === 0) {
        state = 'DENIED';
        reasons.push('PII_NO_MINIMUM_NECESSARY_FIELDS_AUTHORIZED');
      } else if (exposedFields.length < requestedFields.length) {
        state = 'MINIMIZED';
        reasons.push('PII_FIELDS_MINIMIZED');
      } else {
        state = 'ALLOWED';
      }
    }

    const exposedSet = new Set(exposedFields);
    const decision: PiiAccessDecision = {
      state,
      allowed: state === 'ALLOWED' || state === 'MINIMIZED',
      classification: input.classification,
      exposedFields,
      omittedFields: requestedFields.filter((field) => !exposedSet.has(field)),
      reasons: unique(reasons),
    };
    await this.append({
      context: input.context,
      subjectRef: input.subjectRef,
      requestId: null,
      purposeId: input.purposeId,
      channel: null,
      policyRef: requireSafeText(input.policyRef, 'PRIVACY_POLICY_REF_REQUIRED'),
      approvalId: null,
      capabilityId: 'privacy.pii.access.evaluate',
      eventType: 'PII_ACCESS_EVALUATED',
      payload: {
        ...decision,
        authorizationState: input.authorization.state,
        authorizationDecisionRef: input.authorization.decisionRef,
      },
      extraEvidence: requireEvidence(input.sourceEvidence, 'PRIVACY_PII_ACCESS_EVIDENCE_REQUIRED'),
    });
    return decision;
  }

  async explainAutomatedDecision(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly policyRef: string;
    readonly evidence: AutomatedDecisionEvidence | null;
  }): Promise<AutomatedDecisionExplanation> {
    assertContext(input.context);
    const decision = input.evidence;
    const explanation: AutomatedDecisionExplanation = decision
      ? {
          state: 'KNOWN',
          decisionRef: requireSafeText(decision.decisionRef, 'PRIVACY_DECISION_REF_REQUIRED'),
          criteriaSummary: requireSafeText(
            decision.criteriaSummary,
            'PRIVACY_DECISION_CRITERIA_REQUIRED',
          ),
          procedureSummary: requireSafeText(
            decision.procedureSummary,
            'PRIVACY_DECISION_PROCEDURE_REQUIRED',
          ),
          reasons: [],
        }
      : {
          state: 'UNKNOWN_BLOCKED',
          decisionRef: null,
          criteriaSummary: null,
          procedureSummary: null,
          reasons: ['AUTOMATED_DECISION_EVIDENCE_UNKNOWN'],
        };
    await this.append({
      context: input.context,
      subjectRef: input.subjectRef,
      requestId: null,
      purposeId: null,
      channel: null,
      policyRef: requireSafeText(input.policyRef, 'PRIVACY_AUTOMATED_DECISION_POLICY_REQUIRED'),
      approvalId: null,
      capabilityId: 'privacy.automated_decision.explain',
      eventType: 'AUTOMATED_DECISION_EXPLAINED',
      payload: { ...explanation },
      extraEvidence: decision
        ? requireEvidence(decision.sourceEvidence, 'PRIVACY_DECISION_EVIDENCE_REQUIRED')
        : [],
    });
    return explanation;
  }

  async reviewProfiling(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly policyRef: string;
    readonly evidence: ProfilingEvidence | null;
  }): Promise<ProfilingReview> {
    assertContext(input.context);
    const evidence = input.evidence;
    let review: ProfilingReview;
    if (!evidence) {
      review = {
        state: 'UNKNOWN_BLOCKED',
        profilingRef: null,
        reasons: ['PROFILING_EVIDENCE_UNKNOWN'],
      };
    } else {
      await this.assertKnownPurpose(scopeFromContext(input.context), evidence.purposeId);
      const reasons: string[] = [];
      if (evidence.automatedOnly === null) reasons.push('AUTOMATION_STATUS_UNKNOWN');
      if (evidence.affectsInterests === null) reasons.push('IMPACT_STATUS_UNKNOWN');
      if (evidence.legalBasisRecorded !== true) reasons.push('LEGAL_BASIS_NOT_CONFIRMED');
      if (evidence.dataMinimizationReviewed !== true)
        reasons.push('DATA_MINIMIZATION_NOT_CONFIRMED');
      if (evidence.automatedOnly === true && evidence.affectsInterests === true)
        reasons.push('AUTOMATED_DECISION_REVIEW_APPLIES');
      const hasUnknown = evidence.automatedOnly === null || evidence.affectsInterests === null;
      review = {
        state: hasUnknown ? 'UNKNOWN_BLOCKED' : reasons.length > 0 ? 'REVIEW_REQUIRED' : 'CLEAR',
        profilingRef: requireSafeText(evidence.profilingRef, 'PRIVACY_PROFILING_REF_REQUIRED'),
        reasons,
      };
    }
    await this.append({
      context: input.context,
      subjectRef: input.subjectRef,
      requestId: null,
      purposeId: evidence?.purposeId ?? null,
      channel: null,
      policyRef: requireSafeText(input.policyRef, 'PRIVACY_PROFILING_POLICY_REQUIRED'),
      approvalId: null,
      capabilityId: 'privacy.profiling.review',
      eventType: 'PROFILING_REVIEWED',
      payload: { ...review },
      extraEvidence: evidence
        ? requireEvidence(evidence.sourceEvidence, 'PRIVACY_PROFILING_EVIDENCE_REQUIRED')
        : [],
    });
    return review;
  }
}

function isProviderConsentState(value: unknown): value is ProviderConsentState {
  return (
    typeof value === 'string' && PROVIDER_CONSENT_STATES.includes(value as ProviderConsentState)
  );
}

function providerSuppressionReason(state: ProviderConsentState): SuppressionReason | null {
  switch (state) {
    case 'OPTED_OUT':
      return 'PROVIDER_OPT_OUT';
    case 'UNSUBSCRIBED':
      return 'PROVIDER_UNSUBSCRIBED';
    case 'BOUNCED':
      return 'PROVIDER_BOUNCED';
    case 'COMPLAINT':
      return 'PROVIDER_COMPLAINT';
    case 'OPTED_IN':
    case 'UNKNOWN':
      return null;
  }
}

function safeFieldNames(
  values: readonly string[],
  errorCode: string,
  allowEmpty = false,
): readonly string[] {
  const fields = unique(values.map((value) => requireSafeText(value, errorCode)));
  if (!allowEmpty && fields.length === 0) throw new Error(errorCode);
  return fields;
}

export { privacyApprovalDescriptor } from './privacy-governance-helpers.js';
