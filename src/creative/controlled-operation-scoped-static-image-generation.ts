import {
  isTocaGenerativeVenueReferenceSetId,
  referenceSetOperation,
  type OperationScopedGenerativeExceptionApproval,
  type TocaGenerativeOperation,
} from '../contracts/creative-truth-generative-reference-sets.js';
import type { VenueReference } from '../contracts/creative-truth.js';
import { ExecutionError } from '../core/errors.js';
import type {
  CreativeTruthVenueReferenceLoader,
  LoadedCreativeTruthVenueReference,
} from '../providers/google-drive/creative-truth-reference-loader.js';
import type { OperationScopedGenerativeRegistry } from '../providers/google-sheets/creative-truth-operation-scoped-generative-registry.js';
import type {
  CreativeTruthOperationScopedImageGenerator,
  OperationScopedGenerativeImageResult,
} from '../providers/openai/creative-truth-operation-scoped-image-generator.js';

export interface ControlledOperationScopedGenerationRequest {
  readonly contentItemId: string;
  readonly prompt: string;
  readonly nowIso?: string;
}

export interface ControlledOperationScopedGenerationDependencies {
  readonly registry: OperationScopedGenerativeRegistry;
  readonly referenceLoader: CreativeTruthVenueReferenceLoader;
  readonly generator: Pick<CreativeTruthOperationScopedImageGenerator, 'generate'>;
}

export class ControlledOperationScopedStaticImageGenerationService {
  constructor(private readonly dependencies: ControlledOperationScopedGenerationDependencies) {}

  async generate(
    request: ControlledOperationScopedGenerationRequest,
  ): Promise<OperationScopedGenerativeImageResult> {
    validateRequest(request);
    await this.dependencies.registry.assertCanonicalPolicy();
    const operation = await this.resolveContentOperation(request.contentItemId);
    const approval = await this.resolveApproval(
      request.contentItemId,
      operation,
      request.nowIso,
    );
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

  private async resolveContentOperation(contentItemId: string): Promise<TocaGenerativeOperation> {
    const operation = await this.dependencies.registry.getContentItemOperation(contentItemId);
    if (!operation) {
      throw new ExecutionError(
        'POLICY_DENIED',
        'FAILED_GENERATIVE_CONTENT_OPERATION_MISSING',
        false,
      );
    }
    return operation;
  }

  private async resolveApproval(
    contentItemId: string,
    operation: TocaGenerativeOperation,
    nowIso?: string,
  ): Promise<OperationScopedGenerativeExceptionApproval> {
    const approval = await this.dependencies.registry.getApprovedGenerativeException(contentItemId);
    if (
      !approval ||
      approval.status !== 'APPROVED' ||
      !isTocaGenerativeVenueReferenceSetId(approval.referenceSetId) ||
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
    if (
      approval.operation !== operation ||
      referenceSetOperation(approval.referenceSetId) !== operation
    ) {
      throw new ExecutionError(
        'POLICY_DENIED',
        'FAILED_GENERATIVE_REFERENCE_SET_OPERATION_MISMATCH',
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
    approval: OperationScopedGenerativeExceptionApproval,
  ): Promise<readonly VenueReference[]> {
    const references = await this.dependencies.registry.getReferenceSet(approval.referenceSetId);
    const eligible = references.filter(
      (reference) =>
        reference.referenceSetId === approval.referenceSetId &&
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

    return [...eligible].sort((left, right) =>
      left.referenceId.localeCompare(right.referenceId),
    );
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

function validateRequest(request: ControlledOperationScopedGenerationRequest): void {
  if (!request.contentItemId.trim() || !request.prompt.trim()) {
    throw new ExecutionError('POLICY_DENIED', 'GENERATIVE_IMAGE_REQUEST_INVALID', false);
  }
}
