import type {
  AutomatedDecisionEvidence,
  AutomatedDecisionExplanation,
  PrivacyExecutionContext,
  ProfilingEvidence,
  ProfilingReview,
} from './contracts.js';
import { PrivacyGovernanceRights } from './privacy-governance-rights.js';
import {
  assertContext,
  requireEvidence,
  requireSafeText,
  scopeFromContext,
} from './privacy-governance-helpers.js';

export class PrivacyGovernanceService extends PrivacyGovernanceRights {
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

export { privacyApprovalDescriptor } from './privacy-governance-helpers.js';
