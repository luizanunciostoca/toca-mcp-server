import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { OperationScopedGenerativeExceptionApproval } from '../src/contracts/creative-truth-generative-reference-sets.js';
import type {
  BrandAsset,
  CreativeStandard,
  FidelityEvidence,
  GenerativeExceptionApproval,
  VenueReference,
} from '../src/contracts/creative-truth.js';
import { LocalCreativeComposer } from '../src/providers/local/local-creative-composer.js';
import { LocalOperationScopedGenerativeComposer } from '../src/providers/local/local-operation-scoped-generative-composer.js';

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

const approval: OperationScopedGenerativeExceptionApproval = {
  exceptionId: 'GEN-SUN-1',
  contentItemId: 'CONTENT-SUN-1',
  requestedBy: 'LUIZ',
  approvedBy: 'LUIZ',
  approvalRef: 'approval:gen-sun-1',
  reason: 'Explicit controlled Sunset generation',
  referenceSetId: 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
  minReferenceCount: 3,
  allowArchitecturalInvention: false,
  allowEnvironmentDrift: false,
  allowAiLogoGeneration: false,
  status: 'APPROVED',
  createdAt: '2026-08-18T03:00:00Z',
  expiresAt: '2026-08-19T03:00:00Z',
  operation: 'SUNSET',
};

const candidateBytes = Uint8Array.from([0xff, 0xd8, 4, 5, 6, 0xff, 0xd9]);
const candidateSha256 = createHash('sha256').update(candidateBytes).digest('hex');

function reference(index: number): VenueReference {
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
  };
}
const references = [reference(1), reference(2), reference(3)];

const fidelityEvidence: FidelityEvidence = {
  verifier: 'HUMAN_CREATIVE_TRUTH_REVIEWER',
  verificationMethod: 'MULTIMODAL_PLUS_HUMAN',
  candidateSha256,
  sourceIdentityPreserved: true,
  architectureDriftDetected: false,
  sceneInventionDetected: false,
  logoReconstructionDetected: false,
  referenceSetId: 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
  referenceAssetIds: references.map((item) => item.assetId),
  reviewRef: 'review:content-sun-1:candidate',
  notes: [],
};

const tocaBytes = Uint8Array.from([10, 11, 12]);
const tocaLogo: BrandAsset = {
  brandAssetId: 'BRAND-TOCA-WHITE-V1',
  brand: 'TOCA_DO_MORCEGO',
  variant: 'WHITE',
  driveFileId: 'drive-toca',
  fileName: 'TOCA_LOGO_WHITE.png',
  contentType: 'image/png',
  integrityMode: 'SHA256_PINNED',
  sha256: createHash('sha256').update(tocaBytes).digest('hex'),
  status: 'ACTIVE_APPROVED',
  aiReconstructionAllowed: false,
};

function runner() {
  return vi.fn(async (_command: string, args: readonly string[]) => {
    const outputPath = args.at(-1);
    if (!outputPath) throw new Error('output path missing');
    await writeFile(outputPath, Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
  });
}

function brandInput() {
  return {
    registry: tocaLogo,
    bytes: tocaBytes,
    contentType: 'image/png' as const,
    driveFileId: tocaLogo.driveFileId,
  };
}

describe('LocalOperationScopedGenerativeComposer', () => {
  it('renders only after exact scoped human-reviewed candidate evidence passes', async () => {
    const commandRunner = runner();
    const composer = new LocalOperationScopedGenerativeComposer(commandRunner);

    const result = await composer.compose({
      contentItemId: 'CONTENT-SUN-1',
      creativeId: 'CREATIVE-SUN-GENERATED-1',
      standard,
      approval,
      references,
      fidelityEvidence,
      candidateImageBytes: candidateBytes,
      candidateContentType: 'image/jpeg',
      canvas: '1080x1350',
      headline: 'Pôr do sol na Toca',
      cta: 'Garanta seu ingresso',
      requiredBrands: ['TOCA_DO_MORCEGO'],
      brandAssets: [brandInput()],
      createdAt: '2026-08-18T04:00:00Z',
    });

    expect(commandRunner).toHaveBeenCalledOnce();
    expect(result.manifest.creativeMode).toBe('GENERATIVE_EXCEPTION');
    expect(result.manifest.standardId).toBe('SUNSET_FEED_V1');
    expect(result.manifest.sourceAssetIds).toEqual(['SUN-1', 'SUN-2', 'SUN-3']);
    expect(result.manifest.masterAssetIds).toEqual([]);
    expect(result.manifest.gates.map((gate) => gate.status)).toEqual([
      'PASSED',
      'PASSED',
      'PASSED',
    ]);
    expect(result.manifest.exactAssetBinding).toBe(true);
  });

  it('rejects a reviewed candidate when final visual standard belongs to another operation', async () => {
    const commandRunner = vi.fn();
    const composer = new LocalOperationScopedGenerativeComposer(commandRunner);

    await expect(
      composer.compose({
        contentItemId: 'CONTENT-SUN-1',
        creativeId: 'CREATIVE-WRONG-STANDARD',
        standard: { ...standard, operation: 'THE_PARTY', standardId: 'THE_PARTY_HYBRID_MINIMALIST_V1' },
        approval,
        references,
        fidelityEvidence,
        candidateImageBytes: candidateBytes,
        candidateContentType: 'image/jpeg',
        canvas: '1080x1350',
        requiredBrands: ['TOCA_DO_MORCEGO'],
        brandAssets: [brandInput()],
      }),
    ).rejects.toThrow('FAILED_STANDARD_NOT_RESOLVED');
    expect(commandRunner).not.toHaveBeenCalled();
  });

  it('rejects candidate hash substitution before ImageMagick is allowed to run', async () => {
    const commandRunner = vi.fn();
    const composer = new LocalOperationScopedGenerativeComposer(commandRunner);

    await expect(
      composer.compose({
        contentItemId: 'CONTENT-SUN-1',
        creativeId: 'CREATIVE-SUBSTITUTED',
        standard,
        approval,
        references,
        fidelityEvidence,
        candidateImageBytes: Uint8Array.from([0xff, 0xd8, 99, 0xff, 0xd9]),
        candidateContentType: 'image/jpeg',
        canvas: '1080x1350',
        requiredBrands: ['TOCA_DO_MORCEGO'],
        brandAssets: [brandInput()],
      }),
    ).rejects.toThrow('FAILED_FIDELITY_EVIDENCE_BINDING');
    expect(commandRunner).not.toHaveBeenCalled();
  });
});

describe('legacy generative finalization denial', () => {
  it('blocks the old global reference-set path before deterministic rendering', async () => {
    const commandRunner = vi.fn();
    const composer = new LocalCreativeComposer(commandRunner);
    const legacyApproval: GenerativeExceptionApproval = {
      exceptionId: 'LEGACY-1',
      contentItemId: 'CONTENT-LEGACY',
      requestedBy: 'LUIZ',
      approvedBy: 'LUIZ',
      approvalRef: 'legacy-approval',
      reason: 'legacy fixture',
      referenceSetId: 'TOCA_VENUE_REFERENCE_SET_V1',
      minReferenceCount: 3,
      allowArchitecturalInvention: false,
      allowEnvironmentDrift: false,
      allowAiLogoGeneration: false,
      status: 'APPROVED',
      createdAt: '2026-08-18T03:00:00Z',
    };
    const legacyReferences = references.map((entry) => ({
      ...entry,
      referenceSetId: 'TOCA_VENUE_REFERENCE_SET_V1',
    }));
    const legacyEvidence: FidelityEvidence = {
      ...fidelityEvidence,
      referenceSetId: 'TOCA_VENUE_REFERENCE_SET_V1',
      referenceAssetIds: legacyReferences.map((entry) => entry.assetId),
    };

    await expect(
      composer.compose({
        contentItemId: 'CONTENT-LEGACY',
        creativeId: 'CREATIVE-LEGACY',
        standard,
        creativeMode: 'GENERATIVE_EXCEPTION',
        sourceImageBytes: candidateBytes,
        sourceContentType: 'image/jpeg',
        canvas: '1080x1350',
        requiredBrands: ['TOCA_DO_MORCEGO'],
        brandAssets: [brandInput()],
        generativeException: legacyApproval,
        references: legacyReferences,
        fidelityEvidence: legacyEvidence,
        createdAt: '2026-08-18T04:00:00Z',
      }),
    ).rejects.toThrow('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION');
    expect(commandRunner).not.toHaveBeenCalled();
  });
});
