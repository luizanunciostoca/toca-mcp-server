import { createHash } from 'node:crypto';
import type { SunsetStoryRenderPlan } from './sunset-story-render-plan.js';

export interface SunsetStoryOfficialBrandAsset {
  readonly assetId: string;
  readonly mimeType: 'image/svg+xml' | 'image/png';
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export interface SunsetStoryBrandAssetResolverPort {
  resolve(assetId: string): Promise<SunsetStoryOfficialBrandAsset>;
}

export interface SunsetStoryPinnedFont {
  readonly fontRole: string;
  readonly family: string;
  readonly sha256: string;
}

export interface SunsetStoryFontResolverPort {
  resolve(fontRole: string): Promise<SunsetStoryPinnedFont>;
}

export interface SunsetStorySvgRenderRequest {
  readonly imageBytes: Uint8Array;
  readonly imageMimeType: 'image/jpeg' | 'image/png';
  readonly plan: SunsetStoryRenderPlan;
}

export interface SunsetStorySvgRenderResult {
  readonly mimeType: 'image/svg+xml';
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly fontShas: Readonly<Record<string, string>>;
  readonly assetShas: Readonly<Record<string, string>>;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertPinnedSha(bytes: Uint8Array, expected: string, code: string): void {
  if (!/^[a-f0-9]{64}$/i.test(expected)) throw new Error(`${code}_SHA_INVALID`);
  if (sha256(bytes) !== expected.toLowerCase()) throw new Error(`${code}_SHA_MISMATCH`);
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function dataUri(mimeType: string, bytes: Uint8Array): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
}

function renderShape(shape: SunsetStoryRenderPlan['shapes'][number]): string {
  const stroke = shape.stroke ?? 'none';
  return `<rect x="${shape.region.x}" y="${shape.region.y}" width="${shape.region.width}" height="${shape.region.height}" fill="${escapeXml(shape.fill)}" stroke="${escapeXml(stroke)}" stroke-width="${shape.strokeWidthPx}" />`;
}

function renderDarkening(
  item: SunsetStoryRenderPlan['localDarkening'][number],
  index: number,
): string {
  const filterId = `darkening-blur-${index}`;
  if (item.featherPx === 0) {
    return `<rect x="${item.region.x}" y="${item.region.y}" width="${item.region.width}" height="${item.region.height}" fill="#000000" opacity="${item.opacity}" />`;
  }
  return `<g><filter id="${filterId}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${item.featherPx / 3}" /></filter><rect x="${item.region.x}" y="${item.region.y}" width="${item.region.width}" height="${item.region.height}" rx="${Math.min(item.region.width, item.region.height) / 5}" fill="#000000" opacity="${item.opacity}" filter="url(#${filterId})" /></g>`;
}

function fontSizeForRegion(text: string, width: number, height: number, fontScale: number): number {
  const byHeight = height * 0.68 * fontScale;
  const roughCharacterWidth = 0.56;
  const byWidth = (width / Math.max(1, text.length * roughCharacterWidth)) * fontScale;
  return Math.max(10, Math.min(byHeight, byWidth));
}

function textAnchor(alignment: 'LEFT' | 'CENTER' | 'RIGHT'): 'start' | 'middle' | 'end' {
  if (alignment === 'LEFT') return 'start';
  if (alignment === 'RIGHT') return 'end';
  return 'middle';
}

function textX(
  alignment: 'LEFT' | 'CENTER' | 'RIGHT',
  region: SunsetStoryRenderPlan['texts'][number]['region'],
): number {
  if (alignment === 'LEFT') return region.x;
  if (alignment === 'RIGHT') return region.x + region.width;
  return region.x + region.width / 2;
}

function renderText(item: SunsetStoryRenderPlan['texts'][number], fontFamily: string): string {
  const size = fontSizeForRegion(item.text, item.region.width, item.region.height, item.fontScale);
  const x = textX(item.alignment, item.region);
  const y = item.region.y + item.region.height / 2;
  return `<text x="${x}" y="${y}" fill="${escapeXml(item.color)}" font-family="${escapeXml(fontFamily)}" font-size="${size}" text-anchor="${textAnchor(item.alignment)}" dominant-baseline="middle">${escapeXml(item.text)}</text>`;
}

function scaledAssetBox(
  region: SunsetStoryRenderPlan['assets'][number]['region'],
  scale: number,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const width = region.width * scale;
  const height = region.height * scale;
  return {
    x: region.x + (region.width - width) / 2,
    y: region.y + (region.height - height) / 2,
    width,
    height,
  };
}

export class SunsetStoryDynamicSvgRenderer {
  constructor(
    private readonly brandAssets: SunsetStoryBrandAssetResolverPort,
    private readonly fonts: SunsetStoryFontResolverPort,
  ) {}

  async render(request: SunsetStorySvgRenderRequest): Promise<SunsetStorySvgRenderResult> {
    const plan = request.plan;
    const fontRoles = [...new Set(plan.texts.map((item) => item.fontRole))];
    const pinnedFonts = await Promise.all(fontRoles.map((role) => this.fonts.resolve(role)));
    const fontsByRole = new Map(pinnedFonts.map((font) => [font.fontRole, font]));
    const fontShas: Record<string, string> = {};
    for (const font of pinnedFonts) {
      if (!/^[a-f0-9]{64}$/i.test(font.sha256)) throw new Error('SUNSET_RENDER_FONT_SHA_INVALID');
      if (font.family.trim().length === 0) throw new Error('SUNSET_RENDER_FONT_FAMILY_MISSING');
      fontShas[font.fontRole] = font.sha256.toLowerCase();
    }

    const uniqueAssetIds = [...new Set(plan.assets.map((item) => item.assetId))];
    const resolvedAssets = await Promise.all(
      uniqueAssetIds.map((assetId) => this.brandAssets.resolve(assetId)),
    );
    const assetsById = new Map(resolvedAssets.map((asset) => [asset.assetId, asset]));
    const assetShas: Record<string, string> = {};
    for (const asset of resolvedAssets) {
      assertPinnedSha(asset.bytes, asset.sha256, 'SUNSET_RENDER_BRAND_ASSET');
      assetShas[asset.assetId] = asset.sha256.toLowerCase();
    }

    const crop = plan.sourcePhoto.cropWindow;
    const cropX = crop.x * plan.sourcePhoto.sourceWidth;
    const cropY = crop.y * plan.sourcePhoto.sourceHeight;
    const cropWidth = crop.width * plan.sourcePhoto.sourceWidth;
    const cropHeight = crop.height * plan.sourcePhoto.sourceHeight;
    const background = `<svg x="0" y="0" width="1080" height="1920" viewBox="${cropX} ${cropY} ${cropWidth} ${cropHeight}" preserveAspectRatio="none"><image x="0" y="0" width="${plan.sourcePhoto.sourceWidth}" height="${plan.sourcePhoto.sourceHeight}" href="${dataUri(request.imageMimeType, request.imageBytes)}" /></svg>`;
    const darkening = plan.localDarkening.map(renderDarkening).join('');
    const shapes = plan.shapes.map(renderShape).join('');
    const textElements = plan.texts
      .map((item) => {
        const font = fontsByRole.get(item.fontRole);
        if (!font) throw new Error(`SUNSET_RENDER_FONT_NOT_RESOLVED:${item.fontRole}`);
        return renderText(item, font.family);
      })
      .join('');
    const assetElements = plan.assets
      .map((item) => {
        const asset = assetsById.get(item.assetId);
        if (!asset) throw new Error(`SUNSET_RENDER_ASSET_NOT_RESOLVED:${item.assetId}`);
        const box = scaledAssetBox(item.region, item.opticalScale);
        return `<image x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" preserveAspectRatio="xMidYMid meet" href="${dataUri(asset.mimeType, asset.bytes)}" />`;
      })
      .join('');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">${background}${darkening}${shapes}${textElements}${assetElements}</svg>`;
    const bytes = new TextEncoder().encode(svg);
    return {
      mimeType: 'image/svg+xml',
      bytes,
      sha256: sha256(bytes),
      fontShas,
      assetShas,
    };
  }
}
