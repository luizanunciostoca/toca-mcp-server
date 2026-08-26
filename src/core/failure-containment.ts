export const EXTERNAL_FAULT_TYPES = [
  'PROCESS_CRASH',
  'RATE_LIMIT_429',
  'PROVIDER_5XX',
  'TOKEN_EXPIRED',
  'NETWORK_LOSS',
  'DUPLICATE_WEBHOOK',
  'CLOCK_SKEW',
  'APPROVAL_STALE',
  'DESCRIPTOR_DRIFT',
  'PARTIAL_SUCCESS',
] as const;
export type ExternalFaultType = (typeof EXTERNAL_FAULT_TYPES)[number];

export const EXTERNAL_FAULT_PHASES = [
  'BEFORE_EXTERNAL_CALL',
  'EXTERNAL_CALL_STARTED',
  'AFTER_EXTERNAL_CALL_BEFORE_ACK',
  'PROVIDER_READBACK',
  'WEBHOOK_INGESTION',
] as const;
export type ExternalFaultPhase = (typeof EXTERNAL_FAULT_PHASES)[number];

export type FailureContainmentAction =
  | 'RETRY_WITH_BACKOFF'
  | 'RECONCILE_WITHOUT_RETRY'
  | 'OPEN_PROVIDER_CIRCUIT'
  | 'REQUIRE_NEW_APPROVAL'
  | 'ACKNOWLEDGE_DUPLICATE_NOOP'
  | 'FAILED_REVIEW_REQUIRED'
  | 'BLOCK_CLOCK_SKEW';

export interface ExternalFaultContext {
  readonly type: ExternalFaultType;
  readonly phase: ExternalFaultPhase;
  readonly sideEffectOutcome:
    'NOT_STARTED' | 'CONFIRMED_NONE' | 'CONFIRMED_APPLIED' | 'UNKNOWN' | 'PARTIAL';
  readonly idempotencyKeyPresent: boolean;
  readonly providerReadbackAvailable: boolean;
  readonly approvalDescriptorMatches: boolean;
  readonly clockSkewMs: number;
  readonly duplicateEventMatchesStoredDigest?: boolean;
}

export interface FailureContainmentDecision {
  readonly action: FailureContainmentAction;
  readonly retryAllowed: boolean;
  readonly providerWriteAllowed: boolean;
  readonly reasonCode: string;
  readonly evidenceRequired: readonly string[];
}

export function decideFailureContainment(
  context: ExternalFaultContext,
): FailureContainmentDecision {
  assertContext(context);

  if (context.type === 'DUPLICATE_WEBHOOK') {
    if (
      context.phase === 'WEBHOOK_INGESTION' &&
      context.duplicateEventMatchesStoredDigest === true
    ) {
      return decision(
        'ACKNOWLEDGE_DUPLICATE_NOOP',
        false,
        false,
        'DUPLICATE_WEBHOOK_DIGEST_MATCH',
        ['stored-event-digest', 'incoming-event-digest'],
      );
    }
    return review('DUPLICATE_WEBHOOK_DIGEST_MISMATCH');
  }

  if (context.type === 'CLOCK_SKEW' || Math.abs(context.clockSkewMs) > 60_000) {
    return decision('BLOCK_CLOCK_SKEW', false, false, 'CLOCK_SKEW_EXCEEDS_LIMIT', [
      'trusted-clock-sample',
      'request-timestamp',
    ]);
  }

  if (context.type === 'APPROVAL_STALE') {
    return decision('REQUIRE_NEW_APPROVAL', false, false, 'APPROVAL_STALE', [
      'approval-expires-at',
      'trusted-clock-sample',
    ]);
  }

  if (context.type === 'DESCRIPTOR_DRIFT' || !context.approvalDescriptorMatches) {
    return decision('REQUIRE_NEW_APPROVAL', false, false, 'APPROVAL_DESCRIPTOR_DRIFT', [
      'approved-descriptor-sha256',
      'execution-descriptor-sha256',
    ]);
  }

  if (context.type === 'PARTIAL_SUCCESS' || context.sideEffectOutcome === 'PARTIAL') {
    return review('PROVIDER_PARTIAL_SUCCESS');
  }

  if (context.type === 'TOKEN_EXPIRED') {
    return decision('OPEN_PROVIDER_CIRCUIT', false, false, 'PROVIDER_TOKEN_EXPIRED', [
      'provider-auth-error',
      'credential-version-ref',
    ]);
  }

  if (
    context.phase === 'BEFORE_EXTERNAL_CALL' &&
    (context.sideEffectOutcome === 'NOT_STARTED' || context.sideEffectOutcome === 'CONFIRMED_NONE')
  ) {
    if (!context.idempotencyKeyPresent) return review('IDEMPOTENCY_KEY_MISSING');
    if (
      ['PROCESS_CRASH', 'RATE_LIMIT_429', 'PROVIDER_5XX', 'NETWORK_LOSS'].includes(context.type)
    ) {
      return decision('RETRY_WITH_BACKOFF', true, false, 'SAFE_RETRY_BEFORE_EXTERNAL_CALL', [
        'attempt-log',
        'idempotency-key',
        'retry-schedule',
      ]);
    }
  }

  if (
    context.phase === 'EXTERNAL_CALL_STARTED' ||
    context.phase === 'AFTER_EXTERNAL_CALL_BEFORE_ACK' ||
    context.phase === 'PROVIDER_READBACK' ||
    context.sideEffectOutcome === 'UNKNOWN' ||
    context.sideEffectOutcome === 'CONFIRMED_APPLIED'
  ) {
    if (context.providerReadbackAvailable) {
      return decision(
        'RECONCILE_WITHOUT_RETRY',
        false,
        false,
        'EXTERNAL_OUTCOME_REQUIRES_RECONCILIATION',
        ['provider-readback', 'idempotency-key', 'execution-descriptor'],
      );
    }
    return review('EXTERNAL_OUTCOME_UNKNOWN_WITHOUT_READBACK');
  }

  return review('FAULT_NOT_SAFE_TO_RETRY');
}

function review(reasonCode: string): FailureContainmentDecision {
  return decision('FAILED_REVIEW_REQUIRED', false, false, reasonCode, [
    'execution-log',
    'approval-record',
    'provider-state',
  ]);
}

function decision(
  action: FailureContainmentAction,
  retryAllowed: boolean,
  providerWriteAllowed: boolean,
  reasonCode: string,
  evidenceRequired: readonly string[],
): FailureContainmentDecision {
  return {
    action,
    retryAllowed,
    providerWriteAllowed,
    reasonCode,
    evidenceRequired,
  };
}

function assertContext(context: ExternalFaultContext): void {
  if (!EXTERNAL_FAULT_TYPES.includes(context.type)) throw new Error('FAULT_TYPE_INVALID');
  if (!EXTERNAL_FAULT_PHASES.includes(context.phase)) throw new Error('FAULT_PHASE_INVALID');
  if (!Number.isFinite(context.clockSkewMs)) throw new Error('FAULT_CLOCK_SKEW_INVALID');
  if (context.sideEffectOutcome === 'NOT_STARTED' && context.phase !== 'BEFORE_EXTERNAL_CALL') {
    throw new Error('FAULT_OUTCOME_PHASE_CONFLICT');
  }
}
