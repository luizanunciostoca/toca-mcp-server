import { describe, expect, it, vi } from 'vitest';
import type { OperationScopedGenerativeExceptionApproval } from '../src/contracts/creative-truth-generative-reference-sets.js';
import type {
  BrandAsset,
  CreativeStandard,
  FidelityEvidence,
  VenueReference,
} from '../src/contracts/creative-truth.js';
import {
  ControlledOperationScopedGenerativeFinalizationService,
  type ControlledOperationScopedGenerativeFinalizationInput,
} from '../src/providers/local/controlled-operation-scoped-generative-finalization.js';
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

const references = [reference(3), reference(1), reference(2)];

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

const candidateBytes = Uint8Array.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
const evidence: FidelityEvidence = {
  verifier: 'HUMAN_CREATIVE_TRUTH_REVIEWER',
  verificationMethod: 'MULTIMODAL_PLUS_HUMAN',
  candidateSha256: 'a'.repeat(64),
  sourceIdentityPreserved: true,
  architectureDriftDetected: false,
  sceneInventionDetected: false,
  logoReconstructionDetected: false,
  referenceSetId: 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
  referenceAssetIds: ['SUN-1', 'SUN-2', 'SUN-3'],
  reviewRef: 'review:content-sun-1:candidate',
  notes: [],
};

const brand: BrandAsset = {
  brandAssetId: 'BRAND-TOCA-WHITE-V1',
  brand: 'TOCA_DO_MORCEGO',
  variant: 'WHITE',
  driveFileId: 'drive-toca',
  fileName: 'TOCA.png',
  contentType: 'image/png',
  integrityMode: 'SHA256_PINNED',
  sha256: 'b'.repeat(64),
  status: 'ACTIVE_APPROVED',
  aiReconstructionAllowed: false,
};

function request(): ControlledOperationScopedGenerativeFinalizationInput {
  return {
    contentItemId: 'CONTENT-SUN-1',
    creativeId: 'CREATIVE-SUN-FINAL-1',
    standard,
    fidelityEvidence: evidence,
    candidateImageBytes: candidateBytes,
    candidateContentType: 'image/jpeg',
    canvas: '1080x1350',
    requiredBrands: ['TOCA_DO_MORCEGO'],
    brandAssets: [
      {
        registry: brand,
        bytes: Uint8Array.from([1, 2, 3]),
        contentType: 'image/png',
        driveFileId: brand.driveFileId,
      },
    ],
    createdAt: '2026-08-18T04:00:00Z',
  };
}

function registry(options: {
  operation?: 'SUNSET' | 'THE_PARTY' | undefined;
  canonicalApproval?: OperationScopedGenerativeExceptionApproval | undefined;
  canonicalReferences?: readonly VenueReference[];
} = {}): OperationScopedGenerativeRegistry {
  const operation = Object.prototype.hasOwnProperty.call(options, 'operation')
    ? options.operation
    : 'SUNSET';
  const canonicalApproval = Object.prototype.hasOwnProperty.call(options, 'canonicalApproval')
    ? options.canonicalApproval
    : approval;
  return {
    assertCanonicalPolicy: vi.fn(async () => undefined),
    getContentItemOperation: vi.fn(async () => operation),
    getApprovedGenerativeException: vi.fn(async () => canonicalApproval),
    getReferenceSet: vi.fn(async () => options.canonicalReferences ?? references),
    getVenueAssetBySourceAssetId: vi.fn(async () => undefined),
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
      createdAt: '2026-08-18T04:00:00Z',
    },
    provider: 'LOCAL_IMAGEMAGICK',
    pipelineVersion: 'local-operation-scoped-generative-composer-v1',
    readyForReview: true,
  };
}

describe('ControlledOperationScopedGenerativeFinalizationService', () => {
  it('resolves approval and references canonically and overwrites caller-forged context', async () => {
    const compose = vi.fn(
      async (_input: LocalOperationScopedGenerativeComposeInput) => successfulResult(),
    );
    const service = new ControlledOperationScopedGenerativeFinalizationService({
      registry: registry(),
      composer: { compose },
    });
    const forged = {
      ...request(),
      approval: { ...approval, operation: 'THE_PARTY' },
      references: [
        reference(99, {
          referenceSetId: 'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1',
          assetId: 'TP-FAKE',
        }),
      ],
    } as unknown as ControlledOperationScopedGenerativeFinalizationInput;

    await service.finalize(forged);

    expect(compose).toHaveBeenCalledOnce();
    const canonicalInput = compose.mock.calls[0]![0];
    expect(canonicalInput.approval).toEqual(approval);
    expect(canonicalInput.references.map((item) => item.referenceId)).toEqual([
      'REF-SUN-1',
      'REF-SUN-2',
      'REF-SUN-3',
    ]);
  });

  it('fails closed when canonical content operation is unavailable', async () => {
    const compose = vi.fn();
    const service = new ControlledOperationScopedGenerativeFinalizationService({
      registry: registry({ operation: undefined }),
      composer: { compose },
    });

    await expect(service.finalize(request())).rejects.toThrow(
      'FAILED_GENERATIVE_CONTENT_OPERATION_MISSING',
    );
    expect(compose).not.toHaveBeenCalled();
  });

  it('fails closed when canonical approval operation conflicts with CONTENT_ITEMS', async () => {
    const compose = vi.fn();
    const service = new ControlledOperationScopedGenerativeFinalizationService({
      registry: registry({
        canonicalApproval: {
          ...approval,
          operation: 'THE_PARTY',
          referenceSetId: 'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1',
        },
      }),
      composer: { compose },
    });

    await expect(service.finalize(request())).rejects.toThrow(
      'FAILED_GENERATIVE_REFERENCE_SET_OPERATION_MISMATCH',
    );
    expect(compose).not.toHaveBeenCalled();
  });

  it('fails closed when canonical required references are insufficient', async () => {
    const compose = vi.fn();
    const service = new ControlledOperationScopedGenerativeFinalizationService({
      registry: registry({ canonicalReferences: [reference(1), reference(2)] }),
      composer: { compose },
    });

    await expect(service.finalize(request())).rejects.toThrow(
      'FAILED_GENERATIVE_REFERENCE_MISSING',
    );
    expect(compose).not.toHaveBeenCalled();
  });

  it('fails closed on duplicate canonical reference identity', async () => {
    const compose = vi.fn();
    const duplicate = reference(2, { referenceId: 'REF-SUN-1', assetId: 'SUN-1' });
    const service = new ControlledOperationScopedGenerativeFinalizationService({
      registry: registry({ canonicalReferences: [reference(1), duplicate, reference(3)] }),
      composer: { compose },
    });

    await expect(service.finalize(request())).rejects.toThrow(
      'FAILED_GENERATIVE_REFERENCE_MISSING',
    );
    expect(compose).not.toHaveBeenCalled();
  });
});
