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
  type OperationScopedGenerativeFinalizationRegistry,
  type OperationScopedGenerativeThePartyContextResolver,
} from '../src/creative/controlled-operation-scoped-generative-finalization.js';
import type { LocalOperationScopedGenerativeComposeInput } from '../src/providers/local/local-operation-scoped-generative-composer.js';

const candidateBytes = Uint8Array.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
const candidateSha256 = createHash('sha256').update(candidateBytes).digest('hex');
const partyLogoBytes = Uint8Array.from([10, 11, 12]);

const approval: OperationScopedGenerativeExceptionApproval = {
  exceptionId: 'GEN-TP-1',
  contentItemId: 'CONTENT-TP-1',
  requestedBy: 'LUIZ',
  approvedBy: 'LUIZ',
  approvalRef: 'approval:tp-1',
  reason: 'Explicit controlled The Party generation',
  referenceSetId: 'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1',
  operation: 'THE_PARTY',
  minReferenceCount: 3,
  allowArchitecturalInvention: false,
  allowEnvironmentDrift: false,
  allowAiLogoGeneration: false,
  status: 'APPROVED',
  createdAt: '2026-08-18T03:00:00Z',
  expiresAt: '2026-08-19T03:00:00Z',
};

const networksStandard: CreativeStandard = {
  standardId: 'THE_PARTY_HYBRID_NETWORKS_V1',
  version: '1.0',
  brandScope: 'TOCA_DO_MORCEGO',
  operation: 'THE_PARTY',
  channel: 'INSTAGRAM',
  format: 'SINGLE_IMAGE',
  parentPolicyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
  canonicalDriveId: 'drive-party-networks-standard',
  repoMirrorPath: 'control/creative-standards/the-party-hybrid-networks-standard.v1.json',
  status: 'ACTIVE_CANONICAL',
  realAssetRequired: true,
  deterministicBrandInsertion: true,
  venueFidelityGateRequired: true,
};

const partyLogo: BrandAsset = {
  brandAssetId: 'BRAND-THE-PARTY-WHITE-V1',
  brand: 'THE_PARTY',
  variant: 'WHITE',
  driveFileId: 'drive-party-logo',
  fileName: 'THE_PARTY_WHITE.png',
  contentType: 'image/png',
  integrityMode: 'SHA256_PINNED',
  sha256: createHash('sha256').update(partyLogoBytes).digest('hex'),
  status: 'ACTIVE_APPROVED',
  aiReconstructionAllowed: false,
};

function reference(index: number): VenueReference {
  return {
    referenceSetId: 'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1',
    referenceId: `REF-TP-${index}`,
    assetId: `TP-${index}`,
    driveFileId: `drive-tp-${index}`,
    referenceClass: 'VENUE_REFERENCE',
    purpose: 'GENERATIVE_VENUE_TRUTH',
    requiredForGenerativeException: true,
    venueVerified: true,
    protectedElements: ['DECK', 'PISTA'],
    status: 'ACTIVE',
  };
}

function venue(index: number): VenueAsset {
  return {
    venueAssetId: `VENUE-TP-${index}`,
    sourceAssetId: `TP-${index}`,
    sourceDriveFileId: `drive-tp-${index}`,
    sourceSha256: String(index).repeat(64),
    operation: 'THE_PARTY',
    locationSignature: 'ambiente_toca',
    dominantSubject: 'nightlife_reference',
    venueVerified: true,
    marketingReady: false,
    generativeReferenceAllowed: true,
    protectedElements: ['DECK', 'PISTA'],
    status: 'VENUE_VERIFIED_SOURCE',
  };
}

const references = [reference(1), reference(2), reference(3)];

function registry(): OperationScopedGenerativeFinalizationRegistry {
  return {
    assertCanonicalPolicy: vi.fn(async () => undefined),
    getContentItemOperation: vi.fn(async () => 'THE_PARTY'),
    getContentItemCreativeStandardId: vi.fn(async () => networksStandard.standardId),
    getApprovedGenerativeException: vi.fn(async () => approval),
    getReferenceSet: vi.fn(async () => references),
    getVenueAssetBySourceAssetId: vi.fn(async (assetId) => {
      const index = Number.parseInt(assetId.replace('TP-', ''), 10);
      return Number.isFinite(index) ? venue(index) : undefined;
    }),
    getBrandAsset: vi.fn(async (brand, variant) =>
      brand === 'THE_PARTY' && variant === 'WHITE' ? partyLogo : undefined,
    ),
    getCreativeStandard: vi.fn(async (standardId) =>
      standardId === networksStandard.standardId ? networksStandard : undefined,
    ),
  };
}

function contextResolver(
  context: Awaited<ReturnType<OperationScopedGenerativeThePartyContextResolver['get']>>,
): OperationScopedGenerativeThePartyContextResolver {
  return { get: vi.fn(async () => context) };
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
    referenceSetId: 'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1',
    referenceAssetIds: ['TP-1', 'TP-2', 'TP-3'],
    reviewRef: 'review:content-tp-1:candidate',
    notes: [],
  };
}

function request() {
  return {
    candidateManifest: {
      status: 'GENERATED_REVIEW_REQUIRED' as const,
      contentItemId: 'CONTENT-TP-1',
      creativeMode: 'GENERATIVE_EXCEPTION' as const,
      policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1' as const,
      operation: 'THE_PARTY' as const,
      referenceSetId: 'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1' as const,
      exceptionId: approval.exceptionId,
      approvalRef: approval.approvalRef,
      candidateSha256,
      referenceAssetIds: ['TP-1', 'TP-2', 'TP-3'],
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
    },
    candidateImageBytes: candidateBytes,
    candidateContentType: 'image/jpeg' as const,
    creativeId: 'CREATIVE-TP-FINAL-1',
    standard: networksStandard,
    fidelityEvidence: fidelityEvidence(),
    canvas: '1080x1350' as const,
    requiredBrands: ['THE_PARTY'],
    brandAssets: [
      {
        registry: partyLogo,
        bytes: partyLogoBytes,
        contentType: 'image/png' as const,
        driveFileId: partyLogo.driveFileId,
      },
    ],
  };
}

function composer() {
  return {
    compose: vi.fn(async (input: LocalOperationScopedGenerativeComposeInput) => ({
      outputBytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
      outputContentType: 'image/jpeg' as const,
      outputSha256: 'f'.repeat(64),
      dimensions: input.canvas,
      manifest: {
        contentItemId: input.contentItemId,
        creativeId: input.creativeId,
        policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1' as const,
        standardId: input.standard.standardId,
        creativeMode: 'GENERATIVE_EXCEPTION' as const,
        sourceAssetIds: input.references.map((reference) => reference.assetId),
        masterAssetIds: [],
        brandAssetIds: input.brandAssets.map((brand) => brand.registry.brandAssetId),
        outputSha256: 'f'.repeat(64),
        outputDimensions: input.canvas,
        exactAssetBinding: true as const,
        gates: [
          {
            gate: 'BRAND_INTEGRITY' as const,
            status: 'PASSED' as const,
            failureCodes: [],
            evidence: {},
          },
          {
            gate: 'VENUE_FIDELITY' as const,
            status: 'PASSED' as const,
            failureCodes: [],
            evidence: {},
          },
          {
            gate: 'QUALITY' as const,
            status: 'PASSED' as const,
            failureCodes: [],
            evidence: {},
          },
        ],
        createdAt: input.createdAt ?? '2026-08-18T04:00:00Z',
      },
      provider: 'LOCAL_IMAGEMAGICK' as const,
      pipelineVersion: 'local-operation-scoped-generative-composer-v1' as const,
      readyForReview: true as const,
    })),
  };
}

describe('controlled The Party generative finalization context', () => {
  it('fails closed when no canonical The Party context resolver is available', async () => {
    const render = composer();
    const service = new ControlledOperationScopedGenerativeFinalizationService({
      registry: registry(),
      composer: render,
      now: () => '2026-08-18T04:00:00Z',
    });

    await expect(service.finalize(request())).rejects.toThrow(
      'GENERATIVE_FINALIZATION_THE_PARTY_CONTEXT_REQUIRED',
    );
    expect(render.compose).not.toHaveBeenCalled();
  });

  it('rejects a The Party context whose canonical standard disagrees with finalization', async () => {
    const render = composer();
    const service = new ControlledOperationScopedGenerativeFinalizationService({
      registry: registry(),
      composer: render,
      thePartyContextResolver: contextResolver({
        standardId: 'THE_PARTY_HYBRID_MINIMALIST_V1',
        visualStandardStatus: 'RESOLVED',
      }),
      now: () => '2026-08-18T04:00:00Z',
    });

    await expect(service.finalize(request())).rejects.toThrow(
      'GENERATIVE_FINALIZATION_THE_PARTY_STANDARD_CONTEXT_MISMATCH',
    );
    expect(render.compose).not.toHaveBeenCalled();
  });

  it('keeps Networks finalization blocked while the canonical environment is unresolved', async () => {
    const render = composer();
    const service = new ControlledOperationScopedGenerativeFinalizationService({
      registry: registry(),
      composer: render,
      thePartyContextResolver: contextResolver({
        standardId: 'THE_PARTY_HYBRID_NETWORKS_V1',
        visualStandardStatus: 'BLOCKED_NEEDS_ENVIRONMENT',
      }),
      now: () => '2026-08-18T04:00:00Z',
    });

    await expect(service.finalize(request())).rejects.toThrow('THE_PARTY_ENVIRONMENT_REQUIRED');
    expect(render.compose).not.toHaveBeenCalled();
  });

  it('passes only the canonical same-item Networks environment into deterministic composition', async () => {
    const render = composer();
    const resolver = contextResolver({
      standardId: 'THE_PARTY_HYBRID_NETWORKS_V1',
      visualStandardStatus: 'RESOLVED',
      environment: 'NATIONAL',
    });
    const service = new ControlledOperationScopedGenerativeFinalizationService({
      registry: registry(),
      composer: render,
      thePartyContextResolver: resolver,
      now: () => '2026-08-18T04:00:00Z',
    });

    await service.finalize(request());

    expect(resolver.get).toHaveBeenCalledWith('CONTENT-TP-1');
    expect(render.compose).toHaveBeenCalledOnce();
    expect(render.compose.mock.calls[0]![0].partyEnvironment).toBe('NATIONAL');
  });
});
