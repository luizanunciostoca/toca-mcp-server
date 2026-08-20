import { createHash } from 'node:crypto';
import { ExecutionError } from '../core/errors.js';
import {
  TOCA_CREATIVE_TRUTH_POLICY_ID,
  TOCA_VENUE_REFERENCE_SET_LEGACY_ID,
  TOCA_VENUE_REFERENCE_SET_SUNSET_ID,
  TOCA_VENUE_REFERENCE_SET_THE_PARTY_ID,
  type BrandAsset,
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
  creativeTruthPublicationBindingSchema,
  deterministicRenderManifestSchema,
} from '../contracts/creative-truth.js';

export interface ResolvedBrandAsset {
  readonly asset: BrandAsset;
  readonly observedDriveFileId: string;
  readonly observedSha256?: string;
  readonly aiGenerated?: boolean;
}

export interface VenueFidelityInput {
  readonly creativeMode: CreativeMode;
  readonly venueAsset?: VenueAsset;
  readonly generativeException?: GenerativeExceptionApproval;
  readonly references?: readonly VenueReference[];
  readonly evidence?: FidelityEvidence;
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
  const byBrand = new Map(resolvedAssets.map((entry) => [entry.asset.brand, entry]));

  for (const brand of requiredBrands) {
    const resolved = byBrand.get(brand);
    if (!resolved || resolved.asset.status !== 'ACTIVE_APPROVED') {
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
      resolved.asset.integrityMode === 'SHA256_PINNED' &&
      resolved.asset.sha256 !== resolved.observedSha256
    ) {
      failures.add('FAILED_BRAND_ASSET_HASH_MISMATCH');
    }
  }

  return gateResult('BRAND_INTEGRITY', failures, {
    requiredBrands: [...requiredBrands],
    resolvedBrandAssetIds: resolvedAssets.map(({ asset }) => asset.brandAssetId),
    officialDriveFileIds: resolvedAssets.map(({ asset }) => asset.driveFileId),
  });
}

export function evaluateVenueFidelity(input: VenueFidelityInput): CreativeTruthGateResult {
  const failures = new Set<CreativeTruthFailureCode>();
  const evidence = input.evidence;

  if (input.creativeMode === 'GENERATIVE_EXCEPTION') {
    validateGenerativeException(input, failures);
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
        failures.add('FAILED_ENHANCEMENT_PROVENANCE');
      }
      addVisualDriftFailures(evidence, failures);
    }
  }

  return gateResult('VENUE_FIDELITY', failures, {
    creativeMode: input.creativeMode,
    venueAssetId: input.venueAsset?.venueAssetId ?? null,
    referenceSetId:
      input.generativeException?.referenceSetId ?? input.evidence?.referenceSetId ?? null,
    referenceAssetIds: (input.references ?? []).map((reference) => reference.assetId),
    verifier: input.evidence?.verifier ?? 'DETERMINISTIC_SOURCE_BINDING',
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

export function assertCreativePublicationAssetHash(
  binding: CreativeTruthPublicationBinding,
  publicationAssetSha256: string,
): CreativeTruthPublicationBinding {
  const parsed = creativeTruthPublicationBindingSchema.parse(binding);
  if (parsed.outputSha256.toLowerCase() !== publicationAssetSha256.toLowerCase()) {
    throw new ExecutionError('POLICY_DENIED', 'FAILED_PUBLICATION_ASSET_HASH_MISMATCH', false);
  }
  return parsed;
}

export function buildTocaImageEditPrompt(userPrompt: string, creativeMode: CreativeMode): string {
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
  failures: Set<CreativeTruthFailureCode>,
): void {
  const approval = input.generativeException;
  if (!approval || approval.status !== 'APPROVED') {
    failures.add('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION');
    return;
  }
  if (
    approval.expiresAt &&
    Date.parse(approval.expiresAt) <= Date.parse(input.nowIso ?? new Date().toISOString())
  ) {
    failures.add('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION');
  }
  if (
    approval.allowArchitecturalInvention ||
    approval.allowEnvironmentDrift ||
    approval.allowAiLogoGeneration
  ) {
    failures.add('FAILED_UNAPPROVED_GENERATIVE_EXCEPTION');
  }

  const expectedReferenceSetId = referenceSetForOperation(approval.operation);
  if (
    !expectedReferenceSetId ||
    approval.referenceSetId === TOCA_VENUE_REFERENCE_SET_LEGACY_ID ||
    approval.referenceSetId !== expectedReferenceSetId
  ) {
    failures.add('FAILED_GENERATIVE_REFERENCE_OPERATION_MISMATCH');
  }

  const activeReferences = (input.references ?? []).filter(
    (reference) =>
      reference.status === 'ACTIVE' &&
      reference.venueVerified &&
      reference.referenceSetId === approval.referenceSetId &&
      reference.operationScope === approval.operation,
  );
  if (activeReferences.length < approval.minReferenceCount) {
    failures.add('FAILED_GENERATIVE_REFERENCE_MISSING');
  }
  if (
    !input.evidence ||
    input.evidence.referenceSetId !== approval.referenceSetId ||
    !input.evidence.sourceIdentityPreserved
  ) {
    failures.add('FAILED_VENUE_FIDELITY_GATE');
  }
  addVisualDriftFailures(input.evidence, failures);
}

function referenceSetForOperation(operation: string): string | undefined {
  if (operation === 'SUNSET') return TOCA_VENUE_REFERENCE_SET_SUNSET_ID;
  if (operation === 'THE_PARTY') return TOCA_VENUE_REFERENCE_SET_THE_PARTY_ID;
  return undefined;
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
