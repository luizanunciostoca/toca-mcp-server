import type { CreativeTruthBrandAssetLoader } from '../providers/google-drive/creative-truth-brand-asset-loader.js';
import type { GoogleSheetsCreativeTruthRegistry } from '../providers/google-sheets/creative-truth-registry.js';
import type {
  SunsetStoryBrandAssetResolverPort,
  SunsetStoryOfficialBrandAsset,
} from './sunset-story-svg-renderer.js';

interface SunsetBrandRegistryBinding {
  readonly brand: string;
  readonly variant: string;
}

const SUNSET_BRAND_BINDINGS: Readonly<Record<string, SunsetBrandRegistryBinding>> = {
  TOCA_DO_MORCEGO: { brand: 'TOCA_DO_MORCEGO', variant: 'WHITE' },
  CORONA: { brand: 'CORONA', variant: 'WHITE' },
  RED_BULL: { brand: 'RED_BULL', variant: 'WHITE' },
  MORRO_DIGITAL: { brand: 'MORRO_DIGITAL', variant: 'WHITE' },
};

export class CreativeTruthSunsetStoryBrandAssetResolver
  implements SunsetStoryBrandAssetResolverPort
{
  constructor(
    private readonly registry: GoogleSheetsCreativeTruthRegistry,
    private readonly loader: CreativeTruthBrandAssetLoader,
  ) {}

  async resolve(assetId: string): Promise<SunsetStoryOfficialBrandAsset> {
    const binding = SUNSET_BRAND_BINDINGS[assetId];
    if (!binding) throw new Error(`SUNSET_BRAND_ASSET_MAPPING_MISSING:${assetId}`);
    const asset = await this.registry.getBrandAsset(binding.brand, binding.variant);
    if (!asset) throw new Error(`SUNSET_BRAND_ASSET_REGISTRY_MISSING:${assetId}`);
    const loaded = await this.loader.load(asset);
    if (loaded.contentType !== 'image/png') {
      throw new Error(`SUNSET_BRAND_ASSET_CONTENT_TYPE_UNSUPPORTED:${assetId}`);
    }
    if (!asset.sha256) throw new Error(`SUNSET_BRAND_ASSET_SHA_MISSING:${assetId}`);
    return {
      assetId,
      mimeType: 'image/png',
      bytes: loaded.bytes,
      sha256: asset.sha256.toLowerCase(),
    };
  }
}

export function listSunsetStoryMappedBrandAssetIds(): readonly string[] {
  return Object.keys(SUNSET_BRAND_BINDINGS);
}
