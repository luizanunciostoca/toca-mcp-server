import {
  TOCA_VENUE_REFERENCE_SET_ID,
  type GenerativeExceptionApproval,
  type VenueReference,
} from '../contracts/creative-truth.js';
import { ExecutionError } from '../core/errors.js';
import type { GoogleSheetsCreativeTruthRegistry } from '../providers/google-sheets/creative-truth-registry.js';
import type {
  CreativeTruthVenueReferenceLoader,
  LoadedCreativeTruthVenueReference,
} from '../providers/google-drive/creative-truth-reference-loader.js';
import type {
  CreativeTruthGenerativeImageResult,
  CreativeTruthOpenAiImageGenerator,
} from '../providers/openai/creative-truth-openai-image-generator.js';

export interface ControlledStaticImageGenerationRequest {
  readonly contentItemId: string;
  readonly prompt: string;
  readonly nowIso?: string;
}

export interface ControlledStaticImageGenerationDependencies {
  readonly registry: Pick<
    GoogleSheetsCreativeTruthRegistry,
    'getApprovedGenerativeException' | 'getReferenceSet'
  >;
  readonly referenceLoader: CreativeTruthVenueReferenceLoader;
  readonly generator: Pick<CreativeTruthOpenAiImageGenerator, 'generate'>;
}

export class ControlledStaticImageGenerationService {
  constructor(private readonly dependencies: ControlledStaticImageGenerationDependencies) {}

  async generate(
    request: ControlledStaticImageGenerationRequest,
  ): Promise<CreativeTruthGenerativeImageResult> {
    validateRequest(request);
    const approval = await this.resolveApproval(request.contentItemId, request.nowIso);
    const references = await this.resolveRequiredReferences(approval);
    const loaded = await this.loadReferences(references);

    return this.dependencies.generator.generate({
      contentItemId: request.contentItemId,
      prompt: request.prompt.trim(),
      approval,
      references: loaded,
      ...(request.nowIso ? { nowIso: request.nowIso } : {}),
    });
  }

  private async resolveApproval(
    contentItemId: string,
    nowIso?: string,
  ): Promise<GenerativeExceptionApproval> {
    const approval = await this.dependencies.registry.getApprovedGenerativeException(contentItemId);
    if (
      !approval ||
      approval.status !== 'APPROVED' ||
      approval.referenceSetId !== TOCA_VENUE_REFERENCE_SET_ID ||
      approval.minReferenceCount < 3 ||
      approval.allowArchitecturalInvention ||
      approval.allowEnvironmentDrift ||
      approval.allowAiLogoGeneration
    ) {
      throw new ExecutionError(
        'APPROVAL_REQUIRED',
        'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
        false,
      );
    }

    const nowTimestamp = Date.parse(nowIso ?? new Date().toISOString());
    if (!Number.isFinite(nowTimestamp)) {
      throw new ExecutionError(
        'APPROVAL_REQUIRED',
        'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
        false,
      );
    }
    if (approval.expiresAt) {
      const expiresTimestamp = Date.parse(approval.expiresAt);
      if (!Number.isFinite(expiresTimestamp) || expiresTimestamp <= nowTimestamp) {
        throw new ExecutionError(
          'APPROVAL_REQUIRED',
          'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
          false,
        );
      }
    }
    return approval;
  }

  private async resolveRequiredReferences(
    approval: GenerativeExceptionApproval,
  ): Promise<readonly VenueReference[]> {
    const references = await this.dependencies.registry.getReferenceSet(approval.referenceSetId);
    const eligible = references.filter(
      (reference) =>
        reference.referenceSetId === TOCA_VENUE_REFERENCE_SET_ID &&
        reference.status === 'ACTIVE' &&
        reference.venueVerified &&
        reference.requiredForGenerativeException,
    );
    const uniqueAssetIds = new Set(eligible.map((reference) => reference.assetId));
    if (
      eligible.length < Math.max(3, approval.minReferenceCount) ||
      uniqueAssetIds.size !== eligible.length
    ) {
      throw new ExecutionError('POLICY_DENIED', 'FAILED_GENERATIVE_REFERENCE_MISSING', false);
    }

    return [...eligible].sort((left, right) => left.referenceId.localeCompare(right.referenceId));
  }

  private async loadReferences(
    references: readonly VenueReference[],
  ): Promise<readonly LoadedCreativeTruthVenueReference[]> {
    const loaded: LoadedCreativeTruthVenueReference[] = [];
    for (const reference of references) {
      loaded.push(await this.dependencies.referenceLoader.load(reference));
    }
    return loaded;
  }
}

function validateRequest(request: ControlledStaticImageGenerationRequest): void {
  if (!request.contentItemId.trim() || !request.prompt.trim()) {
    throw new ExecutionError('POLICY_DENIED', 'GENERATIVE_IMAGE_REQUEST_INVALID', false);
  }
}
