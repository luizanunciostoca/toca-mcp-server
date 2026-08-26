import { createHash, randomUUID } from 'node:crypto';

export const LEARNING_RECOMMENDATION_STATUSES = [
  'RECOMMENDED',
  'ADOPTED',
  'REJECTED',
  'EXPIRED',
] as const;
export type LearningRecommendationStatus = (typeof LEARNING_RECOMMENDATION_STATUSES)[number];

export interface LearningRecommendation {
  readonly recommendationId: string;
  readonly routeId: 'R31';
  readonly tenantId: string;
  readonly targetType: 'CONFIG' | 'RULE' | 'POLICY' | 'PREAPPROVED_CLASS';
  readonly targetKey: string;
  readonly currentValueSha256: string;
  readonly proposedValueSha256: string;
  readonly authorityImpact: 'NONE' | 'REDUCE' | 'INCREASE';
  readonly hypothesis: string;
  readonly evidence: readonly string[];
  readonly recommendedAt: string;
  readonly expiresAt: string;
  readonly status: LearningRecommendationStatus;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly decisionEvidence: readonly string[];
}

export interface LearningRecommendationInput {
  readonly tenantId: string;
  readonly targetType: LearningRecommendation['targetType'];
  readonly targetKey: string;
  readonly currentValue: unknown;
  readonly proposedValue: unknown;
  readonly authorityImpact: LearningRecommendation['authorityImpact'];
  readonly hypothesis: string;
  readonly evidence: readonly string[];
  readonly expiresAt: string;
}

export interface LearningHumanDecision {
  readonly actorId: string;
  readonly actorType: 'HUMAN';
  readonly decision: 'ADOPT' | 'REJECT';
  readonly evidence: readonly string[];
  readonly decidedAt: string;
}

export interface LearningAdoptionMetrics {
  readonly totalDecided: number;
  readonly adopted: number;
  readonly rejected: number;
  readonly adoptionRate: number;
}

export function createLearningRecommendation(
  input: LearningRecommendationInput,
  options: { readonly now?: string; readonly createId?: () => string } = {},
): LearningRecommendation {
  const now = options.now ?? new Date().toISOString();
  assertTimestamp(now, 'LEARNING_RECOMMENDED_AT_INVALID');
  assertTimestamp(input.expiresAt, 'LEARNING_EXPIRY_INVALID');
  if (Date.parse(input.expiresAt) <= Date.parse(now)) throw new Error('LEARNING_EXPIRY_NOT_FUTURE');
  if (!input.tenantId.trim() || !input.targetKey.trim() || !input.hypothesis.trim()) {
    throw new Error('LEARNING_RECOMMENDATION_FIELDS_REQUIRED');
  }
  const evidence = normalizeEvidence(input.evidence);
  if (evidence.length === 0) throw new Error('LEARNING_RECOMMENDATION_EVIDENCE_REQUIRED');
  assertNoSystemAuthorityMutation(input);
  return {
    recommendationId: options.createId?.() ?? randomUUID(),
    routeId: 'R31',
    tenantId: input.tenantId,
    targetType: input.targetType,
    targetKey: input.targetKey,
    currentValueSha256: hash(input.currentValue),
    proposedValueSha256: hash(input.proposedValue),
    authorityImpact: input.authorityImpact,
    hypothesis: input.hypothesis,
    evidence,
    recommendedAt: now,
    expiresAt: input.expiresAt,
    status: 'RECOMMENDED',
    decidedBy: null,
    decidedAt: null,
    decisionEvidence: [],
  };
}

export function decideLearningRecommendation(
  recommendation: LearningRecommendation,
  decision: LearningHumanDecision,
): LearningRecommendation {
  if (recommendation.status !== 'RECOMMENDED') {
    throw new Error('LEARNING_RECOMMENDATION_NOT_PENDING');
  }
  if (decision.actorType !== 'HUMAN') throw new Error('LEARNING_SELF_PROMOTION_FORBIDDEN');
  if (!decision.actorId.trim()) throw new Error('LEARNING_DECISION_ACTOR_REQUIRED');
  assertTimestamp(decision.decidedAt, 'LEARNING_DECISION_TIMESTAMP_INVALID');
  if (Date.parse(decision.decidedAt) > Date.parse(recommendation.expiresAt)) {
    return {
      ...recommendation,
      status: 'EXPIRED',
      decidedBy: decision.actorId,
      decidedAt: decision.decidedAt,
      decisionEvidence: normalizeEvidence(decision.evidence),
    };
  }
  const evidence = normalizeEvidence(decision.evidence);
  if (evidence.length === 0) throw new Error('LEARNING_DECISION_EVIDENCE_REQUIRED');
  return {
    ...recommendation,
    status: decision.decision === 'ADOPT' ? 'ADOPTED' : 'REJECTED',
    decidedBy: decision.actorId,
    decidedAt: decision.decidedAt,
    decisionEvidence: evidence,
  };
}

export function deriveLearningAdoptionMetrics(
  recommendations: readonly LearningRecommendation[],
): LearningAdoptionMetrics {
  const adopted = recommendations.filter((item) => item.status === 'ADOPTED').length;
  const rejected = recommendations.filter((item) => item.status === 'REJECTED').length;
  const totalDecided = adopted + rejected;
  return {
    totalDecided,
    adopted,
    rejected,
    adoptionRate: totalDecided === 0 ? 0 : adopted / totalDecided,
  };
}

export function assertRecommendationCannotGrantAuthority(
  recommendation: LearningRecommendation,
): void {
  if (recommendation.authorityImpact === 'INCREASE') {
    if (
      recommendation.status !== 'ADOPTED' ||
      !recommendation.decidedBy ||
      !recommendation.decidedAt
    ) {
      throw new Error('LEARNING_AUTHORITY_INCREASE_REQUIRES_HUMAN_ADOPTION');
    }
    if (recommendation.decisionEvidence.length === 0) {
      throw new Error('LEARNING_AUTHORITY_INCREASE_EVIDENCE_REQUIRED');
    }
  }
}

function assertNoSystemAuthorityMutation(input: LearningRecommendationInput): void {
  const authorityTarget =
    input.targetType === 'PREAPPROVED_CLASS' ||
    /authority|preapproved|autonomy_mode|approval/i.test(input.targetKey);
  if (
    authorityTarget &&
    input.authorityImpact !== 'INCREASE' &&
    input.authorityImpact !== 'REDUCE'
  ) {
    throw new Error('LEARNING_AUTHORITY_IMPACT_REQUIRED');
  }
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('LEARNING_VALUE_INVALID');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  throw new Error('LEARNING_VALUE_INVALID');
}

function assertTimestamp(value: string, code: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(code);
}

function normalizeEvidence(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}
