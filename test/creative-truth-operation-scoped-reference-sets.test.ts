import { describe, expect, it } from 'vitest';
import {
  LEGACY_TOCA_VENUE_REFERENCE_SET_ID,
  TOCA_SUNSET_VENUE_REFERENCE_SET_ID,
  TOCA_THE_PARTY_VENUE_REFERENCE_SET_ID,
  operationScopedGenerativeExceptionApprovalSchema,
  referenceSetOperation,
  tocaGenerativeOperationSchema,
  tocaGenerativeVenueReferenceSetIdSchema,
} from '../src/contracts/creative-truth-generative-reference-sets.js';

const baseApproval = {
  exceptionId: 'GEN-1',
  contentItemId: 'CONTENT-1',
  requestedBy: 'LUIZ',
  approvedBy: 'LUIZ',
  approvalRef: 'approval:1',
  reason: 'Explicit controlled generation',
  minReferenceCount: 3,
  allowArchitecturalInvention: false,
  allowEnvironmentDrift: false,
  allowAiLogoGeneration: false,
  status: 'APPROVED' as const,
  createdAt: '2026-08-18T03:00:00Z',
};

describe('operation-scoped Creative Truth reference sets', () => {
  it('accepts the two explicit operations', () => {
    expect(tocaGenerativeOperationSchema.parse('SUNSET')).toBe('SUNSET');
    expect(tocaGenerativeOperationSchema.parse('THE_PARTY')).toBe('THE_PARTY');
    expect(() => tocaGenerativeOperationSchema.parse('ALL')).toThrow();
  });

  it('accepts Sunset and The Party sets and maps their operation deterministically', () => {
    expect(
      tocaGenerativeVenueReferenceSetIdSchema.parse(TOCA_SUNSET_VENUE_REFERENCE_SET_ID),
    ).toBe(TOCA_SUNSET_VENUE_REFERENCE_SET_ID);
    expect(
      tocaGenerativeVenueReferenceSetIdSchema.parse(TOCA_THE_PARTY_VENUE_REFERENCE_SET_ID),
    ).toBe(TOCA_THE_PARTY_VENUE_REFERENCE_SET_ID);
    expect(referenceSetOperation(TOCA_SUNSET_VENUE_REFERENCE_SET_ID)).toBe('SUNSET');
    expect(referenceSetOperation(TOCA_THE_PARTY_VENUE_REFERENCE_SET_ID)).toBe('THE_PARTY');
  });

  it('rejects the deprecated global reference set from new approvals', () => {
    expect(() =>
      tocaGenerativeVenueReferenceSetIdSchema.parse(LEGACY_TOCA_VENUE_REFERENCE_SET_ID),
    ).toThrow();
    expect(() =>
      operationScopedGenerativeExceptionApprovalSchema.parse({
        ...baseApproval,
        referenceSetId: LEGACY_TOCA_VENUE_REFERENCE_SET_ID,
        operation: 'SUNSET',
      }),
    ).toThrow();
  });

  it.each([
    [TOCA_SUNSET_VENUE_REFERENCE_SET_ID, 'SUNSET'],
    [TOCA_THE_PARTY_VENUE_REFERENCE_SET_ID, 'THE_PARTY'],
  ] as const)(
    'accepts a fail-closed approval for %s only under its matching operation',
    (referenceSetId, operation) => {
      expect(
        operationScopedGenerativeExceptionApprovalSchema.parse({
          ...baseApproval,
          referenceSetId,
          operation,
        }),
      ).toMatchObject({ referenceSetId, operation, minReferenceCount: 3 });
    },
  );

  it.each([
    [TOCA_SUNSET_VENUE_REFERENCE_SET_ID, 'THE_PARTY'],
    [TOCA_THE_PARTY_VENUE_REFERENCE_SET_ID, 'SUNSET'],
  ] as const)(
    'rejects operation/reference-set mismatch for %s with %s',
    (referenceSetId, operation) => {
      const parsed = operationScopedGenerativeExceptionApprovalSchema.safeParse({
        ...baseApproval,
        referenceSetId,
        operation,
      });
      expect(parsed.success).toBe(false);
      if (parsed.success) throw new Error('fixture must fail');
      expect(parsed.error.issues.map((issue) => issue.message)).toContain(
        'FAILED_GENERATIVE_REFERENCE_SET_OPERATION_MISMATCH',
      );
    },
  );
});
