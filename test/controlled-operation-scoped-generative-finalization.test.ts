import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { OperationScopedGenerativeExceptionApproval } from '../src/contracts/creative-truth-generative-reference-sets.js';
import type {
  CreativeStandard,
  FidelityEvidence,
  VenueAsset,
  VenueReference,
} from '../src/contracts/creative-truth.js';
import {
  ControlledOperationScopedGenerativeFinalizationService,
  type ControlledOperationScopedGenerativeFinalizationRequest,
} from '../src/creative/controlled-operation-scoped-generative-finalization.js';
import type { OperationScopedGenerativeRegistry } from '../src/providers/google-sheets/creative-truth-operation-scoped-generative-registry.js';
import type {
  LocalOperationScopedGenerativeComposeInput,
  LocalOperationScopedGenerativeComposeResult,
} from '../src/providers/local/local-operation-scoped-generative-composer.js';

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

const standard: CreativeStandard = {
  standardId: 'SUNSET_FEED_V1',
  version: '1.0',
  brandScope: 'TOCA_DO_MORCEGO',
  operation: 'SUNSET',
  channel: 'INSTAGRAM',
  format: 'SINGLE_IMAGE',
  parentPolicyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
  canonicalDriveId: 'drive-standard',
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

function request(
  overrides: Partial<ControlledOperationScopedGenerativeFinalizationRequest> = {},
): ControlledOperationScopedGenerativeFinalizationRequest {
  return {
    candidateManifest: candidateManifest(),
    candidateImageBytes: candidateBytes,
    candidateContentType: 'image/jpeg',
    creativeId: 'CREATIVE-SUN-FINAL-1',
    standard,
    fidelityEvidence: fidelityEvidence(),
    canvas: '1080x1350',
    requiredBrands: ['TOCA_DO_MORCEGO'],
    brandAssets: [],
    nowIso: '2026-08-18T04:00:00Z',
    ...overrides,
  };
}

function registry(
  options: {
    readonly operation?: 'SUNSET' | 'THE_PARTY';
    readonly canonicalApproval?: OperationScopedGenerativeExceptionApproval | undefined;
    readonly canonicalReferences?: readonly VenueReference[];
    readonly venueOverride?: (assetId: string) => VenueAsset | undefined;
  } = {},
): OperationScopedGenerativeRegistry {
  const operation = options.operation ?? 'SUNSET';
  const canonicalApproval = Object.prototype.hasOwnProperty.call(options, 'canonicalApproval')
    ? options.canonicalApproval
    : approval;
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
      brandAssetIds: [],
      outputSha256: 'c'.repeat(64),
      outputDimensions: '1080x1350',
      exactAssetBinding: true,
      gates: [
        { gate: 'BRAND_INTEGRITY', status: 'PASSED', failureCodes: [], evidence: {} },
        { gate: 'VENUE_FIDELITY', status: 'PASSED', failureCodes: [], evidence: {} },
        { gate: 'QUALITY', status: 'PASSED', failureCodes: [], evidence: {} },
      ],
      createdAt: '2026-08-18T04:00:00Z',
    },
    provider: 'LOCAL_IMAGEMAGICK',
    pipelineVersion: 'local-operation-scoped-generative-composer-v1',
    readyForReview: true,
  };
}

function serviceWith(
  canonicalRegistry: OperationScopedGenerativeRegistry,
  compose = vi.fn(async (_input: LocalOperationScopedGenerativeComposeInput) => successfulResult()),
) {
  return {
    compose,
    service: new ControlledOperationScopedGenerativeFinalizationService({
      registry: canonicalRegistry,
      composer: { compose },
    }),
  };
}

describe('ControlledOperationScopedGenerativeFinalizationService', () => {
  it('revalidates candidate, approval, reference identity and source hashes before final render', async () => {
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
    expect(canonicalInput.createdAt).toBe('2026-08-18T04:00:00Z');
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
});
