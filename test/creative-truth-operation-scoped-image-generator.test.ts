import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { OperationScopedGenerativeExceptionApproval } from '../src/contracts/creative-truth-generative-reference-sets.js';
import type { VenueAsset, VenueReference } from '../src/contracts/creative-truth.js';
import type { SecretResolver } from '../src/core/secrets.js';
import type { OperationScopedGenerativeRegistry } from '../src/providers/google-sheets/creative-truth-operation-scoped-generative-registry.js';
import {
  CreativeTruthOperationScopedImageGenerator,
  type OperationScopedGenerativeVenueReferenceInput,
} from '../src/providers/openai/creative-truth-operation-scoped-image-generator.js';

const secretResolver: SecretResolver = {
  resolve: () => Promise.resolve('test-api-key'),
};

const approval: OperationScopedGenerativeExceptionApproval = {
  exceptionId: 'GEN-SUN-1',
  contentItemId: 'CONTENT-SUN-1',
  requestedBy: 'LUIZ',
  approvedBy: 'LUIZ',
  approvalRef: 'approval:gen-sun-1',
  reason: 'Explicit Sunset generation',
  referenceSetId: 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
  minReferenceCount: 3,
  allowArchitecturalInvention: false,
  allowEnvironmentDrift: false,
  allowAiLogoGeneration: false,
  status: 'APPROVED',
  expiresAt: '2026-08-19T03:00:00Z',
  createdAt: '2026-08-18T03:00:00Z',
};

function reference(index: number): OperationScopedGenerativeVenueReferenceInput {
  return {
    registry: {
      referenceSetId: 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
      referenceId: `REF-SUN-${index}`,
      assetId: `SUN-${index}`,
      driveFileId: `drive-${index}`,
      referenceClass: index === 1 ? 'WIDE_SPACE' : 'VENUE_REFERENCE',
      purpose: 'GENERATIVE_VENUE_TRUTH',
      requiredForGenerativeException: true,
      venueVerified: true,
      protectedElements: ['DECK', 'HORIZONTE'],
      status: 'ACTIVE',
    },
    imageBytes: Uint8Array.from([0xff, 0xd8, index, 0xff, 0xd9]),
    contentType: 'image/jpeg',
  };
}

function venue(input: OperationScopedGenerativeVenueReferenceInput, operation = 'SUNSET'): VenueAsset {
  return {
    venueAssetId: `VENUE-${input.registry.assetId}`,
    sourceAssetId: input.registry.assetId,
    sourceDriveFileId: input.registry.driveFileId,
    sourceSha256: createHash('sha256').update(input.imageBytes).digest('hex'),
    operation,
    locationSignature: 'verified-real-space',
    dominantSubject: 'venue',
    venueVerified: true,
    marketingReady: false,
    generativeReferenceAllowed: true,
    protectedElements: [...input.registry.protectedElements],
    status: 'VENUE_VERIFIED_SOURCE',
  };
}

function registryFor(
  inputs: readonly OperationScopedGenerativeVenueReferenceInput[],
  venueOperation = 'SUNSET',
): OperationScopedGenerativeRegistry {
  const canonicalReferences: readonly VenueReference[] = inputs.map((entry) => entry.registry);
  const venues = new Map(inputs.map((entry) => [entry.registry.assetId, venue(entry, venueOperation)]));
  return {
    assertCanonicalPolicy: vi.fn(async (): Promise<void> => undefined),
    getApprovedGenerativeException: vi.fn(async () => approval),
    getReferenceSet: vi.fn(async () => canonicalReferences),
    getVenueAssetBySourceAssetId: vi.fn(async (assetId: string) => venues.get(assetId)),
  };
}

function generator(registry: OperationScopedGenerativeRegistry, fetchImpl: typeof fetch) {
  return new CreativeTruthOperationScopedImageGenerator({
    secretResolver,
    apiKeyReference: { provider: 'env', key: 'OPENAI_API_KEY' },
    registry,
    fetchImpl,
  });
}

describe('CreativeTruthOperationScopedImageGenerator', () => {
  it('rejects a source whose VENUE_VISUALS operation does not match the approved reference set', async () => {
    const references = [reference(1), reference(2), reference(3)];
    const fetchImpl = vi.fn<typeof fetch>();
    const subject = generator(registryFor(references, 'THE_PARTY'), fetchImpl);

    await expect(
      subject.generate({
        contentItemId: 'CONTENT-SUN-1',
        prompt: 'Generate a faithful Sunset scene.',
        approval,
        references,
        nowIso: '2026-08-18T04:00:00Z',
      }),
    ).rejects.toThrow('GENERATIVE_REFERENCE_SOURCE_HASH_MISMATCH');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects The Party references attached to a Sunset approval before provider access', async () => {
    const references = [reference(1), reference(2), reference(3)];
    const crossed = references.map((entry) => ({
      ...entry,
      registry: { ...entry.registry, referenceSetId: 'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1' },
    }));
    const fetchImpl = vi.fn<typeof fetch>();
    const subject = generator(registryFor(references), fetchImpl);

    await expect(
      subject.generate({
        contentItemId: 'CONTENT-SUN-1',
        prompt: 'Generate image',
        approval,
        references: crossed,
        nowIso: '2026-08-18T04:00:00Z',
      }),
    ).rejects.toThrow('FAILED_GENERATIVE_REFERENCE_MISSING');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends only verified operation-scoped references through the managed Responses image tool', async () => {
    const references = [reference(1), reference(2), reference(3)];
    const output = Uint8Array.from([0xff, 0xd8, 9, 8, 7, 0xff, 0xd9]);
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        input: readonly { role: string; content: readonly Record<string, unknown>[] }[];
        tools: readonly Record<string, unknown>[];
        tool_choice: Record<string, unknown>;
      };
      expect(body.model).toBe('gpt-5.6');
      const policyText = String(body.input[0]?.content[0]?.text ?? '');
      expect(policyText).toContain('Operation truth scope: SUNSET');
      expect(policyText).toContain('TOCA_VENUE_REFERENCE_SET_SUNSET_V1');
      expect(policyText).toContain('Do not borrow venue facts from another Toca operation');
      expect(policyText).toContain('Do not generate, redraw, repair, imitate or approximate');
      expect(body.input[1]?.content.filter((item) => item.type === 'input_image')).toHaveLength(3);
      expect(body.tools[0]).toMatchObject({
        type: 'image_generation',
        action: 'generate',
        quality: 'high',
        size: '1024x1536',
        output_format: 'jpeg',
      });
      expect(body.tools[0]).not.toHaveProperty('model');
      expect(body.tools[0]).not.toHaveProperty('input_fidelity');
      return new Response(
        JSON.stringify({
          output: [
            {
              type: 'image_generation_call',
              status: 'completed',
              result: Buffer.from(output).toString('base64'),
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const result = await generator(registryFor(references), fetchImpl).generate({
      contentItemId: 'CONTENT-SUN-1',
      prompt: 'Generate a faithful Sunset scene.',
      approval,
      references,
      nowIso: '2026-08-18T04:00:00Z',
    });

    expect(result.operation).toBe('SUNSET');
    expect(result.referenceSetId).toBe('TOCA_VENUE_REFERENCE_SET_SUNSET_V1');
    expect(result.referenceAssetIds).toEqual(['SUN-1', 'SUN-2', 'SUN-3']);
    expect(result.candidateSha256).toBe(createHash('sha256').update(output).digest('hex'));
    expect(result.imageToolModelSelection).toBe('RESPONSES_TOOL_MANAGED');
    expect(result.requiresPostGenerationHumanReview).toBe(true);
    expect(result.readyForFinalComposition).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
