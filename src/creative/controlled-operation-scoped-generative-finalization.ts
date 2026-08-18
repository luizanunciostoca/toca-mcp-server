import { createHash } from 'node:crypto';
import { referenceSetOperation } from '../contracts/creative-truth-generative-reference-sets.js';
import {
  operationScopedGenerativeCandidateManifestSchema,
  type OperationScopedGenerativeCandidateManifest,
} from '../contracts/operation-scoped-generative-candidate.js';
import type {
  CreativeStandard,
  FidelityEvidence,
  VenueReference,
} from '../contracts/creative-truth.js';
import { ExecutionError } from '../core/errors.js';
import type { OperationScopedGenerativeRegistry } from '../providers/google-sheets/creative-truth-operation-scoped-generative-registry.js';
import type {
  LocalOperationScopedGenerativeComposeResult,
  LocalOperationScopedGenerativeComposer,
} from '../providers/local/local-operation-scoped-generative-composer.js';
import type {
  CreativeCanvas,
  OfficialBrandAssetInput,
  ThePartyEnvironment,
} from '../providers/local/local-creative-composer.js';

export interface ControlledOperationScopedGenerativeFinalizationRequest {
  readonly candidateManifest: unknown;
  readonly candidateImageBytes: Uint8Array;
  readonly candidateContentType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly creativeId: string;
  readonly standard: CreativeStandard;
  readonly visualStandard?: CreativeStandard;
  readonly fidelityEvidence: FidelityEvidence;
  readonly canvas: CreativeCanvas;
  readonly headline?: string;
  readonly supportCopy?: string;
  readonly cta?: string;
  readonly functionalInfo?: string;
  readonly partyEnvironment?: ThePartyEnvironment;
  readonly requiredBrands: readonly string[];
  readonly brandAssets: readonly OfficialBrandAssetInput[];
  readonly nowIso?: string;
}

export interface ControlledOperationScopedGenerativeFinalizationDependencies {
  readonly registry: OperationScopedGenerativeRegistry;
  readonly composer: Pick<LocalOperationScopedGenerativeComposer, 'compose'>;
}

export class ControlledOperationScopedGenerativeFinalizationService {
  constructor(
    private readonly dependencies: ControlledOperationScopedGenerativeFinalizationDependencies,
  ) {}

  async finalize(
    request: ControlledOperationScopedGenerativeFinalizationRequest,
  ): Promise<LocalOperationScopedGenerativeComposeResult> {
    const manifest = parseCandidateManifest(request.candidateManifest);
    assertCandidateBytes(manifest, request.candidateImageBytes, request.candidateContentType);

    await this.dependencies.registry.assertCanonicalPolicy();
    const operation = await this.dependencies.registry.getContentItemOperation(
      manifest.contentItemId,
    );
    if (!operation) {
      throw new ExecutionError(
        'POLICY_DENIED',
        'FAILED_GENERATIVE_CONTENT_OPERATION_MISSING',
        false,
      );
    }
    if (operation !== manifest.operation) {
      throw new ExecutionError(
        'POLICY_DENIED',
        'FAILED_GENERATIVE_CONTENT_OPERATION_MISMATCH',
        false,
      );
    }

    const approval = await this.dependencies.registry.getApprovedGenerativeException(
      manifest.contentItemId,
    );
    if (!approval) {
      throw new ExecutionError(
        'APPROVAL_REQUIRED',
        'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
        false,
      );
    }
    if (
      approval.exceptionId !== manifest.exceptionId ||
      approval.approvalRef !== manifest.approvalRef ||
      approval.contentItemId !== manifest.contentItemId ||
      approval.operation !== operation ||
      approval.referenceSetId !== manifest.referenceSetId ||
      referenceSetOperation(approval.referenceSetId) !== operation
    ) {
      throw new ExecutionError(
        'APPROVAL_REQUIRED',
        'GENERATIVE_FINALIZATION_APPROVAL_BINDING_MISMATCH',
        false,
      );
    }

    const references = await this.resolveCanonicalGenerationReferences(approval.referenceSetId);
    await this.assertGenerationLineageStillCanonical(manifest, references, operation);

    return this.dependencies.composer.compose({
      contentItemId: manifest.contentItemId,
      creativeId: request.creativeId,
      standard: request.standard,
      ...(request.visualStandard ? { visualStandard: request.visualStandard } : {}),
      approval,
      references,
      fidelityEvidence: request.fidelityEvidence,
      candidateImageBytes: request.candidateImageBytes,
      candidateContentType: request.candidateContentType,
      canvas: request.canvas,
      ...(request.headline ? { headline: request.headline } : {}),
      ...(request.supportCopy ? { supportCopy: request.supportCopy } : {}),
      ...(request.cta ? { cta: request.cta } : {}),
      ...(request.functionalInfo ? { functionalInfo: request.functionalInfo } : {}),
      ...(request.partyEnvironment ? { partyEnvironment: request.partyEnvironment } : {}),
      requiredBrands: request.requiredBrands,
      brandAssets: request.brandAssets,
      ...(request.nowIso ? { createdAt: request.nowIso } : {}),
    });
  }

  private async resolveCanonicalGenerationReferences(
    referenceSetId: OperationScopedGenerativeCandidateManifest['referenceSetId'],
  ): Promise<readonly VenueReference[]> {
    const references = await this.dependencies.registry.getReferenceSet(referenceSetId);
    const eligible = references
      .filter(
        (reference) =>
          reference.referenceSetId === referenceSetId &&
          reference.status === 'ACTIVE' &&
          reference.venueVerified &&
          reference.requiredForGenerativeException,
      )
      .sort((left, right) => left.referenceId.localeCompare(right.referenceId));
    if (eligible.length < 3 || new Set(eligible.map((entry) => entry.assetId)).size !== eligible.length) {
      throw new ExecutionError(
        'POLICY_DENIED',
        'FAILED_GENERATIVE_REFERENCE_MISSING',
        false,
      );
    }
    return eligible;
  }

  private async assertGenerationLineageStillCanonical(
    manifest: OperationScopedGenerativeCandidateManifest,
    references: readonly VenueReference[],
    operation: 'SUNSET' | 'THE_PARTY',
  ): Promise<void> {
    const expectedAssetIds = references.map((reference) => reference.assetId);
    if (!sameOrderedValues(manifest.referenceAssetIds, expectedAssetIds)) {
      throw new ExecutionError(
        'SOURCE_IMAGE_BINDING_FAILURE',
        'GENERATIVE_FINALIZATION_REFERENCE_IDENTITY_MISMATCH',
        false,
      );
    }

    const expectedSourceHashes: string[] = [];
    for (const reference of references) {
      const venue = await this.dependencies.registry.getVenueAssetBySourceAssetId(reference.assetId);
      if (
        !venue ||
        venue.sourceAssetId !== reference.assetId ||
        venue.sourceDriveFileId !== reference.driveFileId ||
        venue.operation !== operation ||
        !venue.venueVerified ||
        !venue.generativeReferenceAllowed ||
        venue.status === 'REVOKED' ||
        !venue.sourceSha256
      ) {
        throw new ExecutionError(
          'SOURCE_IMAGE_BINDING_FAILURE',
          'GENERATIVE_FINALIZATION_REFERENCE_CANONICALITY_FAILED',
          false,
        );
      }
      expectedSourceHashes.push(venue.sourceSha256.toLowerCase());
    }

    if (!sameOrderedValues(manifest.referenceSha256s, expectedSourceHashes)) {
      throw new ExecutionError(
        'SOURCE_IMAGE_BINDING_FAILURE',
        'GENERATIVE_FINALIZATION_REFERENCE_HASH_MISMATCH',
        false,
      );
    }
  }
}

function parseCandidateManifest(value: unknown): OperationScopedGenerativeCandidateManifest {
  const parsed = operationScopedGenerativeCandidateManifestSchema.safeParse(value);
  if (!parsed.success) {
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'GENERATIVE_FINALIZATION_CANDIDATE_MANIFEST_INVALID',
      false,
    );
  }
  return parsed.data;
}

function assertCandidateBytes(
  manifest: OperationScopedGenerativeCandidateManifest,
  bytes: Uint8Array,
  contentType: 'image/jpeg' | 'image/png' | 'image/webp',
): void {
  if (contentType !== manifest.outputContentType || bytes.byteLength === 0) {
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'GENERATIVE_FINALIZATION_CANDIDATE_MIME_MISMATCH',
      false,
    );
  }
  const observedSha256 = createHash('sha256').update(bytes).digest('hex');
  if (observedSha256 !== manifest.candidateSha256) {
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'GENERATIVE_FINALIZATION_CANDIDATE_HASH_MISMATCH',
      false,
    );
  }
  if (manifest.outputSizeBytes !== undefined && manifest.outputSizeBytes !== bytes.byteLength) {
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'GENERATIVE_FINALIZATION_CANDIDATE_SIZE_MISMATCH',
      false,
    );
  }
}

function sameOrderedValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
