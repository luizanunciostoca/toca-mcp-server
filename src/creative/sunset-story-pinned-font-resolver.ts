import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  SunsetStoryFontResolverPort,
  SunsetStoryPinnedFont,
} from './sunset-story-svg-renderer.js';
import type { SunsetStoryTypographyRole } from './sunset-story-typography.js';

interface SunsetStoryPinnedFontAsset {
  readonly family: string;
  readonly path: string;
  readonly sha256: string;
}

const BODONI_MODA: SunsetStoryPinnedFontAsset = {
  family: 'Bodoni Moda',
  path: 'assets/fonts/BodoniModa-Variable.ttf',
  sha256: '550f5e34ee0a828d7941b1fe9bc58b34e5260d3f33a61532e6d0a0114e79a5cf',
};

const MONTSERRAT: SunsetStoryPinnedFontAsset = {
  family: 'Montserrat',
  path: 'assets/fonts/Montserrat-Variable.ttf',
  sha256: '0f7b311b2f3279e4eef9b2f968bcdbab6e28f4daeb1f049f4f278a902bcd82f7',
};

const FONT_ASSET_BY_ROLE: Readonly<Record<SunsetStoryTypographyRole, SunsetStoryPinnedFontAsset>> =
  {
    EDITORIAL_DIDONE_HEADLINE: BODONI_MODA,
    GEOMETRIC_SANS_DISPLAY_HEAVY: MONTSERRAT,
    GEOMETRIC_SANS_SUPPORT: MONTSERRAT,
    CLEAN_SANS_TIME: MONTSERRAT,
    CLEAN_SANS_CTA: MONTSERRAT,
    CLEAN_SANS_HASHTAG: MONTSERRAT,
  };

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isTypographyRole(value: string): value is SunsetStoryTypographyRole {
  return Object.hasOwn(FONT_ASSET_BY_ROLE, value);
}

export class RepositorySunsetStoryPinnedFontResolver implements SunsetStoryFontResolverPort {
  constructor(private readonly repositoryRoot = process.cwd()) {}

  async resolve(fontRole: string): Promise<SunsetStoryPinnedFont> {
    if (!isTypographyRole(fontRole)) {
      throw new Error(`SUNSET_FONT_ROLE_UNSUPPORTED:${fontRole}`);
    }
    const asset = FONT_ASSET_BY_ROLE[fontRole];
    const bytes = new Uint8Array(await readFile(resolve(this.repositoryRoot, asset.path)));
    const observedSha256 = sha256(bytes);
    if (observedSha256 !== asset.sha256) {
      throw new Error(`SUNSET_FONT_SHA_MISMATCH:${fontRole}`);
    }
    return {
      fontRole,
      family: asset.family,
      mimeType: 'font/ttf',
      bytes,
      sha256: asset.sha256,
    };
  }
}
