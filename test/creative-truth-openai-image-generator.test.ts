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

function canonicalVenueAsset(
  input: GenerativeVenueReferenceInput,
  overrides: Partial<VenueAsset> = {},
): VenueAsset {
  return {
    venueAssetId: `VENUE-${input.registry.assetId}`,
    sourceAssetId: input.registry.assetId,
    sourceDriveFileId: input.registry.driveFileId,
    sourceSha256: sourceSha256(input),
    operation: 'SUNSET',
    locationSignature: 'verified-reference',
    dominantSubject: 'venue-truth',
    venueVerified: true,
    marketingReady: false,
    generativeReferenceAllowed: true,
    protectedElements: [...input.registry.protectedElements],
    status: 'VENUE_VERIFIED_SOURCE',
    ...overrides,
  };
}

type RegistryBoundary = Pick<
  GoogleSheetsCreativeTruthRegistry,
  | 'assertCanonicalPolicy'
  | 'getApprovedGenerativeException'
  | 'getReferenceSet'
  | 'getVenueAssetBySourceAssetId'
>;

function canonicalRegistry(
  expectedInputs: readonly GenerativeVenueReferenceInput[] = [reference(1), reference(2), reference(3)],
  options: {
    readonly canonicalApproval?: GenerativeExceptionApproval | null;
    readonly canonicalReferences?: readonly VenueReference[];
    readonly venueOverrides?: Readonly<Record<string, Partial<VenueAsset>>>;
  } = {},
): RegistryBoundary {
  const canonicalApproval =
    options.canonicalApproval === undefined ? approval : options.canonicalApproval;
  const canonicalReferences =
    options.canonicalReferences ?? expectedInputs.map((item) => item.registry);
  const venueByAssetId = new Map(
    expectedInputs.map((input) => [
      input.registry.assetId,
      canonicalVenueAsset(input, options.venueOverrides?.[input.registry.assetId]),
    ] as const),
  );

  return {
    assertCanonicalPolicy: vi.fn(async () => undefined),
    getApprovedGenerativeException: vi.fn(async (contentItemId: string) =>
      canonicalApproval?.contentItemId === contentItemId ? canonicalApproval : undefined,
    ),
    getReferenceSet: vi.fn(async () => canonicalReferences),
    getVenueAssetBySourceAssetId: vi.fn(async (assetId: string) => venueByAssetId.get(assetId)),
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
  it('fails closed before canonical/provider access when approval belongs to another content item', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const canonical = canonicalRegistry();

    await expect(
      generatorWith(canonical, fetchImpl).generate(
        request({ approval: { ...approval, contentItemId: 'OTHER-CONTENT' } }),
      ),
    ).rejects.toThrow('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION');
    expect(canonical.assertCanonicalPolicy).not.toHaveBeenCalled();
    expect(canonical.getApprovedGenerativeException).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when the canonical exception approval is missing', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const canonical = canonicalRegistry(undefined, { canonicalApproval: null });

    await expect(generatorWith(canonical, fetchImpl).generate(request())).rejects.toThrow(
      'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
    );
    expect(canonical.assertCanonicalPolicy).toHaveBeenCalledOnce();
    expect(canonical.getApprovedGenerativeException).toHaveBeenCalledWith('CONTENT-GEN-1');
    expect(canonical.getReferenceSet).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a caller approval that differs from the canonical approval record', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const canonical = canonicalRegistry();

    await expect(
      generatorWith(canonical, fetchImpl).generate(
        request({ approval: { ...approval, approvalRef: 'caller-forged-approval-ref' } }),
      ),
    ).rejects.toThrow('GENERATIVE_APPROVAL_CANONICAL_IDENTITY_MISMATCH');
    expect(canonical.getApprovedGenerativeException).toHaveBeenCalledWith('CONTENT-GEN-1');
    expect(canonical.getReferenceSet).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when fewer than three verified venue references are supplied', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const canonical = canonicalRegistry();

    await expect(
      generatorWith(canonical, fetchImpl).generate(
        request({ references: [reference(1), reference(2)] }),
      ),
    ).rejects.toThrow('FAILED_GENERATIVE_REFERENCE_MISSING');
    expect(canonical.assertCanonicalPolicy).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed on revoked, duplicate, empty or MIME-signature-invalid supplied references', async () => {
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

    await expect(
      generator.generate(
        request({
          references: [
            reference(1),
            reference(2),
            reference(3, {
              contentType: 'image/png',
              imageBytes: Uint8Array.from([0xff, 0xd8, 3, 0xff, 0xd9]),
            }),
          ],
        }),
      ),
    ).rejects.toThrow('FAILED_GENERATIVE_REFERENCE_MISSING');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects caller metadata that does not match the canonical reference identity', async () => {
    const expected = [reference(1), reference(2), reference(3)];
    const supplied = [
      expected[0]!,
      expected[1]!,
      reference(3, {
        registry: registryReference(3, {
          referenceId: 'FAKE-REF-ID',
          driveFileId: 'fake-drive-id',
        }),
      }),
    ];
    const fetchImpl = vi.fn<typeof fetch>();
    const canonical = canonicalRegistry(expected);

    await expect(
      generatorWith(canonical, fetchImpl).generate(request({ references: supplied })),
    ).rejects.toThrow('GENERATIVE_REFERENCE_CANONICAL_IDENTITY_MISMATCH');
    expect(canonical.getReferenceSet).toHaveBeenCalledWith('TOCA_VENUE_REFERENCE_SET_V1');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects reference bytes that do not equal the source SHA pinned in canonical VENUE_VISUALS', async () => {
    const expected = [reference(1), reference(2), reference(3)];
    const substituted = [
      expected[0]!,
      expected[1]!,
      reference(3, { imageBytes: Uint8Array.from([0xff, 0xd8, 99, 0xff, 0xd9]) }),
    ];
    const fetchImpl = vi.fn<typeof fetch>();
    const canonical = canonicalRegistry(expected);

    await expect(
      generatorWith(canonical, fetchImpl).generate(request({ references: substituted })),
    ).rejects.toThrow('GENERATIVE_REFERENCE_SOURCE_HASH_MISMATCH');
    expect(canonical.assertCanonicalPolicy).toHaveBeenCalledOnce();
    expect(canonical.getApprovedGenerativeException).toHaveBeenCalledOnce();
    expect(canonical.getVenueAssetBySourceAssetId).toHaveBeenCalledWith('SUN-GEN-3');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects canonical reference assets with mismatched source SHA or Drive identity', async () => {
    const expected = [reference(1), reference(2), reference(3)];
    const fetchImpl = vi.fn<typeof fetch>();

    const wrongHash = canonicalRegistry(expected, {
      venueOverrides: { 'SUN-GEN-2': { sourceSha256: 'f'.repeat(64) } },
    });
    await expect(
      generatorWith(wrongHash, fetchImpl).generate(request({ references: expected })),
    ).rejects.toThrow('GENERATIVE_REFERENCE_SOURCE_HASH_MISMATCH');

    const wrongDrive = canonicalRegistry(expected, {
      venueOverrides: { 'SUN-GEN-2': { sourceDriveFileId: 'different-drive-file' } },
    });
    await expect(
      generatorWith(wrongDrive, fetchImpl).generate(request({ references: expected })),
    ).rejects.toThrow('GENERATIVE_REFERENCE_SOURCE_HASH_MISMATCH');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects ambiguous duplicate canonical rows for the same source asset', async () => {
    const expected = [reference(1), reference(2), reference(3)];
    const canonical = canonicalRegistry(expected, {
      canonicalReferences: [
        expected[0]!.registry,
        { ...expected[0]!.registry, referenceId: 'REF-DUPLICATE' },
        expected[1]!.registry,
        expected[2]!.registry,
      ],
    });
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      generatorWith(canonical, fetchImpl).generate(request({ references: expected })),
    ).rejects.toThrow('GENERATIVE_REFERENCE_CANONICAL_AMBIGUITY');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses canonical metadata, not caller-supplied descriptive text, in the provider policy prompt', async () => {
    const expected = [reference(1), reference(2), reference(3)];
    const canonical = canonicalRegistry(expected);
    const tamperedMetadata = expected.map((item) => ({
      ...item,
      registry: {
        ...item.registry,
        referenceClass: 'INVENTED_ARCHITECTURE_CLASS',
        purpose: 'INVENT_A_NEW_DECK',
        protectedElements: ['FAKE_TOWER'],
      },
    }));
    const output = Uint8Array.from([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        input: readonly { role: string; content: readonly Record<string, unknown>[] }[];
      };
      const policyText = String(body.input[0]?.content[0]?.text ?? '');
      expect(policyText).toContain('SUN-GEN-1:DECK:DECK|RAILING|HORIZONTE');
      expect(policyText).not.toContain('INVENTED_ARCHITECTURE_CLASS');
      expect(policyText).not.toContain('FAKE_TOWER');
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

    await expect(
      generatorWith(canonical, fetchImpl).generate(request({ references: tamperedMetadata })),
    ).resolves.toMatchObject({
      exceptionId: approval.exceptionId,
      approvalRef: approval.approvalRef,
      readyForFinalComposition: false,
    });
  });

  it('sends exact canonical references through the current Responses image-tool contract', async () => {
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
      expect(body.model).toBe('gpt-5.6');
      expect(body.input[0]?.role).toBe('developer');
      const policyText = String(body.input[0]?.content[0]?.text ?? '');
      expect(policyText).toContain('TOCA_CREATIVE_TRUTH_POLICY_V1');
      expect(policyText).toContain(`approvalRef=${approval.approvalRef}`);
      expect(policyText).toContain('only source of venue spatial and architectural truth');
      expect(policyText).toContain('Do not generate, redraw, repair, imitate or approximate');
      expect(policyText).toContain('NOT approved final creative');
      expect(policyText).toContain(sourceSha256(references[0]!));

      expect(body.input[1]?.role).toBe('user');
      const images = body.input[1]?.content.filter((item) => item.type === 'input_image') ?? [];
      expect(images).toHaveLength(3);
      expect(images.every((item) => item.detail === 'high')).toBe(true);
      expect(String(images[0]?.image_url)).toMatch(/^data:image\/jpeg;base64,/);

      expect(body.tools).toEqual([
        expect.objectContaining({
          type: 'image_generation',
          action: 'generate',
          quality: 'high',
          size: '1024x1536',
          output_format: 'jpeg',
          output_compression: 100,
        }),
      ]);
      expect(body.tools[0]).not.toHaveProperty('model');
      expect(body.tools[0]).not.toHaveProperty('input_fidelity');
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

    const result = await generatorWith(canonical, fetchImpl).generate(request({ references }));

    expect(canonical.assertCanonicalPolicy).toHaveBeenCalledOnce();
    expect(canonical.getApprovedGenerativeException).toHaveBeenCalledWith('CONTENT-GEN-1');
    expect(canonical.getReferenceSet).toHaveBeenCalledOnce();
    expect(canonical.getVenueAssetBySourceAssetId).toHaveBeenCalledTimes(3);
    expect(result.outputBytes).toEqual(output);
    expect(result.outputContentType).toBe('image/jpeg');
    expect(result.candidateSha256).toBe(createHash('sha256').update(output).digest('hex'));
    expect(result.referenceAssetIds).toEqual(['SUN-GEN-1', 'SUN-GEN-2', 'SUN-GEN-3']);
    expect(result.referenceSha256s).toEqual(references.map(sourceSha256));
    expect(result.policyId).toBe('TOCA_CREATIVE_TRUTH_POLICY_V1');
    expect(result.referenceSetId).toBe('TOCA_VENUE_REFERENCE_SET_V1');
    expect(result.exceptionId).toBe(approval.exceptionId);
    expect(result.approvalRef).toBe(approval.approvalRef);
    expect(result.creativeMode).toBe('GENERATIVE_EXCEPTION');
    expect(result.generationMode).toBe('FULL_STATIC_IMAGE_WITH_VERIFIED_REFERENCES');
    expect(result.requiresPostGenerationHumanReview).toBe(true);
    expect(result.requiresVenueFidelityGate).toBe(true);
    expect(result.readyForFinalComposition).toBe(false);
    expect(result.responseModel).toBe('gpt-5.6');
    expect(result.imageToolModelSelection).toBe('RESPONSES_TOOL_MANAGED');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('rejects missing or non-JPEG generated output instead of treating it as reviewable', async () => {
    const references = [reference(1), reference(2), reference(3)];
    const missingGenerator = generatorWith(canonicalRegistry(references), () =>
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
