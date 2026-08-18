import {
  operationScopedGenerativeExceptionApprovalSchema,
  referenceSetOperation,
  type OperationScopedGenerativeExceptionApproval,
  type TocaGenerativeOperation,
} from '../contracts/creative-truth-generative-reference-sets.js';
import {
  fidelityEvidenceSchema,
  venueReferenceSchema,
  type CreativeTruthGateResult,
  type FidelityEvidence,
  type VenueReference,
} from '../contracts/creative-truth.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface OperationScopedGenerativeFidelityInput {
  readonly contentItemId: string;
  readonly operation: TocaGenerativeOperation;
  readonly approval: OperationScopedGenerativeExceptionApproval;
  readonly references: readonly VenueReference[];
  readonly evidence?: FidelityEvidence;
  readonly candidateSha256: string;
  readonly nowIso?: string;
}

export function evaluateOperationScopedGenerativeFidelity(
  input: OperationScopedGenerativeFidelityInput,
): CreativeTruthGateResult {
  if (!SHA256_PATTERN.test(input.candidateSha256)) {
    return failed('FAILED_FIDELITY_EVIDENCE_BINDING', {
      reason: 'CANDIDATE_SHA_INVALID',
    });
  }

  const parsedApproval = operationScopedGenerativeExceptionApprovalSchema.safeParse(input.approval);
  if (!parsedApproval.success) {
    return failed('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION', {
      reason: 'OPERATION_SCOPED_APPROVAL_INVALID',
    });
  }

  const parsedReferences = input.references.map((reference) => venueReferenceSchema.safeParse(reference));
  if (parsedReferences.some((parsed) => !parsed.success)) {
    return failed('FAILED_GENERATIVE_REFERENCE_MISSING', {
      reason: 'MALFORMED_REFERENCE_EVIDENCE',
    });
  }
  const references = parsedReferences.map((parsed) => parsed.data);

  let evidence: FidelityEvidence | undefined;
  if (input.evidence) {
    const parsedEvidence = fidelityEvidenceSchema.safeParse(input.evidence);
    if (!parsedEvidence.success) {
      return failed('FAILED_FIDELITY_EVIDENCE_BINDING', {
        reason: 'MALFORMED_FIDELITY_EVIDENCE',
      });
    }
    evidence = parsedEvidence.data;
  }

  const approval = parsedApproval.data;
  const expectedOperation = referenceSetOperation(approval.referenceSetId);
  if (
    approval.status !== 'APPROVED' ||
    approval.contentItemId !== input.contentItemId ||
    approval.operation !== input.operation ||
    expectedOperation !== input.operation ||
    approval.allowArchitecturalInvention ||
    approval.allowEnvironmentDrift ||
    approval.allowAiLogoGeneration
  ) {
    return failed('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION', {
      reason: 'CONTENT_OR_OPERATION_SCOPE_MISMATCH',
      expectedOperation: input.operation,
      approvalOperation: approval.operation,
      referenceSetId: approval.referenceSetId,
    });
  }

  const nowTimestamp = Date.parse(input.nowIso ?? new Date().toISOString());
  if (!Number.isFinite(nowTimestamp)) {
    return failed('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION', {
      reason: 'INVALID_EVALUATION_TIME',
    });
  }
  if (approval.expiresAt) {
    const expiresTimestamp = Date.parse(approval.expiresAt);
    if (!Number.isFinite(expiresTimestamp) || expiresTimestamp <= nowTimestamp) {
      return failed('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION', {
        reason: 'APPROVAL_EXPIRED',
      });
    }
  }

  const eligible = references.filter(
    (reference) =>
      reference.referenceSetId === approval.referenceSetId &&
      reference.status === 'ACTIVE' &&
      reference.venueVerified &&
      reference.requiredForGenerativeException,
  );
  const eligibleIds = eligible.map((reference) => reference.assetId);
  const uniqueEligibleIds = new Set(eligibleIds);
  const uniqueReferenceIds = new Set(eligible.map((reference) => reference.referenceId));
  const minimum = Math.max(3, approval.minReferenceCount);
  if (
    eligible.length < minimum ||
    uniqueEligibleIds.size !== eligible.length ||
    uniqueReferenceIds.size !== eligible.length
  ) {
    return failed('FAILED_GENERATIVE_REFERENCE_MISSING', {
      referenceSetId: approval.referenceSetId,
      requiredMinimum: minimum,
      eligibleReferenceAssetIds: [...uniqueEligibleIds].sort(),
    });
  }

  if (!evidence || evidence.candidateSha256 !== input.candidateSha256) {
    return failed('FAILED_FIDELITY_EVIDENCE_BINDING', {
      reason: 'CANDIDATE_SHA_MISMATCH',
      candidateSha256: input.candidateSha256,
      evidenceCandidateSha256: evidence?.candidateSha256 ?? null,
    });
  }
  if (evidence.referenceSetId !== approval.referenceSetId) {
    return failed('FAILED_FIDELITY_EVIDENCE_BINDING', {
      reason: 'REFERENCE_SET_MISMATCH',
      referenceSetId: approval.referenceSetId,
      evidenceReferenceSetId: evidence.referenceSetId ?? null,
    });
  }

  const evidenceIds = evidence.referenceAssetIds ?? [];
  const uniqueEvidenceIds = new Set(evidenceIds);
  const evidenceCoversAllEligible = [...uniqueEligibleIds].every((assetId) =>
    uniqueEvidenceIds.has(assetId),
  );
  const evidenceUsesOnlyEligible = [...uniqueEvidenceIds].every((assetId) =>
    uniqueEligibleIds.has(assetId),
  );
  if (
    uniqueEvidenceIds.size !== evidenceIds.length ||
    uniqueEvidenceIds.size < minimum ||
    !evidenceCoversAllEligible ||
    !evidenceUsesOnlyEligible
  ) {
    return failed('FAILED_FIDELITY_EVIDENCE_BINDING', {
      reason: 'REFERENCE_EVIDENCE_COVERAGE_INVALID',
      requiredReferenceAssetIds: [...uniqueEligibleIds].sort(),
      evidenceReferenceAssetIds: [...uniqueEvidenceIds].sort(),
    });
  }

  if (
    !evidence.reviewRef?.trim() ||
    !['HUMAN_REVIEW', 'MULTIMODAL_PLUS_HUMAN'].includes(evidence.verificationMethod)
  ) {
    return failed('FAILED_GENERATIVE_OUTPUT_REVIEW_MISSING', {
      referenceSetId: approval.referenceSetId,
      verificationMethod: evidence.verificationMethod,
      reviewRef: evidence.reviewRef ?? null,
    });
  }

  const failureCodes: CreativeTruthGateResult['failureCodes'][number][] = [];
  if (!evidence.sourceIdentityPreserved) failureCodes.push('FAILED_SCENE_INVENTION_DETECTED');
  if (evidence.architectureDriftDetected) failureCodes.push('FAILED_ARCHITECTURE_DRIFT');
  if (evidence.sceneInventionDetected) failureCodes.push('FAILED_SCENE_INVENTION_DETECTED');
  if (evidence.logoReconstructionDetected) failureCodes.push('FAILED_AI_LOGO_RECONSTRUCTION');
  if (failureCodes.length > 0) {
    return {
      gate: 'VENUE_FIDELITY',
      status: 'FAILED',
      failureCodes: [...new Set(failureCodes)],
      evidence: {
        operation: input.operation,
        referenceSetId: approval.referenceSetId,
        candidateSha256: input.candidateSha256,
        reviewRef: evidence.reviewRef,
      },
    };
  }

  return {
    gate: 'VENUE_FIDELITY',
    status: 'PASSED',
    failureCodes: [],
    evidence: {
      operation: input.operation,
      referenceSetId: approval.referenceSetId,
      referenceAssetIds: [...uniqueEligibleIds].sort(),
      candidateSha256: input.candidateSha256,
      verifier: evidence.verifier,
      verificationMethod: evidence.verificationMethod,
      reviewRef: evidence.reviewRef,
      outputSpecificHumanReview: true,
      crossOperationReferenceReuse: false,
    },
  };
}

function failed(
  code: CreativeTruthGateResult['failureCodes'][number],
  evidence: Record<string, unknown>,
): CreativeTruthGateResult {
  return {
    gate: 'VENUE_FIDELITY',
    status: 'FAILED',
    failureCodes: [code],
    evidence,
  };
}
