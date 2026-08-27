import { describe, expect, it } from 'vitest';
import {
  decideFailureContainment,
  type ExternalFaultContext,
} from '../src/core/failure-containment.js';

const base = (overrides: Partial<ExternalFaultContext>): ExternalFaultContext => ({
  type: 'PROCESS_CRASH',
  phase: 'BEFORE_EXTERNAL_CALL',
  sideEffectOutcome: 'NOT_STARTED',
  idempotencyKeyPresent: true,
  providerReadbackAvailable: true,
  approvalDescriptorMatches: true,
  clockSkewMs: 0,
  ...overrides,
});

describe('Autopilot fault injection matrix', () => {
  it.each([
    ['PROCESS_CRASH', 'RETRY_WITH_BACKOFF'],
    ['RATE_LIMIT_429', 'RETRY_WITH_BACKOFF'],
    ['PROVIDER_5XX', 'RETRY_WITH_BACKOFF'],
    ['NETWORK_LOSS', 'RETRY_WITH_BACKOFF'],
  ] as const)('permits bounded retry for %s only before the external call', (type, expected) => {
    const decision = decideFailureContainment(base({ type }));
    expect(decision.action).toBe(expected);
    expect(decision.retryAllowed).toBe(true);
    expect(decision.providerWriteAllowed).toBe(false);
  });

  it.each([
    ['PROCESS_CRASH', 'AFTER_EXTERNAL_CALL_BEFORE_ACK'],
    ['PROVIDER_5XX', 'EXTERNAL_CALL_STARTED'],
    ['NETWORK_LOSS', 'PROVIDER_READBACK'],
  ] as const)('reconciles without retry for %s during %s', (type, phase) => {
    const decision = decideFailureContainment(
      base({
        type,
        phase,
        sideEffectOutcome: 'UNKNOWN',
      }),
    );
    expect(decision.action).toBe('RECONCILE_WITHOUT_RETRY');
    expect(decision.retryAllowed).toBe(false);
  });

  it('opens the provider circuit for an expired token', () => {
    expect(decideFailureContainment(base({ type: 'TOKEN_EXPIRED' }))).toMatchObject({
      action: 'OPEN_PROVIDER_CIRCUIT',
      retryAllowed: false,
      reasonCode: 'PROVIDER_TOKEN_EXPIRED',
    });
  });

  it('acknowledges an exact duplicate webhook as a no-op and rejects digest mismatch', () => {
    expect(
      decideFailureContainment(
        base({
          type: 'DUPLICATE_WEBHOOK',
          phase: 'WEBHOOK_INGESTION',
          sideEffectOutcome: 'CONFIRMED_NONE',
          duplicateEventMatchesStoredDigest: true,
        }),
      ).action,
    ).toBe('ACKNOWLEDGE_DUPLICATE_NOOP');
    expect(
      decideFailureContainment(
        base({
          type: 'DUPLICATE_WEBHOOK',
          phase: 'WEBHOOK_INGESTION',
          sideEffectOutcome: 'CONFIRMED_NONE',
          duplicateEventMatchesStoredDigest: false,
        }),
      ).action,
    ).toBe('FAILED_REVIEW_REQUIRED');
  });

  it('requires a new approval for stale approval or descriptor drift', () => {
    expect(decideFailureContainment(base({ type: 'APPROVAL_STALE' }))).toMatchObject({
      action: 'REQUIRE_NEW_APPROVAL',
      reasonCode: 'APPROVAL_STALE',
    });
    expect(
      decideFailureContainment(
        base({ type: 'DESCRIPTOR_DRIFT', approvalDescriptorMatches: false }),
      ),
    ).toMatchObject({
      action: 'REQUIRE_NEW_APPROVAL',
      reasonCode: 'APPROVAL_DESCRIPTOR_DRIFT',
    });
  });

  it('blocks clock skew beyond one minute', () => {
    expect(
      decideFailureContainment(base({ type: 'CLOCK_SKEW', clockSkewMs: 60_001 })),
    ).toMatchObject({
      action: 'BLOCK_CLOCK_SKEW',
      retryAllowed: false,
    });
  });

  it('moves provider partial success to review required without retry', () => {
    expect(
      decideFailureContainment(
        base({
          type: 'PARTIAL_SUCCESS',
          phase: 'AFTER_EXTERNAL_CALL_BEFORE_ACK',
          sideEffectOutcome: 'PARTIAL',
        }),
      ),
    ).toMatchObject({
      action: 'FAILED_REVIEW_REQUIRED',
      retryAllowed: false,
      reasonCode: 'PROVIDER_PARTIAL_SUCCESS',
    });
  });

  it('fails closed when idempotency is missing even before the provider call', () => {
    expect(
      decideFailureContainment(base({ type: 'RATE_LIMIT_429', idempotencyKeyPresent: false }))
        .action,
    ).toBe('FAILED_REVIEW_REQUIRED');
  });
});
