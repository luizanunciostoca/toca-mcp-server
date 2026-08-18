import type { BrandAsset, CreativeStandard } from '../contracts/creative-truth.js';
import { ExecutionError } from '../core/errors.js';
import type {
  OfficialBrandAssetInput,
  ThePartyEnvironment,
} from '../providers/local/local-creative-composer.js';

const THE_PARTY_NETWORKS = 'THE_PARTY_HYBRID_NETWORKS_V1';
const THE_PARTY_MINIMALIST = 'THE_PARTY_HYBRID_MINIMALIST_V1';
const SUNSET_STANDARDS = new Set(['SUNSET_STORY_V1', 'SUNSET_FEED_V1', 'SUNSET_AD_V1']);

export interface CanonicalBrandAssetRegistry {
  getBrandAsset(brand: string, variant: string): Promise<BrandAsset | undefined>;
}

export interface CanonicalGenerativeBrandBindingInput {
  readonly outputStandard: CreativeStandard;
  readonly visualStandard?: CreativeStandard;
  readonly requiredBrands: readonly string[];
  readonly suppliedBrandAssets: readonly OfficialBrandAssetInput[];
  readonly partyEnvironment?: ThePartyEnvironment;
}

export async function resolveCanonicalGenerativeBrandInputs(
  registry: CanonicalBrandAssetRegistry,
  input: CanonicalGenerativeBrandBindingInput,
): Promise<readonly OfficialBrandAssetInput[]> {
  const visualStandard = resolveVisualStandard(input.outputStandard, input.visualStandard);
  assertBrandRequirements(visualStandard, input.requiredBrands, input.partyEnvironment);

  const requiredBrands = [...input.requiredBrands];
  const uniqueRequiredBrands = new Set(requiredBrands);
  if (requiredBrands.length === 0 || uniqueRequiredBrands.size !== requiredBrands.length) {
    deny('FAILED_BRAND_ASSET_MISSING');
  }

  const suppliedByBrand = new Map<string, OfficialBrandAssetInput>();
  for (const supplied of input.suppliedBrandAssets) {
    const brand = supplied.registry.brand.trim();
    if (!uniqueRequiredBrands.has(brand) || suppliedByBrand.has(brand)) {
      deny('FAILED_BRAND_ASSET_MISSING');
    }
    suppliedByBrand.set(brand, supplied);
  }
  if (suppliedByBrand.size !== uniqueRequiredBrands.size) {
    deny('FAILED_BRAND_ASSET_MISSING');
  }

  const canonicalInputs: OfficialBrandAssetInput[] = [];
  for (const brand of requiredBrands) {
    const supplied = suppliedByBrand.get(brand);
    if (!supplied) deny('FAILED_BRAND_ASSET_MISSING');
    const canonical = await registry.getBrandAsset(brand, supplied.registry.variant);
    if (
      !canonical ||
      canonical.brand !== brand ||
      canonical.variant !== supplied.registry.variant ||
      canonical.status !== 'ACTIVE_APPROVED' ||
      canonical.aiReconstructionAllowed !== false ||
      canonical.integrityMode !== 'SHA256_PINNED' ||
      !canonical.sha256 ||
      canonical.contentType !== supplied.contentType
    ) {
      deny('FAILED_BRAND_ASSET_MISSING');
    }

    if (
      visualStandard.standardId === THE_PARTY_NETWORKS ||
      visualStandard.standardId === THE_PARTY_MINIMALIST
    ) {
      if (
        brand === 'THE_PARTY' &&
        (canonical.brandAssetId !== 'BRAND-THE-PARTY-WHITE-V1' || canonical.variant !== 'WHITE')
      ) {
        deny('FAILED_BRAND_ASSET_MISSING');
      }
    }

    canonicalInputs.push({
      ...supplied,
      registry: canonical,
    });
  }
  return canonicalInputs;
}

function resolveVisualStandard(
  outputStandard: CreativeStandard,
  visualStandard?: CreativeStandard,
): CreativeStandard {
  if (outputStandard.operation !== 'ALL') return outputStandard;
  if (!visualStandard) deny('GENERATIVE_OPERATION_SCOPED_VISUAL_STANDARD_REQUIRED');
  return visualStandard;
}

function assertBrandRequirements(
  visualStandard: CreativeStandard,
  requiredBrands: readonly string[],
  partyEnvironment?: ThePartyEnvironment,
): void {
  const required = new Set(requiredBrands);
  if (SUNSET_STANDARDS.has(visualStandard.standardId) && !required.has('TOCA_DO_MORCEGO')) {
    deny('FAILED_BRAND_ASSET_MISSING');
  }

  const isParty =
    visualStandard.standardId === THE_PARTY_NETWORKS ||
    visualStandard.standardId === THE_PARTY_MINIMALIST;
  if (isParty && !required.has('THE_PARTY')) {
    deny('FAILED_BRAND_ASSET_MISSING');
  }
  if (visualStandard.standardId === THE_PARTY_NETWORKS && !partyEnvironment) {
    deny('THE_PARTY_ENVIRONMENT_REQUIRED');
  }
}

function deny(message: string): never {
  throw new ExecutionError('POLICY_DENIED', message, false);
}
