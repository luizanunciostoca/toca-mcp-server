import { describe, expect, it, vi } from 'vitest';
import type {
  OperationScopedGenerativeExceptionApproval,
  TocaGenerativeOperation,
} from '../src/contracts/creative-truth-generative-reference-sets.js';
import type { VenueAsset, VenueReference } from '../src/contracts/creative-truth.js';
import { ControlledOperationScopedStaticImageGenerationService } from '../src/creative/controlled-operation-scoped-static-image-generation.js';
import type { CreativeTruthVenueReferenceLoader } from '../src/providers/google-drive/creative-truth-reference-loader.js';
import type { OperationScopedGenerativeRegistry } from '../src/providers/google-sheets/creative-truth-operation-scoped-generative-registry.js';
import type {
  OperationScopedGenerativeImageRequest,
  OperationScopedGenerativeImageResult,
} from '../src/providers/openai/creative-truth-operation-scoped-image-generator.js';

const TRUSTED_NOW = '2026-08-18T04:00:00Z';

const approval: OperationScopedGenerativeExceptionApproval = {
  exceptionId: 'GEN-SUN-1',
  contentItemId: 'CONTENT-SUN-1',
  requestedBy: 'LUIZ',
  approvedBy: 'LUIZ',
  approvalRef: 'approval:gen-sun-1',
  reason: 'Explicit controlled Sunset generation',
  referenceSetId: 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
  operation: 'SUNSET',
  minReferenceCount: 3,
  allowArchitecturalInvention: false,
  allowEnvironmentDrift: false,
  allowAiLogoGeneration: false,
  status: 'APPROVED',
  expiresAt: '2026-08-19T03:00:00Z',
  createdAt: '2026-08-18T03:00:00Z',
};

function reference(index: number, overrides: Partial<VenueReference> = {}): VenueReference {
  return {
    referenceSetId: 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
    referenceId: `REF-SUN-${index}`,
    assetId: `SUN-${index}`,
    driveFileId: `drive-${index}`,
    referenceClass: 'VENUE_REFERENCE',
    purpose: 'GENERATIVE_VENUE_TRUTH',
    requiredForGenerativeException: true,
    venueVerified: true,
    protectedElements: ['DECK', 'HORIZONTE'],
    status: 'ACTIVE',
    ...overrides,
  };
}

function venue(referenceValue: VenueReference): VenueAsset {
  return {
    venueAssetId: `VENUE-${referenceValue.assetId}`,
    sourceAssetId: referenceValue.assetId,
    sourceDriveFileId: referenceValue.driveFileId,
    sourceSha256: 'a'.repeat(64),
    operation: 'SUNSET',
    locationSignature: 'sunset-real',
    dominantSubject: 'venue',
    venueVerified: true,
    marketingReady: false,
    generativeReferenceAllowed: true,
    protectedElements: [...referenceValue.protectedElements],
    status: 'VENUE_VERIFIED_SOURCE',
  };
}

function resultFor(
  request: OperationScopedGenerativeImageRequest,
): OperationScopedGenerativeImageResult {
  return {
    outputBytes: Uint8Array.from([0xff, 0xd8, 1, 0xff, 0xd9]),
    outputContentType: 'image/jpeg',
    candidateSha256: 'b'.repeat(64),
    referenceAssetIds: request.references.map((entry) => entry.registry.assetId),
    referenceSha256s: request.references.map(() => 'a'.repeat(64)),
    policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
    referenceSetId: 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
    operation: 'SUNSET',
    exceptionId: approval.exceptionId,
    approvalRef: approval.approvalRef,
    creativeMode: 'GENERATIVE_EXCEPTION',
    provider: 'OPENAI_IMAGE_GENERATION',
    generationMode: 'FULL_STATIC_IMAGE_WITH_OPERATION_SCOPED_VERIFIED_REFERENCES',
    requiresPostGenerationHumanReview: true,
    requiresVenueFidelityGate: true,
    readyForFinalComposition: false,
    responseModel: 'gpt-5.6',
    imageToolModelSelection: 'RESPONSES_TOOL_MANAGED',
  };
}

function setup(
  references: readonly VenueReference[],
  contentOperation: TocaGenerativeOperation | undefined = 'SUNSET',
  approvalValue: OperationScopedGenerativeExceptionApproval = approval,
  nowIso = TRUSTED_NOW,
) {
  const assertCanonicalPolicy = vi.fn(async (): Promise<void> => undefined);
  const getContentItemOperation = vi.fn(async () => contentOperation);
  const getApprovedGenerativeException = vi.fn(async () => approvalValue);
  const getReferenceSet = vi.fn(async () => references);
  const getVenueAssetBySourceAssetId = vi.fn(async (assetId: string) => {
    const matched = references.find((entry) => entry.assetId === assetId);
    return matched ? venue(matched) : undefined;
  });
  const registry: OperationScopedGenerativeRegistry = {
    assertCanonicalPolicy,
    getContentItemOperation,
    getApprovedGenerativeException,
    getReferenceSet,
    getVenueAssetBySourceAssetId,
    getBrandAsset: vi.fn(async () => undefined),
    getCreativeStandard: vi.fn(async () => undefined),
  };

  const load = vi.fn(async (entry: VenueReference) => ({
    registry: entry,
    imageBytes: Uint8Array.from([
      0xff,
      0xd8,
      Number(entry.assetId.split('-')[1] ?? 1),
      0xff,
    ]),
    contentType: 'image/jpeg' as const,
  }));
  const referenceLoader: CreativeTruthVenueReferenceLoader = { load };
  const generate = vi.fn(async (request: OperationScopedGenerativeImageRequest) =>
    resultFor(request),
  );
  const service = new ControlledOperationScopedStaticImageGenerationService({
    registry,
    referenceLoader,
    generator: { generate },
    now: () => nowIso,
  });
  return {
    service,
    assertCanonicalPolicy,
    getContentItemOperation,
    getApprovedGenerativeException,
    getReferenceSet,
    load,
    generate,
  };
}

describe('ControlledOperationScopedStaticImageGenerationService', () => {
  it('uses only required references from the approved Sunset set and sorts them deterministically', async () => {
    const optional = reference(4, { requiredForGenerativeException: false });
    const deps = setup([reference(3), optional, reference(1), reference(2)]);

    const result = await deps.service.generate({
      contentItemId: 'CONTENT-SUN-1',
      prompt: 'Create a faithful Sunset scene.',
    });

    expect(deps.assertCanonicalPolicy).toHaveBeenCalledOnce();
    expect(deps.getContentItemOperation).toHaveBeenCalledWith('CONTENT-SUN-1');
    expect(deps.getApprovedGenerativeException).toHaveBeenCalledWith('CONTENT-SUN-1');
    expect(deps.getReferenceSet).toHaveBeenCalledWith(
      'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
    );
    expect(deps.load.mock.calls.map((call) => call[0].referenceId)).toEqual([
      'REF-SUN-1',
      'REF-SUN-2',
      'REF-SUN-3',
    ]);
    expect(deps.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        approval,
        contentItemId: 'CONTENT-SUN-1',
        prompt: 'Create a faithful Sunset scene.',
        nowIso: TRUSTED_NOW,
      }),
    );
    expect(result.referenceSetId).toBe('TOCA_VENUE_REFERENCE_SET_SUNSET_V1');
    expect(result.operation).toBe('SUNSET');
    expect(result.readyForFinalComposition).toBe(false);
  });

  it('fails before approval/reference loading when canonical content operation is missing', async () => {
    const deps = setup([reference(1), reference(2), reference(3)], undefined);

    await expect(
      deps.service.generate({
        contentItemId: 'CONTENT-SUN-1',
        prompt: 'Generate image',
      }),
    ).rejects.toThrow('FAILED_GENERATIVE_CONTENT_OPERATION_MISSING');
    expect(deps.getApprovedGenerativeException).not.toHaveBeenCalled();
    expect(deps.load).not.toHaveBeenCalled();
  });

  it('rejects an approval/reference set that conflicts with the canonical content operation', async () => {
    const deps = setup([reference(1), reference(2), reference(3)], 'THE_PARTY');

    await expect(
      deps.service.generate({
        contentItemId: 'CONTENT-SUN-1',
        prompt: 'Generate image',
      }),
    ).rejects.toThrow('FAILED_GENERATIVE_REFERENCE_SET_OPERATION_MISMATCH');
    expect(deps.getReferenceSet).not.toHaveBeenCalled();
    expect(deps.load).not.toHaveBeenCalled();
  });

  it('fails before reference download when the active scoped set does not contain three required references', async () => {
    const deps = setup([
      reference(1),
      reference(2),
      reference(3, { requiredForGenerativeException: false }),
    ]);

    await expect(
      deps.service.generate({
        contentItemId: 'CONTENT-SUN-1',
        prompt: 'Generate image',
      }),
    ).rejects.toThrow('FAILED_GENERATIVE_REFERENCE_MISSING');
    expect(deps.load).not.toHaveBeenCalled();
    expect(deps.generate).not.toHaveBeenCalled();
  });

  it('does not accept a cross-operation reference row inside the approved set', async () => {
    const deps = setup([
      reference(1),
      reference(2),
      reference(3, { referenceSetId: 'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1' }),
    ]);

    await expect(
      deps.service.generate({
        contentItemId: 'CONTENT-SUN-1',
        prompt: 'Generate image',
      }),
    ).rejects.toThrow('FAILED_GENERATIVE_REFERENCE_MISSING');
    expect(deps.load).not.toHaveBeenCalled();
  });

  it('cannot backdate an expired approval because the clock is an injected trusted dependency', async () => {
    const expired = {
      ...approval,
      expiresAt: '2026-08-18T03:59:59Z',
    };
    const deps = setup(
      [reference(1), reference(2), reference(3)],
      'SUNSET',
      expired,
      TRUSTED_NOW,
    );

    await expect(
      deps.service.generate({
        contentItemId: 'CONTENT-SUN-1',
        prompt: 'Generate image',
      }),
    ).rejects.toThrow('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION');
    expect(deps.load).not.toHaveBeenCalled();
    expect(deps.generate).not.toHaveBeenCalled();
  });

  it('fails closed if the trusted clock itself is invalid', async () => {
    const deps = setup(
      [reference(1), reference(2), reference(3)],
      'SUNSET',
      approval,
      'not-a-timestamp',
    );

    await expect(
      deps.service.generate({
        contentItemId: 'CONTENT-SUN-1',
        prompt: 'Generate image',
      }),
    ).rejects.toThrow('GENERATIVE_TRUSTED_CLOCK_INVALID');
    expect(deps.assertCanonicalPolicy).not.toHaveBeenCalled();
    expect(deps.generate).not.toHaveBeenCalled();
  });
});
