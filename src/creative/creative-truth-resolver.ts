import {
  TOCA_CREATIVE_TRUTH_POLICY_ID,
  type BrandAsset,
  type CreativeMode,
  type CreativeStandard,
  type GenerativeExceptionApproval,
  type VideoShot,
  type VenueAsset,
  type VenueReference,
} from '../contracts/creative-truth.js';
import { ExecutionError } from '../core/errors.js';
import type { GoogleSheetsCreativeTruthRegistry } from '../providers/google-sheets/creative-truth-registry.js';
import { assertCreativeStandard, resolveCreativeMode } from './creative-truth.js';
import {
  THE_PARTY_HYBRID_NETWORKS_STANDARD_ID,
  isThePartyVisualStandardId,
  resolveThePartyVenueAssetPreferences,
  resolveThePartyVisualFamily,
  type ThePartyCreativeIntent,
  type ThePartyEnvironment,
} from './the-party-visual-family-resolver.js';

const APPROVED_VIDEO_RIGHTS = new Set([
  'APPROVED',
  'OWNED',
  'LICENSED',
  'CLEARED',
  'RIGHTS_CLEARED',
]);

export interface CreativeTruthResolutionRequest {
  readonly contentItemId: string;
  readonly standardId?: string;
  readonly operation: string;
  readonly requestedMode?: CreativeMode;
  readonly venueAssetId?: string;
  readonly requiredBrands: readonly string[];
  readonly brandVariant?: string;
  readonly thePartyIntent?: ThePartyCreativeIntent;
  readonly thePartyEnvironment?: ThePartyEnvironment;
}

export interface CreativeTruthResolution {
  readonly policyId: typeof TOCA_CREATIVE_TRUTH_POLICY_ID;
  readonly creativeMode: CreativeMode;
  readonly standard: CreativeStandard;
  readonly venueAsset?: VenueAsset;
  readonly brandAssets: readonly BrandAsset[];
  readonly generativeException?: GenerativeExceptionApproval;
  readonly references: readonly VenueReference[];
  readonly thePartyEnvironment?: ThePartyEnvironment;
}

export interface CreativeTruthVideoShotResolutionRequest {
  readonly operation: string;
  readonly shotIds: readonly string[];
}

export interface CreativeTruthVideoShotResolution {
  readonly policyId: typeof TOCA_CREATIVE_TRUTH_POLICY_ID;
  readonly operation: string;
  readonly shots: readonly VideoShot[];
}

export class CreativeTruthResolver {
  constructor(private readonly registry: GoogleSheetsCreativeTruthRegistry) {}

  async resolve(request: CreativeTruthResolutionRequest): Promise<CreativeTruthResolution> {
    await this.registry.assertCanonicalPolicy();
    const requestedStandardId = resolveRequestedStandardId(request);
    const standard = assertCreativeStandard(
      await this.registry.getCreativeStandard(requestedStandardId),
    );
    if (standard.operation !== request.operation && standard.operation !== 'ALL') {
      throw new ExecutionError('POLICY_DENIED', 'FAILED_STANDARD_NOT_RESOLVED', false);
    }
    if (
      request.operation === 'THE_PARTY' &&
      (!isThePartyVisualStandardId(standard.standardId) || standard.operation !== 'THE_PARTY')
    ) {
      throw new ExecutionError('POLICY_DENIED', 'FAILED_STANDARD_NOT_RESOLVED', false);
    }
    if (request.operation === 'THE_PARTY' && !request.requiredBrands.includes('THE_PARTY')) {
      throw new ExecutionError('POLICY_DENIED', 'FAILED_BRAND_ASSET_MISSING', false);
    }
    if (
      request.operation === 'THE_PARTY' &&
      standard.standardId === THE_PARTY_HYBRID_NETWORKS_STANDARD_ID &&
      !request.thePartyEnvironment
    ) {
      throw new ExecutionError('POLICY_DENIED', 'THE_PARTY_ENVIRONMENT_REQUIRED', false);
    }

    const creativeMode = resolveCreativeMode(request.requestedMode);
    if (creativeMode === 'GENERATIVE_EXCEPTION') {
      // The original generic resolver is intentionally not an execution path for generation.
      // Full-static generation must bind CONTENT_ITEMS.operation + scoped approval + scoped
      // references through ControlledOperationScopedStaticImageGenerationService instead.
      throw new ExecutionError(
        'POLICY_DENIED',
        'GENERATIVE_EXCEPTION_REQUIRES_OPERATION_SCOPED_PIPELINE',
        false,
      );
    }

    const brandAssets = await this.resolveBrands(
      request.requiredBrands,
      request.brandVariant ?? 'WHITE',
    );
    const partyContext =
      request.operation === 'THE_PARTY' &&
      standard.standardId === THE_PARTY_HYBRID_NETWORKS_STANDARD_ID &&
      request.thePartyEnvironment
        ? { thePartyEnvironment: request.thePartyEnvironment }
        : {};

    const venueAsset = request.venueAssetId
      ? await this.registry.getVenueAsset(request.venueAssetId)
      : await this.selectVenueAsset(request);
    if (!venueAsset || !venueAsset.venueVerified || venueAsset.status === 'REVOKED') {
      throw new ExecutionError(
        'POLICY_DENIED',
        'FAILED_NO_VENUE_VERIFIED_ASSET',
        false,
      );
    }
    if (
      standard.realAssetRequired &&
      (!venueAsset.marketingReady ||
        !venueAsset.masterAssetId ||
        !venueAsset.masterDriveFileId ||
        !venueAsset.masterSha256)
    ) {
      throw new ExecutionError('POLICY_DENIED', 'FAILED_LINEAGE_MISSING', false);
    }

    return {
      policyId: TOCA_CREATIVE_TRUTH_POLICY_ID,
      creativeMode,
      standard,
      venueAsset,
      brandAssets,
      references: [],
      ...partyContext,
    };
  }

  async resolveVideoShots(
    request: CreativeTruthVideoShotResolutionRequest,
  ): Promise<CreativeTruthVideoShotResolution> {
    await this.registry.assertCanonicalPolicy();
    const operation = request.operation.trim();
    if (!operation || request.shotIds.length === 0) {
      throw new ExecutionError('POLICY_DENIED', 'VIDEO_SHOT_RESOLUTION_REQUIRED', false);
    }

    const requestedIds = request.shotIds.map((shotId) => shotId.trim());
    if (requestedIds.some((shotId) => !shotId) || new Set(requestedIds).size !== requestedIds.length) {
      throw new ExecutionError('POLICY_DENIED', 'VIDEO_SHOT_RESOLUTION_INVALID', false);
    }

    const shots: VideoShot[] = [];
    for (const shotId of requestedIds) {
      const shot = await this.registry.getVideoShot(shotId);
      if (
        !shot ||
        shot.status !== 'ACTIVE_APPROVED' ||
        !shot.venueVerified ||
        !shot.marketingReady
      ) {
        throw new ExecutionError('POLICY_DENIED', 'FAILED_NO_VENUE_VERIFIED_ASSET', false);
      }
      if (
        !shot.masterAssetId ||
        !shot.masterDriveFileId ||
        !shot.masterSha256 ||
        !shot.sourceAssetId ||
        !shot.sourceDriveFileId
      ) {
        throw new ExecutionError('POLICY_DENIED', 'FAILED_LINEAGE_MISSING', false);
      }
      if (shot.operation !== operation && shot.operation !== 'ALL') {
        throw new ExecutionError('POLICY_DENIED', 'FAILED_STANDARD_NOT_RESOLVED', false);
      }
      if (!APPROVED_VIDEO_RIGHTS.has(shot.rightsStatus.trim().toUpperCase())) {
        throw new ExecutionError('POLICY_DENIED', 'VIDEO_SHOT_RIGHTS_NOT_CLEARED', false);
      }
      shots.push(shot);
    }

    return {
      policyId: TOCA_CREATIVE_TRUTH_POLICY_ID,
      operation,
      shots,
    };
  }

  private async resolveBrands(
    requiredBrands: readonly string[],
    variant: string,
  ): Promise<readonly BrandAsset[]> {
    const resolved: BrandAsset[] = [];
    for (const brand of requiredBrands) {
      const asset = await this.registry.getBrandAsset(brand, variant);
      if (!asset || asset.status !== 'ACTIVE_APPROVED') {
        throw new ExecutionError('POLICY_DENIED', 'FAILED_BRAND_ASSET_MISSING', false);
      }
      if (asset.aiReconstructionAllowed !== false) {
        throw new ExecutionError('POLICY_DENIED', 'FAILED_AI_LOGO_RECONSTRUCTION', false);
      }
      resolved.push(asset);
    }
    return resolved;
  }

  private async selectVenueAsset(
    request: CreativeTruthResolutionRequest,
  ): Promise<VenueAsset | undefined> {
    const candidates = await this.registry.listVenueAssets(request.operation);
    const eligible = candidates.filter(
      (asset) =>
        asset.venueVerified &&
        asset.marketingReady &&
        asset.status === 'ACTIVE_APPROVED' &&
        Boolean(asset.masterAssetId && asset.masterDriveFileId && asset.masterSha256),
    );

    if (request.operation !== 'THE_PARTY') return eligible[0];
    if (!request.thePartyIntent) {
      throw new ExecutionError('POLICY_DENIED', 'THE_PARTY_VISUAL_INTENT_REQUIRED', false);
    }

    const preferredAssetIds = resolveThePartyVenueAssetPreferences({
      intent: request.thePartyIntent,
      ...(request.thePartyEnvironment ? { environment: request.thePartyEnvironment } : {}),
    });
    for (const venueAssetId of preferredAssetIds) {
      const match = eligible.find((asset) => asset.venueAssetId === venueAssetId);
      if (match) return match;
    }
    return undefined;
  }
}

function resolveRequestedStandardId(request: CreativeTruthResolutionRequest): string {
  const explicit = request.standardId?.trim();
  if (request.operation !== 'THE_PARTY') {
    if (!explicit) {
      throw new ExecutionError('POLICY_DENIED', 'FAILED_STANDARD_NOT_RESOLVED', false);
    }
    return explicit;
  }

  if (explicit) {
    if (request.thePartyIntent) {
      const resolved = resolveThePartyVisualFamily({
        intent: request.thePartyIntent,
        ...(request.thePartyEnvironment ? { environment: request.thePartyEnvironment } : {}),
      });
      if (resolved.standardId !== explicit) {
        throw new ExecutionError('POLICY_DENIED', 'THE_PARTY_STANDARD_INTENT_MISMATCH', false);
      }
    }
    return explicit;
  }
  if (!request.thePartyIntent) {
    throw new ExecutionError('POLICY_DENIED', 'THE_PARTY_VISUAL_INTENT_REQUIRED', false);
  }
  return resolveThePartyVisualFamily({
    intent: request.thePartyIntent,
    ...(request.thePartyEnvironment ? { environment: request.thePartyEnvironment } : {}),
  }).standardId;
}
