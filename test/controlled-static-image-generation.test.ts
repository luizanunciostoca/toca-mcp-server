import { describe, expect, it, vi } from 'vitest';
import type {
  GenerativeExceptionApproval,
  VenueReference,
} from '../src/contracts/creative-truth.js';
import { ControlledStaticImageGenerationService } from '../src/creative/controlled-static-image-generation.js';
import type { CreativeTruthOpenAiImageGenerator } from '../src/providers/openai/creative-truth-openai-image-generator.js';

const approval: GenerativeExceptionApproval = {
  exceptionId: 'GEN-STATIC-1',
  contentItemId: 'CONTENT-GEN-1',
  requestedBy: 'LUIZ',
  approvedBy: 'LUIZ',
  approvalRef: 'approval:content-gen-1',
  reason: 'Approved static generation',
  referenceSetId: 'TOCA_VENUE_REFERENCE_SET_V1',
  minReferenceCount: 3,
  allowArchitecturalInvention: false,
  allowEnvironmentDrift: false,
  allowAiLogoGeneration: false,
  status: 'APPROVED',
  expiresAt: '2026-08-19T00:00:00Z',
  createdAt: '2026-08-18T00:00:00Z',
};

function reference(index: number, overrides: Partial<VenueReference> = {}): VenueReference {
  return {
    referenceSetId: 'TOCA_VENUE_REFERENCE_SET_V1',
    referenceId: `REF-${index}`,
    assetId: `SUN-${index}`,
    driveFileId: `drive-${index}`,
    referenceClass: 'VENUE_REFERENCE',
    purpose: 'GENERATIVE_VENUE_TRUTH',
    requiredForGenerativeException: true,
    venueVerified: true,
    protectedElements: ['DECK'],
    status: 'ACTIVE',
    ...overrides,
  };
}

function dependencies(options: {
  approval?: GenerativeExceptionApproval;
  references?: readonly VenueReference[];
} = {}) {
  const canonicalApproval = options.approval ?? approval;
  const canonicalReferences = options.references ?? [reference(3), reference(1), reference(2)];
  const getApprovedGenerativeException = vi.fn(async (contentItemId: string) =>
    contentItemId === canonicalApproval.contentItemId ? canonicalApproval : undefined,
  );
  const getReferenceSet = vi.fn(async () => canonicalReferences);
  const load = vi.fn(async (entry: VenueReference) => ({
    registry: entry,
    imageBytes: Uint8Array.from([0xff, 0xd8, Number(entry.assetId.split('-')[1] ?? 1), 0xff]),
    contentType: 'image/jpeg' as const,
  }));
  const generate = vi.fn(
    async (request: Parameters<CreativeTruthOpenAiImageGenerator['generate']>[0]) => ({
      outputBytes: Uint8Array.from([0xff, 0xd8, 1, 0xff, 0xd9]),
      outputContentType: 'image/jpeg' as const,
      candidateSha256: 'a'.repeat(64),
      referenceAssetIds: request.references.map((entry) => entry.registry.assetId),
      referenceSha256s: ['b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)],
      policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1' as const,
      referenceSetId: 'TOCA_VENUE_REFERENCE_SET_V1' as const,
      exceptionId: canonicalApproval.exceptionId,
      approvalRef: canonicalApproval.approvalRef,
      creativeMode: 'GENERATIVE_EXCEPTION' as const,
      provider: 'OPENAI_IMAGE_GENERATION' as const,
      generationMode: 'FULL_STATIC_IMAGE_WITH_VERIFIED_REFERENCES' as const,
      requiresPostGenerationHumanReview: true as const,
      requiresVenueFidelityGate: true as const,
      readyForFinalComposition: false as const,
      responseModel: 'gpt-5.6',
      imageToolModelSelection: 'RESPONSES_TOOL_MANAGED' as const,
    }),
  );
  return {
    service: new ControlledStaticImageGenerationService({
      registry: { getApprovedGenerativeException, getReferenceSet },
      referenceLoader: { load },
      generator: { generate },
    }),
    getApprovedGenerativeException,
    getReferenceSet,
    load,
    generate,
  };
}

describe('ControlledStaticImageGenerationService', () => {
  it('loads canonical approved references deterministically before invoking the generator', async () => {
    const deps = dependencies();
    const result = await deps.service.generate({
      contentItemId: 'CONTENT-GEN-1',
      prompt: '  Create a premium sunset experience.  ',
      nowIso: '2026-08-18T03:00:00Z',
    });

    expect(deps.getApprovedGenerativeException).toHaveBeenCalledWith('CONTENT-GEN-1');
    expect(deps.getReferenceSet).toHaveBeenCalledWith('TOCA_VENUE_REFERENCE_SET_V1');
    expect(deps.load.mock.calls.map((call) => call[0].referenceId)).toEqual([
      'REF-1',
      'REF-2',
      'REF-3',
    ]);
    expect(deps.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        contentItemId: 'CONTENT-GEN-1',
        prompt: 'Create a premium sunset experience.',
        approval,
        nowIso: '2026-08-18T03:00:00Z',
      }),
    );
    expect(result.readyForFinalComposition).toBe(false);
  });

  it('fails closed when no canonical approved exception exists', async () => {
    const deps = dependencies();
    deps.getApprovedGenerativeException.mockResolvedValueOnce(undefined);

    await expect(
      deps.service.generate({
        contentItemId: 'CONTENT-GEN-1',
        prompt: 'Generate image',
        nowIso: '2026-08-18T03:00:00Z',
      }),
    ).rejects.toThrow('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION');
    expect(deps.getReferenceSet).not.toHaveBeenCalled();
    expect(deps.load).not.toHaveBeenCalled();
    expect(deps.generate).not.toHaveBeenCalled();
  });

  it('fails closed when canonical references are insufficient or duplicated', async () => {
    const insufficient = dependencies({ references: [reference(1), reference(2)] });
    await expect(
      insufficient.service.generate({
        contentItemId: 'CONTENT-GEN-1',
        prompt: 'Generate image',
        nowIso: '2026-08-18T03:00:00Z',
      }),
    ).rejects.toThrow('FAILED_GENERATIVE_REFERENCE_MISSING');
    expect(insufficient.load).not.toHaveBeenCalled();

    const duplicate = dependencies({
      references: [reference(1), reference(2), reference(3, { assetId: 'SUN-2' })],
    });
    await expect(
      duplicate.service.generate({
        contentItemId: 'CONTENT-GEN-1',
        prompt: 'Generate image',
        nowIso: '2026-08-18T03:00:00Z',
      }),
    ).rejects.toThrow('FAILED_GENERATIVE_REFERENCE_MISSING');
    expect(duplicate.load).not.toHaveBeenCalled();
  });

  it('rejects expired canonical approval before any reference download', async () => {
    const deps = dependencies({
      approval: { ...approval, expiresAt: '2026-08-18T02:00:00Z' },
    });

    await expect(
      deps.service.generate({
        contentItemId: 'CONTENT-GEN-1',
        prompt: 'Generate image',
        nowIso: '2026-08-18T03:00:00Z',
      }),
    ).rejects.toThrow('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION');
    expect(deps.getReferenceSet).not.toHaveBeenCalled();
    expect(deps.load).not.toHaveBeenCalled();
  });
});
