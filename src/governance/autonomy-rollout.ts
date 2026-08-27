import type { AutonomyMode, CompiledAutonomyPolicy } from './autonomy-policy.js';
import { loadEffectiveAutonomyPolicy } from './autonomy-policy.js';

export const SHADOW_DIVERGENCE_TYPES = [
  'NONE',
  'AUTHORITY',
  'CAPABILITY',
  'TARGET',
  'PAYLOAD',
  'TIMING',
  'POLICY',
  'OUTCOME',
] as const;
export type ShadowDivergenceType = (typeof SHADOW_DIVERGENCE_TYPES)[number];

export interface ShadowDecisionRecord {
  readonly decisionId: string;
  readonly capabilityId: string;
  readonly tenantId: string;
  readonly provider: string;
  readonly proposedDecision: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
  readonly approvedDecision: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
  readonly executed: boolean;
  readonly divergence: ShadowDivergenceType;
  readonly proposedDescriptorSha256: string;
  readonly approvedDescriptorSha256: string;
  readonly decidedAt: string;
  readonly evidence: readonly string[];
}

export interface CanaryOperationalEvidence {
  readonly supervisedExternalActions: number;
  readonly verifiedExternalActions: number;
  readonly sloHealthy: boolean;
  readonly providerCircuitClosed: boolean;
  readonly readinessGreen: boolean;
  readonly criticalIncidents: number;
  readonly evidence: readonly string[];
}

export interface AutonomyRolloutAssessment {
  readonly currentMode: AutonomyMode;
  readonly recommendedMode: AutonomyMode;
  readonly promotable: boolean;
  readonly rollbackRequired: boolean;
  readonly reasonCodes: readonly string[];
  readonly shadowAgreementRatio: number;
  readonly evidence: readonly string[];
}

export interface HumanAutonomyDecision {
  readonly actorId: string;
  readonly actorType: 'HUMAN';
  readonly decision: 'PROMOTE' | 'HOLD' | 'ROLLBACK';
  readonly targetMode: AutonomyMode;
  readonly decidedAt: string;
  readonly evidence: readonly string[];
}

export function assessAutonomyRollout(
  currentMode: AutonomyMode,
  shadow: readonly ShadowDecisionRecord[],
  operational: CanaryOperationalEvidence,
  policy: CompiledAutonomyPolicy = loadEffectiveAutonomyPolicy(),
): AutonomyRolloutAssessment {
  shadow.forEach(assertShadowDecision);
  assertOperationalEvidence(operational);
  const divergences = shadow.filter((record) => record.divergence !== 'NONE');
  const exactMatches = shadow.filter(
    (record) =>
      record.divergence === 'NONE' &&
      record.proposedDecision === record.approvedDecision &&
      record.proposedDescriptorSha256 === record.approvedDescriptorSha256,
  );
  const shadowAgreementRatio = shadow.length === 0 ? 0 : exactMatches.length / shadow.length;
  const reasons: string[] = [];
  if (shadow.length < policy.policy.canary.shadowDecisionsMinimum) {
    reasons.push('SHADOW_SAMPLE_INSUFFICIENT');
  }
  if (divergences.length > 0 || shadowAgreementRatio < 1)
    reasons.push('SHADOW_DIVERGENCE_DETECTED');
  if (
    operational.supervisedExternalActions < policy.policy.canary.supervisedExternalActionsMinimum
  ) {
    reasons.push('SUPERVISED_EXTERNAL_SAMPLE_INSUFFICIENT');
  }
  if (operational.verifiedExternalActions !== operational.supervisedExternalActions) {
    reasons.push('EXTERNAL_READBACK_GAP');
  }
  if (!operational.sloHealthy) reasons.push('SLO_UNHEALTHY');
  if (!operational.providerCircuitClosed) reasons.push('PROVIDER_CIRCUIT_OPEN');
  if (!operational.readinessGreen) reasons.push('READINESS_NOT_GREEN');
  if (operational.criticalIncidents > 0) reasons.push('CRITICAL_INCIDENT_ACTIVE');

  const rollbackRequired = reasons.some((reason) =>
    [
      'SHADOW_DIVERGENCE_DETECTED',
      'EXTERNAL_READBACK_GAP',
      'SLO_UNHEALTHY',
      'PROVIDER_CIRCUIT_OPEN',
      'READINESS_NOT_GREEN',
      'CRITICAL_INCIDENT_ACTIVE',
    ].includes(reason),
  );
  const promotable = reasons.length === 0;
  const recommendedMode: AutonomyMode = rollbackRequired
    ? policy.policy.canary.rollbackMode
    : promotable
      ? nextMode(currentMode)
      : currentMode;

  return {
    currentMode,
    recommendedMode,
    promotable,
    rollbackRequired,
    reasonCodes: [...new Set(reasons)].sort(),
    shadowAgreementRatio,
    evidence: normalizeEvidence([
      ...shadow.flatMap((record) => record.evidence),
      ...operational.evidence,
      `rollout:shadow-count:${shadow.length}`,
      `rollout:shadow-agreement:${shadowAgreementRatio.toFixed(6)}`,
      `rollout:supervised-external:${operational.supervisedExternalActions}`,
      `rollout:verified-external:${operational.verifiedExternalActions}`,
    ]),
  };
}

export function applyHumanAutonomyDecision(
  assessment: AutonomyRolloutAssessment,
  decision: HumanAutonomyDecision,
): AutonomyMode {
  if (!decision.actorId.trim()) throw new Error('AUTONOMY_DECISION_ACTOR_REQUIRED');
  if (decision.actorType !== 'HUMAN') throw new Error('AUTONOMY_SELF_PROMOTION_FORBIDDEN');
  if (!Number.isFinite(Date.parse(decision.decidedAt))) {
    throw new Error('AUTONOMY_DECISION_TIMESTAMP_INVALID');
  }
  if (normalizeEvidence(decision.evidence).length === 0) {
    throw new Error('AUTONOMY_DECISION_EVIDENCE_REQUIRED');
  }
  if (decision.decision === 'ROLLBACK') return 'SUPERVISED_AUTO';
  if (decision.decision === 'HOLD') return assessment.currentMode;
  if (assessment.rollbackRequired || !assessment.promotable) {
    throw new Error(`AUTONOMY_PROMOTION_NOT_READY:${assessment.reasonCodes.join(',')}`);
  }
  if (decision.targetMode !== assessment.recommendedMode) {
    throw new Error('AUTONOMY_PROMOTION_TARGET_MISMATCH');
  }
  return decision.targetMode;
}

export function assertShadowDecision(record: ShadowDecisionRecord): void {
  if (!record.decisionId.trim()) throw new Error('SHADOW_DECISION_ID_REQUIRED');
  if (!record.capabilityId.trim() || !record.tenantId.trim() || !record.provider.trim()) {
    throw new Error('SHADOW_DECISION_SCOPE_REQUIRED');
  }
  if (!/^[a-f0-9]{64}$/.test(record.proposedDescriptorSha256)) {
    throw new Error('SHADOW_PROPOSED_DESCRIPTOR_INVALID');
  }
  if (!/^[a-f0-9]{64}$/.test(record.approvedDescriptorSha256)) {
    throw new Error('SHADOW_APPROVED_DESCRIPTOR_INVALID');
  }
  if (!Number.isFinite(Date.parse(record.decidedAt)))
    throw new Error('SHADOW_DECISION_TIME_INVALID');
  if (normalizeEvidence(record.evidence).length === 0) {
    throw new Error('SHADOW_DECISION_EVIDENCE_REQUIRED');
  }
  if (
    record.divergence === 'NONE' &&
    (record.proposedDecision !== record.approvedDecision ||
      record.proposedDescriptorSha256 !== record.approvedDescriptorSha256)
  ) {
    throw new Error('SHADOW_DIVERGENCE_UNCLASSIFIED');
  }
}

function nextMode(current: AutonomyMode): AutonomyMode {
  if (current === 'OFF') return 'OBSERVE';
  if (current === 'OBSERVE') return 'ASSISTED';
  if (current === 'ASSISTED') return 'SUPERVISED_AUTO';
  if (current === 'SUPERVISED_AUTO') return 'PREAPPROVED_AUTO';
  return 'PREAPPROVED_AUTO';
}

function assertOperationalEvidence(value: CanaryOperationalEvidence): void {
  for (const [name, count] of Object.entries({
    supervisedExternalActions: value.supervisedExternalActions,
    verifiedExternalActions: value.verifiedExternalActions,
    criticalIncidents: value.criticalIncidents,
  })) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`AUTONOMY_CANARY_COUNT_INVALID:${name}`);
    }
  }
  if (value.verifiedExternalActions > value.supervisedExternalActions) {
    throw new Error('AUTONOMY_CANARY_VERIFIED_EXCEEDS_EXECUTED');
  }
  if (normalizeEvidence(value.evidence).length === 0) {
    throw new Error('AUTONOMY_CANARY_EVIDENCE_REQUIRED');
  }
}

function normalizeEvidence(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}
