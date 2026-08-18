import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { OperationScopedGenerativeExceptionApproval } from '../src/contracts/creative-truth-generative-reference-sets.js';
import type {
  BrandAsset,
  CreativeStandard,
  FidelityEvidence,
  VenueAsset,
  VenueReference,
} from '../src/contracts/creative-truth.js';
import {
  ControlledOperationScopedGenerativeFinalizationService,
  type ControlledOperationScopedGenerativeFinalizationRequest,
  type OperationScopedGenerativeFinalizationRegistry,
} from '../src/creative/controlled-operation-scoped-generative-finalization.js';
import type {
  LocalOperationScopedGenerativeComposeInput,
  LocalOperationScopedGenerativeComposeResult,
} from '../src/providers/local/local-operation-scoped-generative-composer.js';

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
  createdAt: '2026-08-18T03:00:00Z',
  expiresAt: '2026-08-19T03:00:00Z',
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

function venue(index: number, overrides: Partial<VenueAsset> = {}): VenueAsset {
  return {
    venueAssetId: `VENUE-SUN-${index}`,
    sourceAssetId: `SUN-${index}`,
    sourceDriveFileId: `drive-${index}`,
    sourceSha256: String(index).repeat(64),
    operation: 'SUNSET',
    locationSignature: 'ambiente_toca',
    dominantSubject: 'venue_reference',
    venueVerified: true,
    marketingReady: false,
    generativeReferenceAllowed: true,
    protectedElements: ['DECK', 'HORIZONTE'],
    status: 'VENUE_VERIFIED_SOURCE',
    ...overrides,
  };
}

const references = [reference(3), reference(1), reference(2)];
const candidateBytes = Uint8Array.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
const candidateSha256 = createHash('sha256').update(candidateBytes).digest('hex');
const brandBytes = Uint8Array.from([1, 2, 3, 4]);
const canonicalTocaBrand: BrandAsset = {
  brandAssetId: 'BRAND-TOCA-WHITE-V1',
  brand: 'TOCA_DO_MORCEGO',
  variant: 'WHITE',
  driveFileId: 'drive-toca-white',
  fileName: 'TOCA_WHITE.png',
  contentType: 'image/png',
  integrityMode: 'SHA256_PINNED',
  sha256: createHash('sha256').update(brandBytes).digest('hex'),
  status: 'ACTIVE_APPROVED',
  aiReconstructionAllowed: false,
};

const canonicalStandard: CreativeStandard = {
  standardId: 'SUNSET_FEED_V1',
  version: '1.0',
  brandScope: 'TOCA_DO_MORCEGO',
  operation: 'SUNSET',
  channel: 'INSTAGRAM',
  format: 'SINGLE_IMAGE',
  parentPolicyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
  canonicalDriveId: 'canonical-drive-standard',
  repoMirrorPath: 'control/creative-standards/sunset-feed-standard.v1.json',
  status: 'ACTIVE_CANONICAL',
  realAssetRequired: true,
  deterministicBrandInsertion: true,
  venueFidelityGateRequired: true,
};

function candidateManifest() {
  return {
    status: 'GENERATED_REVIEW_REQUIRED' as const,
    contentItemId: 'CONTENT-SUN-1',
    creativeMode: 'GENERATIVE_EXCEPTION' as const,
    policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1' as const,
    operation: 'SUNSET' as const,
    referenceSetId: 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1' as const,
    exceptionId: approval.exceptionId,
    approvalRef: approval.approvalRef,
    candidateSha256,
    referenceAssetIds: ['SUN-1', 'SUN-2', 'SUN-3'],
    referenceSha256s: ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64)],
    provider: 'OPENAI_IMAGE_GENERATION' as const,
    generationMode: 'FULL_STATIC_IMAGE_WITH_OPERATION_SCOPED_VERIFIED_REFERENCES' as const,
    responseModel: 'gpt-5.6',
    imageToolModelSelection: 'RESPONSES_TOOL_MANAGED' as const,
    outputContentType: 'image/jpeg' as const,
    outputSizeBytes: candidateBytes.byteLength,
    requiresPostGenerationHumanReview: true as const,
    requiresVenueFidelityGate: true as const,
    readyForFinalComposition: false as const,
    publicationEligible: false as const,
  };
}

function fidelityEvidence(): FidelityEvidence {
  return {
    verifier: 'HUMAN_CREATIVE_TRUTH_REVIEWER',
    verificationMethod: 'MULTIMODAL_PLUS_HUMAN',
    candidateSha256,
    sourceIdentityPreserved: true,
    architectureDriftDetected: false,
    sceneInventionDetected: false,
    logoReconstructionDetected: false,
    referenceSetId: 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
    referenceAssetIds: ['SUN-1', 'SUN-2', 'SUN-3'],
    reviewRef: 'review:content-sun-1:candidate',
    notes: [],
  };
}

function brandInput(registry: BrandAsset = canonicalTocaBrand) {
  return {
    registry,
    bytes: brandBytes,
    contentType: 'image/png' as const,
    driveFileId: canonicalTocaBrand.driveFileId,
  };
}

function request(
  overrides: Partial<ControlledOperationScopedGenerativeFinalizationRequest> = {},
): ControlledOperationScopedGenerativeFinalizationRequest {
  return {
    candidateManifest: candidateManifest(),
    candidateImageBytes: candidateBytes,
    candidateContentType: 'image/jpeg',
    creativeId: 'CREATIVE-SUN-FINAL-1',
    standard: canonicalStandard,
    fidelityEvidence: fidelityEvidence(),
    canvas: '1080x1350',
    requiredBrands: ['TOCA_DO_MORCEGO'],
    brandAssets: [brandInput()],
    ...overrides,
  };
}

function registry(
  options: {
    readonly operation?: 'SUNSET' | 'THE_PARTY';
    readonly canonicalApproval?: OperationScopedGenerativeExceptionApproval | undefined;
    readonly canonicalReferences?: readonly VenueReference[];
    readonly venueOverride?: (assetId: string) => VenueAsset | undefined;
    readonly canonicalStandard?: CreativeStandard | undefined;
    readonly canonicalBrand?: BrandAsset | undefined;
  } = {},
): OperationScopedGenerativeFinalizationRegistry {
  const operation = options.operation ?? 'SUNSET';
  const canonicalApproval = Object.prototype.hasOwnProperty.call(options, 'canonicalApproval')
    ? options.canonicalApproval
    : approval;
  const resolvedStandard = Object.prototype.hasOwnProperty.call(options, 'canonicalStandard')
    ? options.canonicalStandard
    : canonicalStandard;
  const resolvedBrand = Object.prototype.hasOwnProperty.call(options, 'canonicalBrand')
    ? options.canonicalBrand
    : canonicalTocaBrand;
  return {
    assertCanonicalPolicy: vi.fn(async () => undefined),
    getContentItemOperation: vi.fn(async () => operation),
    getApprovedGenerativeException: vi.fn(async () => canonicalApproval),
    getReferenceSet: vi.fn(async () => options.canonicalReferences ?? references),
    getVenueAssetBySourceAssetId: vi.fn(async (assetId) => {
      if (options.venueOverride) return options.venueOverride(assetId);
      const index = Number.parseInt(assetId.replace('SUN-', ''), 10);
      return Number.isFinite(index) ? venue(index) : undefined;
    }),
    getCreativeStandard: vi.fn(async (standardId) =>
      resolvedStandard?.standardId === standardId ? resolvedStandard : undefined,
    ),
    getBrandAsset: vi.fn(async (brand, variant) =>
      resolvedBrand?.brand === brand && resolvedBrand.variant === variant
        ? resolvedBrand
        : undefined,
    ),
  };
}

function successfulResult(): LocalOperationScopedGenerativeComposeResult {
  return {
    outputBytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
    outputContentType: 'image/jpeg',
    outputSha256: 'c'.repeat(64),
    dimensions: '1080x1350',
    manifest: {
      contentItemId: 'CONTENT-SUN-1',
      creativeId: 'CREATIVE-SUN-FINAL-1',
      policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
      standardId: 'SUNSET_FEED_V1',
      creativeMode: 'GENERATIVE_EXCEPTION',
      sourceAssetIds: ['SUN-1', 'SUN-2', 'SUN-3'],
      masterAssetIds: [],
      brandAssetIds: ['BRAND-TOCA-WHITE-V1'],
      outputSha256: 'c'.repeat(64),
      outputDimensions: '1080x1350',
      exactAssetBinding: true,
      gates: [
        { gate: 'BRAND_INTEGRITY', status: 'PASSED', failureCodes: [], evidence: {} },
        { gate: 'VENUE_FIDELITY', status: 'PASSED', failureCodes: [], evidence: {} },
        { gate: 'QUALITY', status: 'PASSED', failureCodes: [], evidence: {} },
      ],
      createdAt: TRUSTED_NOW,
    },
    provider: 'LOCAL_IMAGEMAGICK',
    pipelineVersion: 'local-operation-scoped-generative-composer-v1',
    readyForReview: true,
  };
}

function serviceWith(
  canonicalRegistry: OperationScopedGenerativeFinalizationRegistry,
  nowIso = TRUSTED_NOW,
  compose = vi.fn(async (_input: LocalOperationScopedGenerativeComposeInput) => successfulResult()),
) {
  return {
    compose,
    service: new ControlledOperationScopedGenerativeFinalizationService({
      registry: canonicalRegistry,
      composer: { compose },
      now: () => nowIso,
    }),
  };
}

describe('ControlledOperationScopedGenerativeFinalizationService', () => {
  it('revalidates candidate, approval, reference identity, source hashes, standard and brands before final render', async () => {
    const { service, compose } = serviceWith(registry());
    await service.finalize(request());
    expect(compose).toHaveBeenCalledOnce();
    const canonicalInput = compose.mock.calls[0]![0];
    expect(canonicalInput.approval).toEqual(approval);
    expect(canonicalInput.references.map((item) => item.referenceId)).toEqual([
      'REF-SUN-1',
      'REF-SUN-2',
      'REF-SUN-3',
    ]);
    expect(canonicalInput.standard).toEqual(canonicalStandard);
    expect(canonicalInput.brandAssets[0]?.registry).toEqual(canonicalTocaBrand);
    expect(canonicalInput.createdAt).toBe(TRUSTED_NOW);
  });

  it('rejects candidate hash substitution before canonical state or composer access', async () => {
    const canonicalRegistry = registry();
    const { service, compose } = serviceWith(canonicalRegistry);
    await expect(
      service.finalize(
        request({
          candidateImageBytes: Uint8Array.from([0xff, 0xd8, 9, 9, 9, 0xff, 0xd9]),
        }),
      ),
    ).rejects.toThrow('GENERATIVE_FINALIZATION_CANDIDATE_HASH_MISMATCH');
    expect(canonicalRegistry.assertCanonicalPolicy).not.toHaveBeenCalled();
    expect(compose).not.toHaveBeenCalled();
  });

  it('fails closed when CONTENT_ITEMS operation changes after candidate generation', async () => {
    const { service, compose } = serviceWith(registry({ operation: 'THE_PARTY' }));
    await expect(service.finalize(request())).rejects.toThrow(
      'FAILED_GENERATIVE_CONTENT_OPERATION_MISMATCH',
    );
    expect(compose).not.toHaveBeenCalled();
  });

  it('fails closed when the canonical approval no longer matches the generated candidate manifest', async () => {
    const { service, compose } = serviceWith(
      registry({
        canonicalApproval: {
          ...approval,
          exceptionId: 'GEN-SUN-REVISED',
          approvalRef: 'approval:gen-sun-revised',
        },
      }),
    );
    await expect(service.finalize(request())).rejects.toThrow(
      'GENERATIVE_FINALIZATION_APPROVAL_BINDING_MISMATCH',
    );
    expect(compose).not.toHaveBeenCalled();
  });

  it('fails closed when the current canonical reference source hash differs from generation lineage', async () => {
    const { service, compose } = serviceWith(
      registry({
        venueOverride: (assetId) => {
          const index = Number.parseInt(assetId.replace('SUN-', ''), 10);
          if (!Number.isFinite(index)) return undefined;
          return venue(index, index === 2 ? { sourceSha256: 'f'.repeat(64) } : {});
        },
      }),
    );
    await expect(service.finalize(request())).rejects.toThrow(
      'GENERATIVE_FINALIZATION_REFERENCE_HASH_MISMATCH',
    );
    expect(compose).not.toHaveBeenCalled();
  });

  it('honors the approved minimum reference count immediately before finalization', async () => {
    const { service, compose } = serviceWith(
      registry({ canonicalApproval: { ...approval, minReferenceCount: 4 } }),
    );
    await expect(service.finalize(request())).rejects.toThrow(
      'FAILED_GENERATIVE_REFERENCE_MISSING',
    );
    expect(compose).not.toHaveBeenCalled();
  });

  it('fails closed on duplicate canonical reference identity', async () => {
    const duplicateReferenceId = reference(2, { referenceId: 'REF-SUN-1' });
    const { service, compose } = serviceWith(
      registry({ canonicalReferences: [reference(1), duplicateReferenceId, reference(3)] }),
    );
    await expect(service.finalize(request())).rejects.toThrow(
      'FAILED_GENERATIVE_REFERENCE_MISSING',
    );
    expect(compose).not.toHaveBeenCalled();
  });

  it('replaces caller-forged standard metadata with canonical CREATIVE_STANDARDS readback', async () => {
    const forgedStandard: CreativeStandard = {
      ...canonicalStandard,
      canonicalDriveId: 'forged-drive',
      deterministicBrandInsertion: false,
      venueFidelityGateRequired: false,
    };
    const { service, compose } = serviceWith(registry());
    await service.finalize(request({ standard: forgedStandard }));
    expect(compose.mock.calls[0]![0].standard).toEqual(canonicalStandard);
  });

  it('replaces caller-forged brand registry metadata with canonical BRAND_ASSETS readback', async () => {
    const forgedBrand: BrandAsset = {
      ...canonicalTocaBrand,
      brandAssetId: 'FORGED-TOCA',
      driveFileId: 'forged-drive',
      sha256: 'f'.repeat(64),
    };
    const { service, compose } = serviceWith(registry());
    await service.finalize(request({ brandAssets: [brandInput(forgedBrand)] }));
    expect(compose.mock.calls[0]![0].brandAssets[0]?.registry).toEqual(canonicalTocaBrand);
  });

  it('fails closed if the canonical standard does not exist', async () => {
    const { service, compose } = serviceWith(registry({ canonicalStandard: undefined }));
    await expect(service.finalize(request())).rejects.toThrow('FAILED_STANDARD_NOT_RESOLVED');
    expect(compose).not.toHaveBeenCalled();
  });

  it('rejects an expired approval against trusted service time with no caller backdating surface', async () => {
    const expired = { ...approval, expiresAt: '2026-08-18T03:59:59Z' };
    const { service, compose } = serviceWith(
      registry({ canonicalApproval: expired }),
      TRUSTED_NOW,
    );
    await expect(service.finalize(request())).rejects.toThrow(
      'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
    );
    expect(compose).not.toHaveBeenCalled();
  });

  it('fails closed if the trusted finalization clock is invalid', async () => {
    const canonicalRegistry = registry();
    const { service, compose } = serviceWith(canonicalRegistry, 'not-a-timestamp');
    await expect(service.finalize(request())).rejects.toThrow('GENERATIVE_TRUSTED_CLOCK_INVALID');
    expect(canonicalRegistry.assertCanonicalPolicy).not.toHaveBeenCalled();
    expect(compose).not.toHaveBeenCalled();
  });
});
