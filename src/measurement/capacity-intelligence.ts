export const CAPACITY_STATUSES = [
  'UNKNOWN',
  'OPEN',
  'WATCH',
  'NEAR_CAPACITY',
  'SOLD_OUT',
  'BLOCKED',
] as const;

export type CapacityStatus = (typeof CAPACITY_STATUSES)[number];

export const OPERATIONAL_CONSTRAINT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export type OperationalConstraintSeverity = (typeof OPERATIONAL_CONSTRAINT_SEVERITIES)[number];

export interface OperationalConstraint {
  readonly constraintId: string;
  readonly type: string;
  readonly severity: OperationalConstraintSeverity;
  readonly blocksGrowth: boolean;
  readonly reason: string;
  readonly evidence: readonly string[];
}

export interface CapacityPolicy {
  readonly watchOccupancyRatio: number;
  readonly nearCapacityRatio: number;
  readonly maxIncreaseAtWatchPercent: number;
}

export interface CapacityObservation {
  readonly eventId: string;
  readonly capacity: number | null;
  readonly sold: number;
  readonly available: number | null;
  readonly held: number | null;
  readonly asOf: string;
  readonly constraints: readonly OperationalConstraint[];
  readonly evidence: readonly string[];
}

export interface OperationalCapacityAssessment {
  readonly eventId: string;
  readonly status: CapacityStatus;
  readonly capacity: number | null;
  readonly sold: number;
  readonly available: number | null;
  readonly held: number | null;
  readonly occupancyRatio: number | null;
  readonly allowDemandGrowth: boolean;
  readonly reasons: readonly string[];
  readonly constraints: readonly OperationalConstraint[];
  readonly asOf: string;
  readonly evidence: readonly string[];
}

export interface PaidMediaCapacityGuardrailInput {
  readonly desiredChangePercent: number;
  readonly capacity: OperationalCapacityAssessment | null;
  readonly policy: CapacityPolicy;
}

export interface PaidMediaCapacityGuardrailDecision {
  readonly requestedChangePercent: number;
  readonly allowedChangePercent: number;
  readonly blocked: boolean;
  readonly reason: string;
  readonly capacityStatus: CapacityStatus;
  readonly evidence: readonly string[];
}

export function assessOperationalCapacity(
  observation: CapacityObservation,
  policy: CapacityPolicy,
): OperationalCapacityAssessment {
  validateCapacityPolicy(policy);
  validateCapacityObservation(observation);

  const blockingConstraints = observation.constraints.filter(
    (constraint) => constraint.blocksGrowth,
  );
  const occupancyRatio =
    observation.capacity !== null && observation.capacity > 0
      ? clampRatio(observation.sold / observation.capacity)
      : null;
  const providerAvailable = observation.available;
  const computedAvailable =
    observation.capacity === null ? null : Math.max(0, observation.capacity - observation.sold);
  const available = providerAvailable ?? computedAvailable;
  const soldOut =
    observation.capacity !== null &&
    (observation.sold >= observation.capacity || (available !== null && available === 0));

  let status: CapacityStatus;
  const reasons: string[] = [];

  if (blockingConstraints.length > 0) {
    status = 'BLOCKED';
    reasons.push('OPERATIONAL_CONSTRAINT_BLOCKS_GROWTH');
  } else if (soldOut) {
    status = 'SOLD_OUT';
    reasons.push('EVENT_CAPACITY_EXHAUSTED');
  } else if (occupancyRatio === null) {
    status = 'UNKNOWN';
    reasons.push('CAPACITY_SOURCE_UNAVAILABLE');
  } else if (occupancyRatio >= policy.nearCapacityRatio) {
    status = 'NEAR_CAPACITY';
    reasons.push('NEAR_CAPACITY_THRESHOLD_REACHED');
  } else if (occupancyRatio >= policy.watchOccupancyRatio) {
    status = 'WATCH';
    reasons.push('CAPACITY_WATCH_THRESHOLD_REACHED');
  } else {
    status = 'OPEN';
    reasons.push('CAPACITY_WITHIN_GROWTH_WINDOW');
  }

  return {
    eventId: observation.eventId,
    status,
    capacity: observation.capacity,
    sold: observation.sold,
    available,
    held: observation.held,
    occupancyRatio,
    allowDemandGrowth: status === 'OPEN' || status === 'WATCH',
    reasons,
    constraints: [...observation.constraints],
    asOf: observation.asOf,
    evidence: normalizeEvidence([
      ...observation.evidence,
      ...observation.constraints.flatMap((constraint) => constraint.evidence),
    ]),
  };
}

export function applyPaidMediaCapacityGuardrail(
  input: PaidMediaCapacityGuardrailInput,
): PaidMediaCapacityGuardrailDecision {
  validateCapacityPolicy(input.policy);
  if (!Number.isFinite(input.desiredChangePercent)) {
    throw new Error('CAPACITY_GUARDRAIL_CHANGE_INVALID');
  }

  if (input.desiredChangePercent <= 0) {
    return {
      requestedChangePercent: input.desiredChangePercent,
      allowedChangePercent: input.desiredChangePercent,
      blocked: false,
      reason: 'NON_GROWTH_CHANGE_ALLOWED',
      capacityStatus: input.capacity?.status ?? 'UNKNOWN',
      evidence: input.capacity?.evidence ?? [],
    };
  }

  if (input.capacity === null || input.capacity.status === 'UNKNOWN') {
    return {
      requestedChangePercent: input.desiredChangePercent,
      allowedChangePercent: 0,
      blocked: true,
      reason: 'CAPACITY_UNKNOWN_FAIL_CLOSED',
      capacityStatus: 'UNKNOWN',
      evidence: input.capacity?.evidence ?? [],
    };
  }

  if (
    input.capacity.status === 'NEAR_CAPACITY' ||
    input.capacity.status === 'SOLD_OUT' ||
    input.capacity.status === 'BLOCKED'
  ) {
    return {
      requestedChangePercent: input.desiredChangePercent,
      allowedChangePercent: 0,
      blocked: true,
      reason: `CAPACITY_${input.capacity.status}_BLOCKS_GROWTH`,
      capacityStatus: input.capacity.status,
      evidence: input.capacity.evidence,
    };
  }

  if (input.capacity.status === 'WATCH') {
    const allowedChangePercent = Math.min(
      input.desiredChangePercent,
      input.policy.maxIncreaseAtWatchPercent,
    );
    return {
      requestedChangePercent: input.desiredChangePercent,
      allowedChangePercent,
      blocked: allowedChangePercent < input.desiredChangePercent,
      reason:
        allowedChangePercent < input.desiredChangePercent
          ? 'CAPACITY_WATCH_CLAMPS_GROWTH'
          : 'CAPACITY_WATCH_GROWTH_WITHIN_LIMIT',
      capacityStatus: input.capacity.status,
      evidence: input.capacity.evidence,
    };
  }

  return {
    requestedChangePercent: input.desiredChangePercent,
    allowedChangePercent: input.desiredChangePercent,
    blocked: false,
    reason: 'CAPACITY_OPEN_GROWTH_ALLOWED',
    capacityStatus: input.capacity.status,
    evidence: input.capacity.evidence,
  };
}

export function validateCapacityPolicy(policy: CapacityPolicy): void {
  if (
    !Number.isFinite(policy.watchOccupancyRatio) ||
    !Number.isFinite(policy.nearCapacityRatio) ||
    policy.watchOccupancyRatio < 0 ||
    policy.watchOccupancyRatio >= 1 ||
    policy.nearCapacityRatio <= 0 ||
    policy.nearCapacityRatio > 1 ||
    policy.watchOccupancyRatio >= policy.nearCapacityRatio
  ) {
    throw new Error('CAPACITY_POLICY_THRESHOLDS_INVALID');
  }
  if (!Number.isFinite(policy.maxIncreaseAtWatchPercent) || policy.maxIncreaseAtWatchPercent < 0) {
    throw new Error('CAPACITY_POLICY_WATCH_INCREASE_INVALID');
  }
}

function validateCapacityObservation(observation: CapacityObservation): void {
  requireText(observation.eventId, 'CAPACITY_EVENT_ID_REQUIRED');
  if (!Number.isFinite(Date.parse(observation.asOf))) throw new Error('CAPACITY_AS_OF_INVALID');
  validateNonNegativeInteger(observation.sold, 'CAPACITY_SOLD_INVALID');
  if (observation.capacity !== null) {
    validateNonNegativeInteger(observation.capacity, 'CAPACITY_TOTAL_INVALID');
    if (observation.sold > observation.capacity) throw new Error('CAPACITY_SOLD_EXCEEDS_TOTAL');
  }
  if (observation.available !== null) {
    validateNonNegativeInteger(observation.available, 'CAPACITY_AVAILABLE_INVALID');
  }
  if (observation.held !== null)
    validateNonNegativeInteger(observation.held, 'CAPACITY_HELD_INVALID');
  if (normalizeEvidence(observation.evidence).length === 0)
    throw new Error('CAPACITY_EVIDENCE_REQUIRED');
  for (const constraint of observation.constraints) validateConstraint(constraint);
}

function validateConstraint(constraint: OperationalConstraint): void {
  requireText(constraint.constraintId, 'CAPACITY_CONSTRAINT_ID_REQUIRED');
  requireText(constraint.type, 'CAPACITY_CONSTRAINT_TYPE_REQUIRED');
  requireText(constraint.reason, 'CAPACITY_CONSTRAINT_REASON_REQUIRED');
  if (!OPERATIONAL_CONSTRAINT_SEVERITIES.includes(constraint.severity)) {
    throw new Error('CAPACITY_CONSTRAINT_SEVERITY_INVALID');
  }
  if (normalizeEvidence(constraint.evidence).length === 0) {
    throw new Error('CAPACITY_CONSTRAINT_EVIDENCE_REQUIRED');
  }
}

function validateNonNegativeInteger(value: number, code: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(code);
}

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function requireText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function normalizeEvidence(evidence: readonly string[]): readonly string[] {
  return [...new Set(evidence.map((item) => item.trim()).filter(Boolean))].sort();
}
