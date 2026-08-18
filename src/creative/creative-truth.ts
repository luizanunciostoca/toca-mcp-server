import { createHash } from 'node:crypto';
import { ExecutionError } from '../core/errors.js';
import {
  TOCA_CREATIVE_TRUTH_POLICY_ID,
  TOCA_VENUE_REFERENCE_SET_ID,
  type BrandAsset,
  type CreativeAssetLocator,
  type CreativeMode,
  type CreativeStandard,
  type CreativeTruthFailureCode,
  type CreativeTruthGateResult,
  type CreativeTruthPublicationBinding,
  type DeterministicRenderManifest,
  type FidelityEvidence,
  type GenerativeExceptionApproval,
  type VenueAsset,
  type VenueReference,
  creativeAssetLocatorSchema,
  deterministicRenderManifestSchema,
  fidelityEvidenceSchema,
} from '../contracts/creative-truth.js';

export interface ResolvedBrandAsset {
  readonly asset: BrandAsset;
  readonly observedDriveFileId: string;
  readonly observedSha256?: string;
  readonly aiGenerated?: boolean;
}

export interface VenueFidelityInput {
  readonly contentItemId?: string;
  readonly creativeMode: CreativeMode;
  readonly venueAsset?: VenueAsset;
  readonly generativeException?: GenerativeExceptionApproval;
  readonly references?: readonly VenueReference[];
  readonly evidence?: FidelityEvidence;
  readonly candidateSha256?: string;
  readonly nowIso?: string;
}

export function resolveCreativeMode(requested?: CreativeMode): CreativeMode {
  return requested ?? 'REAL_COMPOSITE';
}

export function evaluateBrandIntegrity(
  requiredBrands: readonly string[],
  resolvedAssets: readonly ResolvedBrandAsset[],
): CreativeTruthGateResult {
  const failures = new Set<CreativeTruthFailureCode>();
  const assetsByBrand = new Map<string, ResolvedBrandAsset[]>();
  for (const resolved of resolvedAssets) {
    const group = assetsByBrand.get(resolved.asset.brand) ?? [];
    group.push(resolved);
    assetsByBrand.set(resolved.asset.brand, group);
  }

  for (const brand of new Set(requiredBrands)) {
    const candidates = assetsByBrand.get(brand) ?? [];
    if (candidates.length !== 1) {
      failures.add('FAILED_BRAND_ASSET_MISSING');
      continue;
    }
    const resolved = candidates[0]!;
    if (resolved.asset.status !== 'ACTIVE_APPROVED') {
      failures.add('FAILED_BRAND_ASSET_MISSING');
      continue;
    }
    if (resolved.aiGenerated === true || resolved.asset.aiReconstructionAllowed !== false) {
      failures.add('FAILED_AI_LOGO_RECONSTRUCTION');
    }
    if (resolved.observedDriveFileId !== resolved.asset.driveFileId) {
      failures.add('FAILED_BRAND_ASSET_MISSING');
    }
    if (
      resolved.asset.integrityMode !== 'SHA256_PINNED' ||
      !resolved.asset.sha256 ||
      !resolved.observedSha256 ||
      resolved.asset.sha256.toLowerCase() !== resolved.observedSha256.toLowerCase()
    ) {
      failures.add('FAILED_BRAND_ASSET_HASH_MISMATCH');
    }
  }

  if (new Set(requiredBrands).size !== requiredBrands.length) {
    failures.add('FAILED_BRAND_ASSET_MISSING');
  }

  return gateResult('BRAND_INTEGRITY', failures, {
    requiredBrands: [...requiredBrands],
    resolvedBrandAssetIds: resolvedAssets.map(({ asset }) => asset.brandAssetId),
    officialDriveFileIds: resolvedAssets.map(({ asset }) => asset.driveFileId),
    sha256PinnedOnly: true,
  });
}

export function evaluateVenueFidelity(input: VenueFidelityInput): CreativeTruthGateResult {
  const failures = new Set<CreativeTruthFailureCode>();
  const evidence = parseFidelityEvidence(input.evidence, failures);

  if (input.creativeMode === 'GENERATIVE_EXCEPTION') {
    validateGenerativeException(input, evidence, failures);
  } else {
    const venue = input.venueAsset;
    if (!venue || !venue.venueVerified || venue.status === 'REVOKED') {
      failures.add('FAILED_NO_VENUE_VERIFIED_ASSET');
    } else if (
      !venue.marketingReady ||
      !venue.masterAssetId ||
      !venue.masterDriveFileId ||
      !venue.masterSha256
    ) {
      failures.add('FAILED_LINEAGE_MISSING');
    }

    if (input.creativeMode === 'REAL_PLUS_ENHANCEMENT') {
      if (!evidence || !evidence.sourceIdentityPreserved) {
        failures.add('FAILED_VENUE_FIDELITY_GATE');
      } else {
        validateEvidenceCandidateBinding(input, evidence, failures);
        if (!venue?.masterSha256 || evidence.sourceSha256 !== venue.masterSha256) {
          failures.add('FAILED_FIDELITY_EVIDENCE_BINDING');
        }
      }
      addVisualDriftFailures(evidence, failures);
    }
  }

  return gateResult('VENUE_FIDELITY', failures, {
    creativeMode: input.creativeMode,
    venueAssetId: input.venueAsset?.venueAssetId ?? null,
    candidateSha256: input.candidateSha256 ?? null,
    evidenceCandidateSha256: evidence?.candidateSha256 ?? null,
    sourceSha256: evidence?.sourceSha256 ?? null,
    referenceSetId:
      input.generativeException?.referenceSetId ?? evidence?.referenceSetId ?? null,
    referenceAssetIds: (input.references ?? []).map((reference) => reference.assetId),
    verifier: evidence?.verifier ?? 'DETERMINISTIC_SOURCE_BINDING',
    verificationMethod: evidence?.verificationMethod ?? null,
    reviewRef: evidence?.reviewRef ?? null,
  });
}

export function evaluateQualityGate(
  passed: boolean,
  evidence: Readonly<Record<string, unknown>> = {},
): CreativeTruthGateResult {
  return gateResult('QUALITY', passed ? [] : ['FAILED_QUALITY_GATE'], evidence);
}

export function requireGatePassed(result: CreativeTruthGateResult): void {
  if (result.status === 'PASSED') return;
  const first = result.failureCodes[0] ?? 'FAILED_QUALITY_GATE';
  const errorCode =
    result.gate === 'VENUE_FIDELITY'
      ? 'FIDELITY_GATE_FAILED'
      : result.gate === 'QUALITY'
        ? 'QUALITY_GATE_FAILED'
        : 'POLICY_DENIED';
  throw new ExecutionError(errorCode, first, false);
}

export function assertCreativeStandard(standard?: CreativeStandard): CreativeStandard {
  if (
    !standard ||
    standard.status !== 'ACTIVE_CANONICAL' ||
    standard.parentPolicyId !== TOCA_CREATIVE_TRUTH_POLICY_ID
  ) {
    throw new ExecutionError('POLICY_DENIED', 'FAILED_STANDARD_NOT_RESOLVED', false);
  }
  return standard;
}

export function assertCreativeReadyForPublication(
  manifest: DeterministicRenderManifest,
): DeterministicRenderManifest {
  const parsed = deterministicRenderManifestSchema.parse(manifest);
  const expected = new Map(parsed.gates.map((gate) => [gate.gate, gate.status]));
  if (
    expected.get('BRAND_INTEGRITY') !== 'PASSED' ||
    expected.get('VENUE_FIDELITY') !== 'PASSED' ||
    expected.get('QUALITY') !== 'PASSED' ||
    !parsed.exactAssetBinding
  ) {
    throw new ExecutionError('POLICY_DENIED', 'CREATIVE_TRUTH_PUBLICATION_BLOCKED', false);
  }
  return parsed;
}

export function buildCreativeTruthPublicationBinding(
  manifest: DeterministicRenderManifest,
  assetLocators: readonly CreativeAssetLocator[],
): CreativeTruthPublicationBinding {
  const ready = assertCreativeReadyForPublication(manifest);
  const parsedLocators = assetLocators.map((locator) => creativeAssetLocatorSchema.parse(locator));
  if (parsedLocators.length === 0) {
    throw new ExecutionError('POLICY_DENIED', 'CREATIVE_TRUTH_ASSET_LOCATOR_REQUIRED', false);
  }
  return {
    policyId: TOCA_CREATIVE_TRUTH_POLICY_ID,
    standardId: ready.standardId,
    creativeId: ready.creativeId,
    outputSha256: ready.outputSha256,
    brandIntegrityStatus: 'PASSED',
    venueFidelityStatus: 'PASSED',
    qualityGateStatus: 'PASSED',
    assetLocators: parsedLocators,
    exactAssetBinding: true,
  };
}

export function buildTocaImageEditPrompt(
  userPrompt: string,
  creativeMode: CreativeMode,
): string {
  const common = [
    'TOCA CREATIVE TRUTH POLICY — mandatory.',
    'The supplied real Toca do Morcego asset is the source of spatial and factual truth.',
    'Preserve the identity of people, architecture, deck geometry, railings, furniture, lamps, materials, vegetation, sea, horizon, products and all factual scene elements.',
    'Do not add, remove, move or redesign architectural or venue elements.',
    'Do not invent a new terrace, bar, facade, room, viewpoint, railing, furniture set or landscape.',
    'Do not generate, redraw, repair or approximate any logo, wordmark, sponsor mark or trademark. Official brand assets are composited later by a deterministic renderer.',
    'Do not add marketing text to the image unless the source already contains that text and the request is explicitly a fidelity-preserving restoration.',
    'The result must remain traceable to the supplied source image and must pass Venue Fidelity and Brand Integrity gates.',
  ];
  if (creativeMode === 'GENERATIVE_EXCEPTION') {
    common.push(
      'This is an explicitly approved generative exception, but venue truth remains binding: use only the supplied verified Toca references for spatial language, materials, architecture and atmosphere; do not invent incompatible structures.',
      'The generated output must receive output-specific fidelity evidence and post-generation human review before it can become an approved final creative.',
    );
  } else if (creativeMode === 'REAL_PLUS_ENHANCEMENT') {
    common.push(
      'Allowed changes are faithful enhancement only: light, color, contrast, sharpness, denoise and minor cleanup that do not change scene semantics.',
    );
  } else {
    common.push('Do not replace the real photograph with a synthetic scene.');
  }
  common.push(`Requested creative treatment: ${userPrompt.trim()}`);
  return common.join('\n');
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function validateGenerativeException(
  input: VenueFidelityInput,
  evidence: FidelityEvidence | undefined,
  failures: Set<CreativeTruthFailureCode>,
): void {
  const approval = input.generativeException;
  if (!approval || approval.status !== 'APPROVED') {
    failures.add('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION');
    return;
  }
  if (!input.contentItemId || approval.contentItemId !== input.contentItemId) {
    failures.add('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION');
  }
  if (
    approval.referenceSetId !== TOCA_VENUE_REFERENCE_SET_ID ||
    approval.minReferenceCount < 3
  ) {
    failures.add('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION');
  }

  const nowTimestamp = Date.parse(input.nowIso ?? new Date().toISOString());
  if (!Number.isFinite(nowTimestamp)) {
    failures.add('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION');
  }
  if (approval.expiresAt) {
    const expiresTimestamp = Date.parse(approval.expiresAt);
    if (!Number.isFinite(expiresTimestamp) || expiresTimestamp <= nowTimestamp) {
      failures.add('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION');
    }
  }
  if (
    approval.allowArchitecturalInvention ||
    approval.allowEnvironmentDrift ||
    approval.allowAiLogoGeneration
  ) {
    failures.add('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION');
  }

  const requiredReferenceCount = Math.max(3, approval.minReferenceCount);
  const activeReferences = (input.references ?? []).filter(
    (reference) =>
      reference.status === 'ACTIVE' &&
      reference.venueVerified &&
      reference.requiredForGenerativeException &&
      reference.referenceSetId === TOCA_VENUE_REFERENCE_SET_ID &&
      reference.referenceSetId === approval.referenceSetId,
  );
  if (activeReferences.length < requiredReferenceCount) {
    failures.add('FAILED_GENERATIVE_REFERENCE_MISSING');
  }

  if (
    !evidence ||
    evidence.referenceSetId !== TOCA_VENUE_REFERENCE_SET_ID ||
    evidence.referenceSetId !== approval.referenceSetId ||
    !evidence.sourceIdentityPreserved
  ) {
    failures.add('FAILED_VENUE_FIDELITY_GATE');
  } else {
    validateEvidenceCandidateBinding(input, evidence, failures);
    const activeReferenceIds = new Set(activeReferences.map((reference) => reference.assetId));
    const evidencedActiveReferenceCount = new Set(evidence.referenceAssetIds).size;
    const allEvidenceReferencesAreActive = evidence.referenceAssetIds.every((assetId) =>
      activeReferenceIds.has(assetId),
    );
    if (
      evidencedActiveReferenceCount < requiredReferenceCount ||
      !allEvidenceReferencesAreActive
    ) {
      failures.add('FAILED_GENERATIVE_REFERENCE_MISSING');
    }
    if (
      !evidence.reviewRef ||
      !['HUMAN_REVIEW', 'MULTIMODAL_PLUS_HUMAN'].includes(evidence.verificationMethod)
    ) {
      failures.add('FAILED_GENERATIVE_OUTPUT_REVIEW_MISSING');
    }
  }

  addVisualDriftFailures(evidence, failures);
}

function parseFidelityEvidence(
  evidence: FidelityEvidence | undefined,
  failures: Set<CreativeTruthFailureCode>,
): FidelityEvidence | undefined {
  if (!evidence) return undefined;
  const parsed = fidelityEvidenceSchema.safeParse(evidence);
  if (!parsed.success) {
    failures.add('FAILED_FIDELITY_EVIDENCE_BINDING');
    return undefined;
  }
  return parsed.data;
}

function validateEvidenceCandidateBinding(
  input: VenueFidelityInput,
  evidence: FidelityEvidence,
  failures: Set<CreativeTruthFailureCode>,
): void {
  const candidateSha256 = input.candidateSha256?.trim().toLowerCase();
  if (!candidateSha256 || evidence.candidateSha256.toLowerCase() !== candidateSha256) {
    failures.add('FAILED_FIDELITY_EVIDENCE_BINDING');
  }
}

function addVisualDriftFailures(
  evidence: FidelityEvidence | undefined,
  failures: Set<CreativeTruthFailureCode>,
): void {
  if (!evidence) return;
  if (evidence.architectureDriftDetected) failures.add('FAILED_ARCHITECTURE_DRIFT');
  if (evidence.sceneInventionDetected) failures.add('FAILED_SCENE_INVENTION_DETECTED');
  if (evidence.logoReconstructionDetected) failures.add('FAILED_AI_LOGO_RECONSTRUCTION');
}

function gateResult(
  gate: CreativeTruthGateResult['gate'],
  failures: Iterable<CreativeTruthFailureCode>,
  evidence: Readonly<Record<string, unknown>>,
): CreativeTruthGateResult {
  const failureCodes = [...failures];
  return {
    gate,
    status: failureCodes.length === 0 ? 'PASSED' : 'FAILED',
    failureCodes,
    evidence: { ...evidence },
  };
}
