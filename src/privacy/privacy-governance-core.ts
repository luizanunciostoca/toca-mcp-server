import type {
  ConsentState,
  LegalBasisClass,
  LegalBasisReviewStatus,
  PreferenceState,
  PrivacyExecutionContext,
  PrivacyLedgerEvent,
  PurposeResolution,
  SuppressionDecision,
} from './contracts.js';
import { PrivacyGovernanceBase } from './privacy-governance-base.js';
import {
  assertContext,
  assertIdempotentEquivalent,
  consentVersionOf,
  isErrorCode,
  latest,
  latestConsentTransition,
  previousConsentEventId,
  requireEvidence,
  requireOpaqueSubjectRef,
  requireSafeText,
  requireText,
  requireTimestamp,
  scopeFromContext,
  unique,
} from './privacy-governance-helpers.js';

const CONSENT_STATES: readonly ConsentState[] = ['GRANTED', 'DENIED'];
const LEGAL_BASIS_CLASSES: readonly LegalBasisClass[] = ['CONSENT', 'OTHER_EXPLICIT_BASIS'];
const LEGAL_BASIS_REVIEW_STATUSES: readonly LegalBasisReviewStatus[] = ['APPROVED', 'PENDING'];
const PREFERENCE_STATES: readonly PreferenceState[] = ['ALLOW', 'DENY'];

export class PrivacyGovernanceCore extends PrivacyGovernanceBase {
  async resolvePurpose(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly purposeId: string;
  }): Promise<PurposeResolution> {
    const { context } = input;
    assertContext(context);
    const subjectRef = requireOpaqueSubjectRef(input.subjectRef);
    const purposeId = requireText(input.purposeId, 'PRIVACY_PURPOSE_REQUIRED');
    const purpose = await this.deps.purposeRegistry.resolve(scopeFromContext(context), purposeId);
    const resolution: PurposeResolution = purpose?.active
      ? { state: 'KNOWN', purpose, blocked: false, reasons: [] }
      : {
          state: 'UNKNOWN_BLOCKED',
          purpose: null,
          blocked: true,
          reasons: [purpose ? 'PURPOSE_INACTIVE' : 'PURPOSE_UNKNOWN'],
        };

    await this.append({
      context,
      subjectRef,
      requestId: null,
      purposeId,
      channel: null,
      policyRef: purpose?.policyRef ?? null,
      approvalId: null,
      capabilityId: 'privacy.purpose.resolve',
      eventType: 'PURPOSE_RESOLVED',
      payload: {
        resolution: resolution.state,
        blocked: resolution.blocked,
        reasons: resolution.reasons,
      },
      extraEvidence: purpose?.evidence ?? [],
    });
    return resolution;
  }

  async recordLegalBasis(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly purposeId: string;
    readonly basisReference: string;
    readonly basisClass: LegalBasisClass;
    readonly statuteReference: string;
    readonly policyRef: string;
    readonly reviewStatus: LegalBasisReviewStatus;
    readonly validFrom: string;
    readonly validUntil: string | null;
    readonly sourceEvidence: readonly string[];
  }): Promise<PrivacyLedgerEvent> {
    assertContext(input.context);
    await this.assertKnownPurpose(scopeFromContext(input.context), input.purposeId);
    if (!LEGAL_BASIS_CLASSES.includes(input.basisClass))
      throw new Error('PRIVACY_LEGAL_BASIS_CLASS_INVALID');
    if (!LEGAL_BASIS_REVIEW_STATUSES.includes(input.reviewStatus))
      throw new Error('PRIVACY_LEGAL_BASIS_REVIEW_STATUS_INVALID');

    const sourceEvidence = requireEvidence(
      input.sourceEvidence,
      'PRIVACY_LEGAL_BASIS_EVIDENCE_REQUIRED',
    );
    const validFrom = requireTimestamp(input.validFrom, 'PRIVACY_LEGAL_BASIS_VALID_FROM_INVALID');
    const validUntil = input.validUntil
      ? requireTimestamp(input.validUntil, 'PRIVACY_LEGAL_BASIS_VALID_UNTIL_INVALID')
      : null;
    if (validUntil && Date.parse(validUntil) <= Date.parse(validFrom))
      throw new Error('PRIVACY_LEGAL_BASIS_VALIDITY_INVALID');

    return this.append({
      context: input.context,
      subjectRef: input.subjectRef,
      requestId: null,
      purposeId: input.purposeId,
      channel: null,
      policyRef: requireSafeText(input.policyRef, 'PRIVACY_POLICY_REF_REQUIRED'),
      approvalId: null,
      capabilityId: 'privacy.legal_basis.record',
      eventType: 'LEGAL_BASIS_RECORDED',
      payload: {
        basisReference: requireSafeText(
          input.basisReference,
          'PRIVACY_LEGAL_BASIS_REFERENCE_REQUIRED',
        ),
        basisClass: input.basisClass,
        statuteReference: requireSafeText(
          input.statuteReference,
          'PRIVACY_LEGAL_BASIS_STATUTE_REFERENCE_REQUIRED',
        ),
        reviewStatus: input.reviewStatus,
        validFrom,
        validUntil,
      },
      extraEvidence: sourceEvidence,
    });
  }

  async recordConsent(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly purposeId: string;
    readonly channel: string;
    readonly state: ConsentState;
    readonly consentVersion: number;
    readonly noticeVersion: string;
    readonly collectionMethod: string;
    readonly capturedAt: string;
    readonly policyRef: string;
    readonly sourceEvidence: readonly string[];
  }): Promise<PrivacyLedgerEvent> {
    assertContext(input.context);
    const scope = scopeFromContext(input.context);
    const subjectRef = requireOpaqueSubjectRef(input.subjectRef);
    const purposeId = requireText(input.purposeId, 'PRIVACY_PURPOSE_REQUIRED');
    const channel = requireSafeText(input.channel, 'PRIVACY_CHANNEL_REQUIRED');
    await this.assertKnownPurpose(scope, purposeId);
    if (!CONSENT_STATES.includes(input.state)) throw new Error('PRIVACY_CONSENT_STATE_INVALID');
    if (!Number.isSafeInteger(input.consentVersion) || input.consentVersion < 1)
      throw new Error('PRIVACY_CONSENT_VERSION_INVALID');

    const existing = await this.deps.store.findByExecution(
      scope,
      input.context.executionId,
      'privacy.consent.record',
    );
    if (existing) {
      const candidate = this.buildEvent({
        context: input.context,
        subjectRef,
        requestId: null,
        purposeId,
        channel,
        policyRef: requireSafeText(input.policyRef, 'PRIVACY_POLICY_REF_REQUIRED'),
        approvalId: null,
        capabilityId: 'privacy.consent.record',
        eventType: 'CONSENT_RECORDED',
        payload: {
          state: input.state,
          consentVersion: input.consentVersion,
          noticeVersion: requireSafeText(input.noticeVersion, 'PRIVACY_NOTICE_VERSION_REQUIRED'),
          collectionMethod: requireSafeText(
            input.collectionMethod,
            'PRIVACY_CONSENT_COLLECTION_METHOD_REQUIRED',
          ),
          capturedAt: requireTimestamp(input.capturedAt, 'PRIVACY_CONSENT_TIMESTAMP_INVALID'),
          previousConsentEventId: previousConsentEventId(existing),
        },
        extraEvidence: requireEvidence(input.sourceEvidence, 'PRIVACY_CONSENT_EVIDENCE_REQUIRED'),
      });
      assertIdempotentEquivalent(existing, candidate);
      await this.auditLedgerEvent(
        input.context,
        'privacy.consent.record',
        existing.approvalId,
        existing,
      );
      return existing;
    }

    const events = await this.deps.store.listForSubject(scope, subjectRef);
    const head = latestConsentTransition(events, purposeId, channel);
    const priorVersion = head ? consentVersionOf(head) : 0;
    if (input.consentVersion !== priorVersion + 1)
      throw new Error('PRIVACY_CONSENT_VERSION_SEQUENCE_INVALID');

    return this.appendConsentTransition(
      {
        context: input.context,
        subjectRef,
        requestId: null,
        purposeId,
        channel,
        policyRef: requireSafeText(input.policyRef, 'PRIVACY_POLICY_REF_REQUIRED'),
        approvalId: null,
        capabilityId: 'privacy.consent.record',
        eventType: 'CONSENT_RECORDED',
        payload: {
          state: input.state,
          consentVersion: input.consentVersion,
          noticeVersion: requireSafeText(input.noticeVersion, 'PRIVACY_NOTICE_VERSION_REQUIRED'),
          collectionMethod: requireSafeText(
            input.collectionMethod,
            'PRIVACY_CONSENT_COLLECTION_METHOD_REQUIRED',
          ),
          capturedAt: requireTimestamp(input.capturedAt, 'PRIVACY_CONSENT_TIMESTAMP_INVALID'),
          previousConsentEventId: head?.eventId ?? null,
        },
        extraEvidence: requireEvidence(input.sourceEvidence, 'PRIVACY_CONSENT_EVIDENCE_REQUIRED'),
      },
      head?.eventId ?? null,
    );
  }

  async revokeConsent(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly purposeId: string;
    readonly channel: string;
    readonly policyRef: string;
    readonly revokedAt: string;
    readonly sourceEvidence: readonly string[];
  }): Promise<PrivacyLedgerEvent> {
    assertContext(input.context);
    const scope = scopeFromContext(input.context);
    const subjectRef = requireOpaqueSubjectRef(input.subjectRef);
    const purposeId = requireText(input.purposeId, 'PRIVACY_PURPOSE_REQUIRED');
    const channel = requireSafeText(input.channel, 'PRIVACY_CHANNEL_REQUIRED');
    await this.assertKnownPurpose(scope, purposeId);

    const events = await this.deps.store.listForSubject(scope, subjectRef);
    const consent = latestConsentTransition(events, purposeId, channel);
    if (!consent) throw new Error('PRIVACY_CONSENT_NOT_FOUND');
    if (consent.eventType === 'CONSENT_REVOKED') {
      await this.auditLedgerEvent(
        input.context,
        'privacy.consent.revoke',
        consent.approvalId,
        consent,
      );
      return consent;
    }
    if (consent.payload.state !== 'GRANTED') throw new Error('PRIVACY_CONSENT_NOT_GRANTED');

    try {
      return await this.appendConsentTransition(
        {
          context: input.context,
          subjectRef,
          requestId: null,
          purposeId,
          channel,
          policyRef: requireSafeText(input.policyRef, 'PRIVACY_POLICY_REF_REQUIRED'),
          approvalId: null,
          capabilityId: 'privacy.consent.revoke',
          eventType: 'CONSENT_REVOKED',
          payload: {
            consentEventId: consent.eventId,
            consentVersion: consentVersionOf(consent),
            revokedAt: requireTimestamp(
              input.revokedAt,
              'PRIVACY_CONSENT_REVOCATION_TIMESTAMP_INVALID',
            ),
          },
          extraEvidence: requireEvidence(
            input.sourceEvidence,
            'PRIVACY_CONSENT_REVOCATION_EVIDENCE_REQUIRED',
          ),
        },
        consent.eventId,
      );
    } catch (error) {
      if (!isErrorCode(error, 'PRIVACY_CONSENT_CONCURRENT_UPDATE')) throw error;
      const refreshed = await this.deps.store.listForSubject(scope, subjectRef);
      const current = latestConsentTransition(refreshed, purposeId, channel);
      if (
        current?.eventType === 'CONSENT_REVOKED' &&
        current.payload.consentEventId === consent.eventId
      ) {
        await this.auditLedgerEvent(
          input.context,
          'privacy.consent.revoke',
          current.approvalId,
          current,
        );
        return current;
      }
      throw error;
    }
  }

  async checkSuppression(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly purposeId: string;
    readonly channel: string;
    readonly preferenceRequired: boolean;
  }): Promise<SuppressionDecision> {
    assertContext(input.context);
    const scope = scopeFromContext(input.context);
    const subjectRef = requireOpaqueSubjectRef(input.subjectRef);
    const purposeId = requireText(input.purposeId, 'PRIVACY_PURPOSE_REQUIRED');
    const channel = requireSafeText(input.channel, 'PRIVACY_CHANNEL_REQUIRED');
    const purpose = await this.deps.purposeRegistry.resolve(scope, purposeId);
    const events = await this.deps.store.listForSubject(scope, subjectRef);
    const reasons: string[] = [];
    let state: SuppressionDecision['state'] = 'ALLOWED';

    if (!purpose?.active) {
      state = 'UNKNOWN_BLOCKED';
      reasons.push(purpose ? 'PURPOSE_INACTIVE' : 'PURPOSE_UNKNOWN');
    }

    const deletion = latest(events, (event) => event.eventType === 'DATA_DELETE_EXECUTED');
    const retention = latest(
      events,
      (event) => event.eventType === 'RETENTION_APPLIED' && event.purposeId === purposeId,
    );
    if (
      deletion ||
      retention?.payload.action === 'DELETE' ||
      retention?.payload.action === 'ANONYMIZE'
    ) {
      state = 'SUPPRESSED';
      reasons.push(deletion ? 'DATA_DELETE_EXECUTED' : 'RETENTION_SUPPRESSES_USE');
    }

    const basis = latest(
      events,
      (event) => event.eventType === 'LEGAL_BASIS_RECORDED' && event.purposeId === purposeId,
    );
    if (!basis) {
      if (state === 'ALLOWED') state = 'UNKNOWN_BLOCKED';
      reasons.push('LEGAL_BASIS_UNKNOWN');
    } else if (basis.payload.reviewStatus !== 'APPROVED') {
      if (state === 'ALLOWED') state = 'UNKNOWN_BLOCKED';
      reasons.push('LEGAL_BASIS_NOT_APPROVED');
    } else if (
      typeof basis.payload.validFrom !== 'string' ||
      !Number.isFinite(Date.parse(basis.payload.validFrom)) ||
      Date.parse(basis.payload.validFrom) > Date.now()
    ) {
      if (state === 'ALLOWED') state = 'UNKNOWN_BLOCKED';
      reasons.push('LEGAL_BASIS_NOT_YET_VALID');
    } else if (
      basis.payload.validUntil !== undefined &&
      basis.payload.validUntil !== null &&
      (typeof basis.payload.validUntil !== 'string' ||
        !Number.isFinite(Date.parse(basis.payload.validUntil)) ||
        Date.parse(basis.payload.validUntil) <= Date.now())
    ) {
      if (state === 'ALLOWED') state = 'UNKNOWN_BLOCKED';
      reasons.push('LEGAL_BASIS_EXPIRED');
    } else if (basis.payload.basisClass === 'CONSENT') {
      const consent = latestConsentTransition(events, purposeId, channel);
      if (!consent) {
        if (state === 'ALLOWED') state = 'UNKNOWN_BLOCKED';
        reasons.push('CONSENT_UNKNOWN');
      } else if (consent.eventType === 'CONSENT_REVOKED' || consent.payload.state !== 'GRANTED') {
        state = 'SUPPRESSED';
        reasons.push(
          consent.eventType === 'CONSENT_REVOKED' ? 'CONSENT_REVOKED' : 'CONSENT_DENIED',
        );
      }
    }

    if (input.preferenceRequired) {
      const preference = latest(
        events,
        (event) =>
          event.eventType === 'PREFERENCE_UPDATED' &&
          event.purposeId === purposeId &&
          event.channel === channel,
      );
      if (!preference) {
        if (state === 'ALLOWED') state = 'UNKNOWN_BLOCKED';
        reasons.push('PREFERENCE_UNKNOWN');
      } else if (preference.payload.state !== 'ALLOW') {
        state = 'SUPPRESSED';
        reasons.push('PREFERENCE_DENY');
      }
    }

    const decision: SuppressionDecision = {
      state,
      blocked: state !== 'ALLOWED',
      reasons: unique(reasons),
      purposeId,
      channel,
    };
    await this.append({
      context: input.context,
      subjectRef,
      requestId: null,
      purposeId,
      channel,
      policyRef: purpose?.policyRef ?? null,
      approvalId: null,
      capabilityId: 'privacy.suppression.check',
      eventType: 'SUPPRESSION_CHECKED',
      payload: { ...decision },
      extraEvidence: purpose?.evidence ?? [],
    });
    return decision;
  }

  async updatePreference(input: {
    readonly context: PrivacyExecutionContext;
    readonly subjectRef: string;
    readonly purposeId: string;
    readonly channel: string;
    readonly state: PreferenceState;
    readonly policyRef: string;
    readonly sourceRef: string;
    readonly sourceEvidence: readonly string[];
  }): Promise<PrivacyLedgerEvent> {
    assertContext(input.context);
    await this.assertKnownPurpose(scopeFromContext(input.context), input.purposeId);
    if (!PREFERENCE_STATES.includes(input.state))
      throw new Error('PRIVACY_PREFERENCE_STATE_INVALID');
    return this.append({
      context: input.context,
      subjectRef: input.subjectRef,
      requestId: null,
      purposeId: input.purposeId,
      channel: requireSafeText(input.channel, 'PRIVACY_CHANNEL_REQUIRED'),
      policyRef: requireSafeText(input.policyRef, 'PRIVACY_POLICY_REF_REQUIRED'),
      approvalId: null,
      capabilityId: 'privacy.preference.update',
      eventType: 'PREFERENCE_UPDATED',
      payload: {
        state: input.state,
        sourceRef: requireSafeText(input.sourceRef, 'PRIVACY_PREFERENCE_SOURCE_REQUIRED'),
      },
      extraEvidence: requireEvidence(input.sourceEvidence, 'PRIVACY_PREFERENCE_EVIDENCE_REQUIRED'),
    });
  }
}
