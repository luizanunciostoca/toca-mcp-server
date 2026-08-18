import { referenceSetOperation } from '../../contracts/creative-truth-generative-reference-sets.js';
import { ExecutionError } from '../../core/errors.js';
import type { OperationScopedGenerativeRegistry } from '../google-sheets/creative-truth-operation-scoped-generative-registry.js';
import type {
  LocalOperationScopedGenerativeComposeInput,
  LocalOperationScopedGenerativeComposeResult,
  LocalOperationScopedGenerativeComposer,
} from './local-operation-scoped-generative-composer.js';

export type ControlledOperationScopedGenerativeFinalizationInput = Omit<
  LocalOperationScopedGenerativeComposeInput,
  'approval' | 'references'
>;

export interface ControlledOperationScopedGenerativeFinalizationDependencies {
  readonly registry: OperationScopedGenerativeRegistry;
  readonly composer: Pick<LocalOperationScopedGenerativeComposer, 'compose'>;
}

/**
 * Canonical finalization boundary for full-static GENERATIVE_EXCEPTION outputs.
 *
 * The local compositor is deliberately a rendering primitive. Production callers must
 * enter through this service so caller-supplied approval/reference objects can never
 * become authority for the final Venue Fidelity PASS or deterministic render manifest.
 */
export class ControlledOperationScopedGenerativeFinalizationService {
  constructor(
    private readonly dependencies: ControlledOperationScopedGenerativeFinalizationDependencies,
  ) {}

  async finalize(
    input: ControlledOperationScopedGenerativeFinalizationInput,
  ): Promise<LocalOperationScopedGenerativeComposeResult> {
    const contentItemId = input.contentItemId.trim();
    if (!contentItemId) {
      throw new ExecutionError(
        'POLICY_DENIED',
        'FAILED_GENERATIVE_CONTENT_OPERATION_MISSING',
        false,
      );
    }

    await this.dependencies.registry.assertCanonicalPolicy();
    const [operation, approval] = await Promise.all([
      this.dependencies.registry.getContentItemOperation(contentItemId),
      this.dependencies.registry.getApprovedGenerativeException(contentItemId),
    ]);

    if (!operation) {
      throw new ExecutionError(
        'POLICY_DENIED',
        'FAILED_GENERATIVE_CONTENT_OPERATION_MISSING',
        false,
      );
    }
    if (!approval || approval.status !== 'APPROVED') {
      throw new ExecutionError(
        'APPROVAL_REQUIRED',
        'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
        false,
      );
    }
    if (
      approval.contentItemId !== contentItemId ||
      approval.operation !== operation ||
      referenceSetOperation(approval.referenceSetId) !== operation
    ) {
      throw new ExecutionError(
        'POLICY_DENIED',
        'FAILED_GENERATIVE_REFERENCE_SET_OPERATION_MISMATCH',
        false,
      );
    }

    const canonicalReferences = await this.dependencies.registry.getReferenceSet(
      approval.referenceSetId,
    );
    const requiredReferences = canonicalReferences.filter(
      (reference) =>
        reference.referenceSetId === approval.referenceSetId &&
        reference.status === 'ACTIVE' &&
        reference.venueVerified &&
        reference.requiredForGenerativeException,
    );
    const uniqueReferenceIds = new Set(requiredReferences.map((reference) => reference.referenceId));
    const uniqueAssetIds = new Set(requiredReferences.map((reference) => reference.assetId));
    const minimum = Math.max(3, approval.minReferenceCount);
    if (
      requiredReferences.length < minimum ||
      uniqueReferenceIds.size !== requiredReferences.length ||
      uniqueAssetIds.size !== requiredReferences.length
    ) {
      throw new ExecutionError('POLICY_DENIED', 'FAILED_GENERATIVE_REFERENCE_MISSING', false);
    }

    return this.dependencies.composer.compose({
      ...input,
      contentItemId,
      approval,
      references: [...requiredReferences].sort((left, right) =>
        left.referenceId.localeCompare(right.referenceId),
      ),
    });
  }
}
