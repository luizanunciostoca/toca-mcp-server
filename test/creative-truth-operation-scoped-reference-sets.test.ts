import { describe, expect, it } from 'vitest';
import {
  LEGACY_TOCA_VENUE_REFERENCE_SET_ID,
  TOCA_SUNSET_VENUE_REFERENCE_SET_ID,
  TOCA_THE_PARTY_VENUE_REFERENCE_SET_ID,
  operationScopedGenerativeExceptionApprovalSchema,
  referenceSetOperation,
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
  it('accepts Sunset and The Party sets and maps their operation deterministically', () => {
    expect(tocaGenerativeVenueReferenceSetIdSchema.parse(TOCA_SUNSET_VENUE_REFERENCE_SET_ID)).toBe(
      TOCA_SUNSET_VENUE_REFERENCE_SET_ID,
    );
    expect(tocaGenerativeVenueReferenceSetIdSchema.parse(TOCA_THE_PARTY_VENUE_REFERENCE_SET_ID)).toBe(
      TOCA_THE_PARTY_VENUE_REFERENCE_SET_ID,
    );
    expect(referenceSetOperation(TOCA_SUNSET_VENUE_REFERENCE_SET_ID)).toBe('SUNSET');
    expect(referenceSetOperation(TOCA_THE_PARTY_VENUE_REFERENCE_SET_ID)).toBe('THE_PARTY');
  });

  it('rejects the deprecated global reference set from new approvals', () => {
    expect(() => tocaGenerativeVenueReferenceSetIdSchema.parse(LEGACY_TOCA_VENUE_REFERENCE_SET_ID)).toThrow();
    expect(() =>
      operationScopedGenerativeExceptionApprovalSchema.parse({
        ...baseApproval,
        referenceSetId: LEGACY_TOCA_VENUE_REFERENCE_SET_ID,
      }),
    ).toThrow();
  });

  it.each([TOCA_SUNSET_VENUE_REFERENCE_SET_ID, TOCA_THE_PARTY_VENUE_REFERENCE_SET_ID])(
    'accepts a fail-closed approval for %s',
    (referenceSetId) => {
      expect(
        operationScopedGenerativeExceptionApprovalSchema.parse({ ...baseApproval, referenceSetId }),
      ).toMatchObject({ referenceSetId, minReferenceCount: 3 });
    },
  );
});
