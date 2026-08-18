import {
  TOCA_CREATIVE_TRUTH_POLICY_ID,
  type BrandAsset,
  type CreativeMode,
  type CreativeStandard,
  type GenerativeExceptionApproval,
  type VenueAsset,
  type VenueReference,
} from '../contracts/creative-truth.js';
import { ExecutionError } from '../core/errors.js';
import type { GoogleSheetsCreativeTruthRegistry } from '../providers/google-sheets/creative-truth-registry.js';
import { assertCreativeStandard, resolveCreativeMode } from './creative-truth.js';

export interface CreativeTruthResolutionRequest {
  readonly contentItemId: string;
  readonly standardId: string;
  readonly operation: string;
  readonly requestedMode?: CreativeMode;
  readonly venueAssetId?: string;
  readonly requiredBrands: readonly string[];
  readonly brandVariant?: string;
}

export interface CreativeTruthResolution {
  readonly policyId: typeof TOCA_CREATIVE_TRUTH_POLICY_ID;
  readonly creativeMode: CreativeMode;
  readonly standard: CreativeStandard;
  readonly venueAsset?: VenueAsset;
  readonly brandAssets: readonly BrandAsset[];
  readonly generativeException?: GenerativeExceptionApproval;
  readonly references: readonly VenueReference[];
}

export class CreativeTruthResolver {
  constructor(private readonly registry: GoogleSheetsCreativeTruthRegistry) {}

  async resolve(request: CreativeTruthResolutionRequest): Promise<CreativeTruthResolution> {
    await this.registry.assertCanonicalPolicy();
    const standard = assertCreativeStandard(
      await this.registry.getCreativeStandard(request.standardId),
    );
    if (standard.operation !== request.operation && standard.operation !== 'ALL') {
      throw new ExecutionError('POLICY_DENIED', 'FAILED_STANDARD_NOT_RESOLVED', false);
    }

    const creativeMode = resolveCreativeMode(request.requestedMode);
    const brandAssets = await this.resolveBrands(
      request.requiredBrands,
      request.brandVariant ?? 'WHITE',
    );

    if (creativeMode === 'GENERATIVE_EXCEPTION') {
      const generativeException = await this.registry.getApprovedGenerativeException(
        request.contentItemId,
      );
      if (!generativeException || generativeException.status !== 'APPROVED') {
        throw new ExecutionError(
          'APPROVAL_REQUIRED',
          'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
          false,
        );
      }
      if (
        generativeException.allowArchitecturalInvention ||
        generativeException.allowEnvironmentDrift ||
        generativeException.allowAiLogoGeneration
      ) {
        throw new ExecutionError(
          'POLICY_DENIED',
          'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
          false,
        );
      }
      const references = await this.registry.getReferenceSet(generativeException.referenceSetId);
      const verified = references.filter(
        (reference) => reference.venueVerified && reference.status === 'ACTIVE',
      );
      if (verified.length < generativeException.minReferenceCount) {
        throw new ExecutionError(
          'POLICY_DENIED',
          'FAILED_GENERATIVE_REFERENCE_MISSING',
          false,
        );
      }
      return {
        policyId: TOCA_CREATIVE_TRUTH_POLICY_ID,
        creativeMode,
        standard,
        brandAssets,
        generativeException,
        references: verified,
      };
    }

    const venueAsset = request.venueAssetId
      ? await this.registry.getVenueAsset(request.venueAssetId)
      : await this.selectVenueAsset(request.operation);
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

  private async selectVenueAsset(operation: string): Promise<VenueAsset | undefined> {
    const candidates = await this.registry.listVenueAssets(operation);
    return candidates.find(
      (asset) =>
        asset.venueVerified &&
        asset.marketingReady &&
        asset.status === 'ACTIVE_APPROVED' &&
        Boolean(asset.masterAssetId && asset.masterDriveFileId && asset.masterSha256),
    );
  }
}
