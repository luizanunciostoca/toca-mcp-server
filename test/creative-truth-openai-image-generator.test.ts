import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type {
  GenerativeExceptionApproval,
  VenueAsset,
  VenueReference,
} from '../src/contracts/creative-truth.js';
import type { SecretResolver } from '../src/core/secrets.js';
import type { GoogleSheetsCreativeTruthRegistry } from '../src/providers/google-sheets/creative-truth-registry.js';
import {
  CreativeTruthOpenAiImageGenerator,
  type GenerativeVenueReferenceInput,
} from '../src/providers/openai/creative-truth-openai-image-generator.js';

const secretResolver: SecretResolver = {
  resolve: () => Promise.resolve('test-api-key'),
};

const approval: GenerativeExceptionApproval = {
  exceptionId: 'GEN-STATIC-1',
  contentItemId: 'CONTENT-GEN-1',
  requestedBy: 'LUIZ',
  approvedBy: 'LUIZ',
  approvalRef: 'approval:content-gen-1',
  reason: 'Explicit controlled static image generation',
  referenceSetId: 'TOCA_VENUE_REFERENCE_SET_V1',
  minReferenceCount: 3,
  allowArchitecturalInvention: false,
  allowEnvironmentDrift: false,
  allowAiLogoGeneration: false,
  status: 'APPROVED',
  expiresAt: '2026-08-19T03:00:00Z',
  createdAt: '2026-08-18T03:00:00Z',
};

function registryReference(index: number, overrides: Partial<VenueReference> = {}): VenueReference {
  return {
    referenceSetId: 'TOCA_VENUE_REFERENCE_SET_V1',
    referenceId: `REF-GEN-${index}`,
    assetId: `SUN-GEN-${index}`,
    driveFileId: `drive-gen-${index}`,
    referenceClass: index === 1 ? 'DECK' : 'VENUE_REFERENCE',
    purpose: 'GENERATIVE_VENUE_TRUTH',
    requiredForGenerativeException: true,
    venueVerified: true,
    protectedElements: ['DECK', 'RAILING', 'HORIZONTE'],
    status: 'ACTIVE',
    ...overrides,
  };
}

function reference(
  index: number,
  overrides: Partial<GenerativeVenueReferenceInput> = {},
): GenerativeVenueReferenceInput {
  return {
    registry: registryReference(index),
    imageBytes: Uint8Array.from([0xff, 0xd8, index, 0xff, 0xd9]),
    contentType: 'image/jpeg',
    ...overrides,
  };
}

function sourceSha256(referenceInput: GenerativeVenueReferenceInput): string {
  return createHash('sha256').update(referenceInput.imageBytes).digest('hex');
}

function canonicalVenueAsset(referenceInput: GenerativeVenueReferenceInput): VenueAsset {
  return {
    venueAssetId: `VENUE-${referenceInput.registry.assetId}`,
    sourceAssetId: referenceInput.registry.assetId,
    sourceDriveFileId: referenceInput.registry.driveFileId,
    sourceSha256: sourceSha256(referenceInput),
    operation: 'SUNSET',
    locationSignature: 'verified-reference',
    dominantSubject: 'venue-truth',
    venueVerified: true,
    marketingReady: false,
    generativeReferenceAllowed: true,
    protectedElements: [...referenceInput.registry.protectedElements],
    status: 'VENUE_VERIFIED_SOURCE',
  };
}

type RegistryBoundary = Pick<
  GoogleSheetsCreativeTruthRegistry,
  'assertCanonicalPolicy' | 'listVenueAssets'
>;

function canonicalRegistry(
  references: readonly GenerativeVenueReferenceInput[] = [reference(1), reference(2), reference(3)],
  venueOverrides: Readonly<Record<string, Partial<VenueAsset>>> = {},
): RegistryBoundary {
  const assets = references.map((referenceInput) => ({
    ...canonicalVenueAsset(referenceInput),
    ...(venueOverrides[referenceInput.registry.assetId] ?? {}),
  }));
  return {
    assertCanonicalPolicy: vi.fn(async () => undefined),
    listVenueAssets: vi.fn(async () => assets),
  };
}

function request(
  overrides: Partial<Parameters<CreativeTruthOpenAiImageGenerator['generate']>[0]> = {},
) {
  return {
    contentItemId: 'CONTENT-GEN-1',
    prompt: 'Create a premium sunset lifestyle scene at the real Toca venue.',
    approval,
    references: [reference(1), reference(2), reference(3)],
    nowIso: '2026-08-18T04:00:00Z',
    ...overrides,
  };
}

function generatorWith(
  registry: RegistryBoundary,
  fetchImpl: typeof fetch = vi.fn<typeof fetch>(),
): CreativeTruthOpenAiImageGenerator {
  return new CreativeTruthOpenAiImageGenerator({
    secretResolver,
    apiKeyReference: { provider: 'env', key: 'OPENAI_API_KEY' },
    registry,
    fetchImpl,
  });
}

describe('CreativeTruthOpenAiImageGenerator', () => {
  it('fails closed before provider access when approval belongs to another content item', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const canonical = canonicalRegistry();
    const generator = generatorWith(canonical, fetchImpl);

    await expect(
      generator.generate(
        request({
          approval: { ...approval, contentItemId: 'OTHER-CONTENT' },
        }),
      ),
    ).rejects.toThrow('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION');
    expect(canonical.assertCanonicalPolicy).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when fewer than three verified venue references are supplied', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const canonical = canonicalRegistry();
    const generator = generatorWith(canonical, fetchImpl);

    await expect(
      generator.generate(request({ references: [reference(1), reference(2)] })),
    ).rejects.toThrow('FAILED_GENERATIVE_REFERENCE_MISSING');
    expect(canonical.assertCanonicalPolicy).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed on revoked, unverified, duplicate or empty reference evidence', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const canonical = canonicalRegistry();
    const generator = generatorWith(canonical, fetchImpl);

    await expect(
      generator.generate(
        request({
          references: [
            reference(1),
            reference(2),
            reference(3, { registry: registryReference(3, { status: 'REVOKED' }) }),
          ],
        }),
      ),
    ).rejects.toThrow('FAILED_GENERATIVE_REFERENCE_MISSING');

    await expect(
      generator.generate(
        request({
          references: [reference(1), reference(2), reference(3, { imageBytes: new Uint8Array() })],
        }),
      ),
    ).rejects.toThrow('FAILED_GENERATIVE_REFERENCE_MISSING');

    await expect(
      generator.generate(
        request({
          references: [reference(1), reference(2), reference(3, { registry: registryReference(1) })],
        }),
      ),
    ).rejects.toThrow('FAILED_GENERATIVE_REFERENCE_MISSING');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects reference bytes that do not equal the source SHA pinned in the canonical venue registry', async () => {
    const references = [reference(1), reference(2), reference(3)];
    const fetchImpl = vi.fn<typeof fetch>();
    const canonical = canonicalRegistry(references, {
      'SUN-GEN-3': { sourceSha256: 'f'.repeat(64) },
    });
    const generator = generatorWith(canonical, fetchImpl);

    await expect(generator.generate(request({ references }))).rejects.toThrow(
      'GENERATIVE_REFERENCE_SOURCE_HASH_MISMATCH',
    );
    expect(canonical.assertCanonicalPolicy).toHaveBeenCalledOnce();
    expect(canonical.listVenueAssets).toHaveBeenCalledOnce();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a reference whose Drive identity differs from the canonical venue source', async () => {
    const references = [reference(1), reference(2), reference(3)];
    const fetchImpl = vi.fn<typeof fetch>();
    const canonical = canonicalRegistry(references, {
      'SUN-GEN-2': { sourceDriveFileId: 'different-drive-file' },
    });
    const generator = generatorWith(canonical, fetchImpl);

    await expect(generator.generate(request({ references }))).rejects.toThrow(
      'GENERATIVE_REFERENCE_SOURCE_HASH_MISMATCH',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the exact canonical verified reference images under a higher-priority Creative Truth policy', async () => {
    const references = [reference(1), reference(2), reference(3)];
    const canonical = canonicalRegistry(references);
    const output = Uint8Array.from([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://api.openai.com/v1/responses');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toEqual({
        Authorization: 'Bearer test-api-key',
        'Content-Type': 'application/json',
      });
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        input: readonly {
          role: string;
          content: readonly Record<string, unknown>[];
        }[];
        tools: readonly Record<string, unknown>[];
        tool_choice: Record<string, unknown>;
      };
      expect(body.model).toBe('gpt-5');
      expect(body.input[0]?.role).toBe('developer');
      const policyText = String(body.input[0]?.content[0]?.text ?? '');
      expect(policyText).toContain('TOCA_CREATIVE_TRUTH_POLICY_V1');
      expect(policyText).toContain('only source of venue spatial and architectural truth');
      expect(policyText).toContain('Do not generate, redraw, repair, imitate or approximate');
      expect(policyText).toContain('NOT approved final creative');

      expect(body.input[1]?.role).toBe('user');
      const images = body.input[1]?.content.filter((item) => item.type === 'input_image') ?? [];
      expect(images).toHaveLength(3);
      expect(images.every((item) => item.detail === 'high')).toBe(true);
      expect(String(images[0]?.image_url)).toMatch(/^data:image\/jpeg;base64,/);

      expect(body.tools).toEqual([
        expect.objectContaining({
          type: 'image_generation',
          action: 'generate',
          model: 'gpt-image-1',
          input_fidelity: 'high',
          quality: 'high',
          output_format: 'jpeg',
        }),
      ]);
      expect(body.tool_choice).toEqual({ type: 'image_generation' });

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

    const generator = generatorWith(canonical, fetchImpl);
    const result = await generator.generate(request({ references }));

    expect(canonical.assertCanonicalPolicy).toHaveBeenCalledOnce();
    expect(canonical.listVenueAssets).toHaveBeenCalledOnce();
    expect(result.outputBytes).toEqual(output);
    expect(result.outputContentType).toBe('image/jpeg');
    expect(result.candidateSha256).toBe(createHash('sha256').update(output).digest('hex'));
    expect(result.referenceAssetIds).toEqual(['SUN-GEN-1', 'SUN-GEN-2', 'SUN-GEN-3']);
    expect(result.referenceSha256s).toEqual(references.map(sourceSha256));
    expect(result.policyId).toBe('TOCA_CREATIVE_TRUTH_POLICY_V1');
    expect(result.referenceSetId).toBe('TOCA_VENUE_REFERENCE_SET_V1');
    expect(result.creativeMode).toBe('GENERATIVE_EXCEPTION');
    expect(result.generationMode).toBe('FULL_STATIC_IMAGE_WITH_VERIFIED_REFERENCES');
    expect(result.requiresPostGenerationHumanReview).toBe(true);
    expect(result.requiresVenueFidelityGate).toBe(true);
    expect(result.readyForFinalComposition).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('rejects missing or non-JPEG generated output instead of treating it as reviewable', async () => {
    const references = [reference(1), reference(2), reference(3)];
    const canonical = canonicalRegistry(references);
    const missingGenerator = generatorWith(canonical, () =>
      Promise.resolve(
        new Response(JSON.stringify({ output: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    await expect(missingGenerator.generate(request({ references }))).rejects.toThrow(
      'OPENAI_CREATIVE_TRUTH_IMAGE_GENERATION_RESPONSE_MISSING_IMAGE',
    );

    const invalidGenerator = generatorWith(canonicalRegistry(references), () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            output: [
              {
                type: 'image_generation_call',
                status: 'completed',
                result: Buffer.from(Uint8Array.from([1, 2, 3, 4])).toString('base64'),
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    await expect(invalidGenerator.generate(request({ references }))).rejects.toThrow(
      'OPENAI_CREATIVE_TRUTH_IMAGE_GENERATION_RESPONSE_INVALID_JPEG',
    );
  });
});
