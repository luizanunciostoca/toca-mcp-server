import { createHash } from 'node:crypto';
import { referenceSetOperation } from '../contracts/creative-truth-generative-reference-sets.js';
import {
  operationScopedGenerativeCandidateManifestSchema,
  type OperationScopedGenerativeCandidateManifest,
} from '../contracts/operation-scoped-generative-candidate.js';
import type {
  BrandAsset,
  CreativeStandard,
  FidelityEvidence,
  VenueReference,
} from '../contracts/creative-truth.js';
import { resolveCanonicalGenerativeBrandInputs } from './canonical-generative-brand-binding.js';
import { ExecutionError } from '../core/errors.js';
import type { OperationScopedGenerativeRegistry } from '../providers/google-sheets/creative-truth-operation-scoped-generative-registry.js';
import {
  LocalOperationScopedGenerativeComposer,
  type LocalOperationScopedGenerativeComposeResult,
} from '../providers/local/local-operation-scoped-generative-composer.js';
import type {
  CreativeCanvas,
  OfficialBrandAssetInput,
  ThePartyEnvironment,
} from '../providers/local/local-creative-composer.js';

const THE_PARTY_VISUAL_STANDARDS = new Set([
  'THE_PARTY_HYBRID_NETWORKS_V1',
  'THE_PARTY_HYBRID_MINIMALIST_V1',
]);

export interface OperationScopedGenerativeFinalizationRegistry
  extends OperationScopedGenerativeRegistry {
  getBrandAsset(brand: string, variant: string): Promise<BrandAsset | undefined>;
  getCreativeStandard(standardId: string): Promise<CreativeStandard | undefined>;
}

export interface ControlledOperationScopedGenerativeFinalizationRequest {
  readonly candidateManifest: unknown;
  readonly candidateImageBytes: Uint8Array;
  readonly candidateContentType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly creativeId: string;
  /** Caller supplies only the requested identity; every field is replaced by canonical registry readback. */
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
  /** Bytes/observed locator are input evidence; registry metadata is replaced canonically before gates run. */
  readonly brandAssets: readonly OfficialBrandAssetInput[];
}

export interface ControlledOperationScopedGenerativeFinalizationDependencies {
  readonly registry: OperationScopedGenerativeFinalizationRegistry;
  readonly composer: Pick<LocalOperationScopedGenerativeComposer, 'compose'>;
  readonly now?: () => string;
}

export interface ControlledOperationScopedGenerativeFinalizationFactoryOptions {
  readonly now?: () => string;
}

/**
 * Production factory for the only operator-executable finalization boundary.
 * The raw ImageMagick composer is constructed here so no CLI/worker can import it directly.
 */
export function createControlledOperationScopedGenerativeFinalizationService(
  registry: OperationScopedGenerativeFinalizationRegistry,
  options: ControlledOperationScopedGenerativeFinalizationFactoryOptions = {},
): ControlledOperationScopedGenerativeFinalizationService {
  return new ControlledOperationScopedGenerativeFinalizationService({
    registry,
    composer: new LocalOperationScopedGenerativeComposer(),
    ...(options.now ? { now: options.now } : {}),
  });
}

/**
 * Canonical finalization boundary for full-static GENERATIVE_EXCEPTION outputs.
 *
 * The generated candidate manifest is immutable lineage evidence, never execution authority.
 * Immediately before deterministic composition this service re-hashes the candidate bytes,
 * re-resolves CONTENT_ITEMS.operation, the approved exception, operation-scoped reference set,
 * VENUE_VISUALS identity/source hashes, CREATIVE_STANDARDS and official BRAND_ASSETS metadata.
 * Approval expiry is evaluated against an injected trusted clock, never caller-provided time.
 */
export class ControlledOperationScopedGenerativeFinalizationService {
  private readonly now: () => string;

  constructor(
    private readonly dependencies: ControlledOperationScopedGenerativeFinalizationDependencies,
  ) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  async finalize(
    request: ControlledOperationScopedGenerativeFinalizationRequest,
  ): Promise<LocalOperationScopedGenerativeComposeResult> {
    const manifest = parseCandidateManifest(request.candidateManifest);
    assertCandidateBytes(manifest, request.candidateImageBytes, request.candidateContentType);
    const nowIso = trustedNowIso(this.now);

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
    if (!approval || approval.status !== 'APPROVED') {
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
    assertApprovalCurrent(approval.expiresAt, nowIso);

    const references = await this.resolveCanonicalGenerationReferences(
      approval.referenceSetId,
      approval.minReferenceCount,
    );
    await this.assertGenerationLineageStillCanonical(manifest, references, operation);

    const standards = await this.resolveCanonicalStandards(
      request.standard.standardId,
      request.visualStandard?.standardId,
      operation,
    );
    const canonicalBrandAssets = await resolveCanonicalGenerativeBrandInputs(
      this.dependencies.registry,
      {
        outputStandard: standards.outputStandard,
        ...(standards.visualStandard ? { visualStandard: standards.visualStandard } : {}),
        requiredBrands: request.requiredBrands,
        suppliedBrandAssets: request.brandAssets,
        ...(request.partyEnvironment ? { partyEnvironment: request.partyEnvironment } : {}),
      },
    );

    return this.dependencies.composer.compose({
      contentItemId: manifest.contentItemId,
      creativeId: request.creativeId,
      standard: standards.outputStandard,
      ...(standards.visualStandard ? { visualStandard: standards.visualStandard } : {}),
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
      brandAssets: canonicalBrandAssets,
      createdAt: nowIso,
    });
  }

  private async resolveCanonicalStandards(
    outputStandardId: string,
    visualStandardId: string | undefined,
    operation: 'SUNSET' | 'THE_PARTY',
  ): Promise<{ readonly outputStandard: CreativeStandard; readonly visualStandard?: CreativeStandard }> {
    const normalizedOutputId = outputStandardId.trim();
    if (!normalizedOutputId) denyStandard();
    const outputStandard = await this.dependencies.registry.getCreativeStandard(normalizedOutputId);
    if (
      !outputStandard ||
      outputStandard.status !== 'ACTIVE_CANONICAL' ||
      outputStandard.parentPolicyId !== 'TOCA_CREATIVE_TRUTH_POLICY_V1' ||
      (outputStandard.operation !== 'ALL' && outputStandard.operation !== operation)
    ) {
      denyStandard();
    }

    if (outputStandard.operation !== 'ALL') {
      if (operation === 'THE_PARTY' && !THE_PARTY_VISUAL_STANDARDS.has(outputStandard.standardId)) {
        denyStandard();
      }
      return { outputStandard };
    }

    const normalizedVisualId = visualStandardId?.trim();
    if (!normalizedVisualId) {
      throw new ExecutionError(
        'POLICY_DENIED',
        'GENERATIVE_OPERATION_SCOPED_VISUAL_STANDARD_REQUIRED',
        false,
      );
    }
    const visualStandard = await this.dependencies.registry.getCreativeStandard(normalizedVisualId);
    if (
      !visualStandard ||
      visualStandard.status !== 'ACTIVE_CANONICAL' ||
      visualStandard.parentPolicyId !== 'TOCA_CREATIVE_TRUTH_POLICY_V1' ||
      visualStandard.operation !== operation ||
      (operation === 'THE_PARTY' && !THE_PARTY_VISUAL_STANDARDS.has(visualStandard.standardId))
    ) {
      denyStandard();
    }
    return { outputStandard, visualStandard };
  }

  private async resolveCanonicalGenerationReferences(
    referenceSetId: OperationScopedGenerativeCandidateManifest['referenceSetId'],
    approvedMinimum: number,
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
    const uniqueReferenceIds = new Set(eligible.map((reference) => reference.referenceId));
    const uniqueAssetIds = new Set(eligible.map((reference) => reference.assetId));
    const minimum = Math.max(3, approvedMinimum);
    if (
      eligible.length < minimum ||
      uniqueReferenceIds.size !== eligible.length ||
      uniqueAssetIds.size !== eligible.length
    ) {
      throw new ExecutionError('POLICY_DENIED', 'FAILED_GENERATIVE_REFERENCE_MISSING', false);
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

function assertApprovalCurrent(expiresAt: string | undefined, nowIso: string): void {
  if (!expiresAt) return;
  const expiresTimestamp = Date.parse(expiresAt);
  const nowTimestamp = Date.parse(nowIso);
  if (!Number.isFinite(expiresTimestamp) || expiresTimestamp <= nowTimestamp) {
    throw new ExecutionError(
      'APPROVAL_REQUIRED',
      'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
      false,
    );
  }
}

function trustedNowIso(now: () => string): string {
  const value = now();
  if (!Number.isFinite(Date.parse(value))) {
    throw new ExecutionError('POLICY_DENIED', 'GENERATIVE_TRUSTED_CLOCK_INVALID', false);
  }
  return value;
}

function denyStandard(): never {
  throw new ExecutionError('POLICY_DENIED', 'FAILED_STANDARD_NOT_RESOLVED', false);
}

function sameOrderedValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
