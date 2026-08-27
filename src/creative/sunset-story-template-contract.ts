import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  SUNSET_STORY_TEMPLATE_IDS,
  type SunsetStoryTemplateId,
} from './sunset-story-template-registry.js';

export interface SunsetStoryPixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SunsetStoryCanonicalTextElement {
  readonly id: string;
  readonly text: string;
  readonly region: SunsetStoryPixelRect;
  readonly fontRole: string;
  readonly color: string;
  readonly alignment: 'LEFT' | 'CENTER' | 'RIGHT';
}

export interface SunsetStoryCanonicalShapeElement {
  readonly id: string;
  readonly region: SunsetStoryPixelRect;
  readonly fill: string;
  readonly stroke: string | null;
  readonly strokeWidthPx: number;
}

export interface SunsetStoryCanonicalAssetElement {
  readonly id: string;
  readonly assetId: string;
  readonly region: SunsetStoryPixelRect;
  readonly colorMode: string;
}

export interface SunsetStoryCanonicalTemplateContract {
  readonly schemaVersion: string;
  readonly templateId: SunsetStoryTemplateId;
  readonly referenceSha256: string;
  readonly canvas: {
    readonly width: 1080;
    readonly height: 1920;
  };
  readonly texts: readonly SunsetStoryCanonicalTextElement[];
  readonly shapes: readonly SunsetStoryCanonicalShapeElement[];
  readonly assets: readonly SunsetStoryCanonicalAssetElement[];
  readonly editorOnlyStrings: readonly string[];
  readonly raw: Readonly<Record<string, unknown>>;
}

const IGNORED_TREE_KEYS = new Set([
  'sourceOfTruth',
  'reference',
  'scope',
  'background',
  'photography',
  'contrast',
  'photoAdaptation',
  'qualityGate',
  'runtimeBoundary',
  'publicationBoundary',
  'productionMethod',
  'libraryCompatibility',
  'layoutInvariants',
  'invariants',
  'protectedRegions',
  'protectedLayoutRegions',
  'canvas',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberValue(record: Record<string, unknown>, short: string, long: string): number | null {
  const value = record[short] ?? record[long];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readRect(value: unknown): SunsetStoryPixelRect | null {
  if (!isRecord(value)) return null;
  const x = numberValue(value, 'x', 'x');
  const y = numberValue(value, 'y', 'y');
  const width = numberValue(value, 'w', 'width');
  const height = numberValue(value, 'h', 'height');
  if (x === null || y === null || width === null || height === null) return null;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1080 || y + height > 1920) {
    throw new Error('SUNSET_TEMPLATE_REGION_OUT_OF_BOUNDS');
  }
  return { x, y, width, height };
}

function normalizeAlignment(value: unknown): 'LEFT' | 'CENTER' | 'RIGHT' {
  if (value === 'LEFT' || value === 'RIGHT') return value;
  return 'CENTER';
}

function resolveReferenceSha(raw: Record<string, unknown>): string {
  const reference = raw.reference;
  if (isRecord(reference) && typeof reference.sha256 === 'string') return reference.sha256;
  const sourceOfTruth = raw.sourceOfTruth;
  if (isRecord(sourceOfTruth) && typeof sourceOfTruth.referenceImageSha256 === 'string') {
    return sourceOfTruth.referenceImageSha256;
  }
  throw new Error('SUNSET_TEMPLATE_REFERENCE_SHA_MISSING');
}

function collectStrings(value: unknown, target: string[]): void {
  if (typeof value === 'string') {
    if (value.trim().length > 0) target.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, target);
    return;
  }
  if (!isRecord(value)) return;
  for (const item of Object.values(value)) collectStrings(item, target);
}

function collectEditorOnlyStrings(value: unknown, target: string[], editorOnly = false): void {
  if (Array.isArray(value)) {
    for (const item of value) collectEditorOnlyStrings(item, target, editorOnly);
    return;
  }
  if (!isRecord(value)) return;
  const nodeIsEditorOnly = editorOnly || value.kind === 'EDITOR_ONLY';
  if (nodeIsEditorOnly) {
    collectStrings(value, target);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    collectEditorOnlyStrings(child, target, key === 'editorOnly');
  }
}

function footerAssetId(value: string): string {
  return value === 'TOCA' ? 'TOCA_DO_MORCEGO' : value;
}

function splitFooterRegion(
  region: SunsetStoryPixelRect,
  order: readonly string[],
): readonly SunsetStoryCanonicalAssetElement[] {
  const slotWidth = region.width / order.length;
  return order.map((assetId, index) => ({
    id: `FOOTER.${index + 1}`,
    assetId: footerAssetId(assetId),
    region: {
      x: region.x + slotWidth * index,
      y: region.y,
      width: slotWidth,
      height: region.height,
    },
    colorMode: 'WHITE',
  }));
}

function splitTextLineRegions(
  region: SunsetStoryPixelRect,
  lineCount: number,
): readonly SunsetStoryPixelRect[] {
  const lineHeight = region.height / lineCount;
  return Array.from({ length: lineCount }, (_, index) => ({
    x: region.x,
    y: region.y + lineHeight * index,
    width: region.width,
    height: lineHeight,
  }));
}

function resolveAssetId(
  pathParts: readonly string[],
  node: Record<string, unknown>,
): string | null {
  const explicit = node.assetId ?? node.brandId;
  if (typeof explicit === 'string' && explicit.length > 0) return footerAssetId(explicit);
  const kind = typeof node.kind === 'string' ? node.kind : '';
  const joined = pathParts.join('.').toLowerCase();
  if (kind.includes('SYMBOL') || joined.includes('symbol')) return 'TOCA_DO_MORCEGO_SYMBOL';
  if (kind.includes('LOGO') && joined.includes('toca')) return 'TOCA_DO_MORCEGO';
  return null;
}

interface WalkStyle {
  readonly fontRole: string;
  readonly color: string;
  readonly alignment: 'LEFT' | 'CENTER' | 'RIGHT';
}

interface ContractAccumulator {
  readonly texts: SunsetStoryCanonicalTextElement[];
  readonly shapes: SunsetStoryCanonicalShapeElement[];
  readonly assets: SunsetStoryCanonicalAssetElement[];
}

function addFooterAssets(
  node: Record<string, unknown>,
  region: SunsetStoryPixelRect,
  accumulator: ContractAccumulator,
): boolean {
  const orderValue = node.brandOrder ?? node.order;
  if (!Array.isArray(orderValue) || !orderValue.every((item) => typeof item === 'string'))
    return false;
  const order = orderValue;
  const approximateBoxes = node.approximateBoxes;
  if (isRecord(approximateBoxes)) {
    for (const [index, assetId] of order.entries()) {
      const box = readRect(approximateBoxes[assetId]);
      if (!box) throw new Error(`SUNSET_TEMPLATE_FOOTER_BOX_MISSING:${assetId}`);
      accumulator.assets.push({
        id: `FOOTER.${index + 1}`,
        assetId: footerAssetId(assetId),
        region: box,
        colorMode: typeof node.colorMode === 'string' ? node.colorMode : 'WHITE',
      });
    }
    return true;
  }
  accumulator.assets.push(...splitFooterRegion(region, order));
  return true;
}

function addTextShape(
  node: Record<string, unknown>,
  id: string,
  fallbackRegion: SunsetStoryPixelRect,
  accumulator: ContractAccumulator,
): void {
  const strokeValue = node.borderColor ?? node.stroke;
  const backgroundValue = node.background ?? node.fill;
  if (typeof strokeValue !== 'string' && typeof backgroundValue !== 'string') return;
  const strokeWidthValue = node.strokeWidthPx;
  const strokeWidthPx =
    typeof strokeWidthValue === 'number'
      ? strokeWidthValue
      : isRecord(strokeWidthValue) && typeof strokeWidthValue.min === 'number'
        ? strokeWidthValue.min
        : 1;
  const shapeRegion = readRect(node.outlineBox) ?? fallbackRegion;
  accumulator.shapes.push({
    id: `${id}.BOX`,
    region: shapeRegion,
    fill:
      typeof backgroundValue === 'string' && backgroundValue !== 'TRANSPARENT'
        ? backgroundValue
        : 'none',
    stroke: typeof strokeValue === 'string' ? strokeValue : null,
    strokeWidthPx,
  });
}

function walkContract(
  value: unknown,
  pathParts: readonly string[],
  inherited: WalkStyle,
  accumulator: ContractAccumulator,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      walkContract(item, [...pathParts, String(index + 1)], inherited, accumulator),
    );
    return;
  }
  if (!isRecord(value) || value.present === false || value.kind === 'EDITOR_ONLY') return;

  const fontRole = typeof value.fontRole === 'string' ? value.fontRole : inherited.fontRole;
  const colorValue = value.textColor ?? value.color ?? value.preferredColor;
  const color = typeof colorValue === 'string' ? colorValue : inherited.color;
  const alignment =
    value.alignment === undefined ? inherited.alignment : normalizeAlignment(value.alignment);
  const style: WalkStyle = { fontRole, color, alignment };
  const region = readRect(value.region ?? value.box);
  const textRegion = readRect(value.textRegion) ?? region;
  const id = pathParts.join('.').toUpperCase();

  if (typeof value.text === 'string' && textRegion) {
    accumulator.texts.push({ id, text: value.text, region: textRegion, fontRole, color, alignment });
    addTextShape(value, id, textRegion, accumulator);
  }

  const lineValues = value.lines;
  if (
    region &&
    Array.isArray(lineValues) &&
    lineValues.length > 0 &&
    lineValues.every((line) => typeof line === 'string')
  ) {
    const lineRegions = splitTextLineRegions(region, lineValues.length);
    lineValues.forEach((text, index) => {
      accumulator.texts.push({
        id: `${id}.LINES.${index + 1}`,
        text,
        region: lineRegions[index]!,
        fontRole,
        color,
        alignment,
      });
    });
  }

  if (region && addFooterAssets(value, region, accumulator)) return;

  const assetId = region ? resolveAssetId(pathParts, value) : null;
  if (region && assetId) {
    accumulator.assets.push({
      id,
      assetId,
      region,
      colorMode: typeof value.colorMode === 'string' ? value.colorMode : 'WHITE',
    });
  }

  for (const [key, child] of Object.entries(value)) {
    if (IGNORED_TREE_KEYS.has(key)) continue;
    if (
      key === 'region' ||
      key === 'box' ||
      key === 'textRegion' ||
      key === 'outlineBox' ||
      key === 'approximateBoxes'
    )
      continue;
    if (
      key === 'text' ||
      key === 'lines' ||
      key === 'fontRole' ||
      key === 'textColor' ||
      key === 'color'
    )
      continue;
    if (key === 'alignment' || key === 'brandOrder' || key === 'order') continue;
    if (key === 'stroke' || key === 'borderColor' || key === 'background' || key === 'fill')
      continue;
    walkContract(child, [...pathParts, key], style, accumulator);
  }
}

function dedupeById<T extends { readonly id: string }>(items: readonly T[]): readonly T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function normalizeSunsetStoryTemplateContract(
  value: unknown,
): SunsetStoryCanonicalTemplateContract {
  if (!isRecord(value)) throw new Error('SUNSET_TEMPLATE_CONTRACT_INVALID');
  const templateId = value.templateId;
  if (!SUNSET_STORY_TEMPLATE_IDS.includes(templateId as SunsetStoryTemplateId)) {
    throw new Error('SUNSET_TEMPLATE_ID_INVALID');
  }
  if (value.status !== 'APPROVED_VISUAL_CONTRACT')
    throw new Error('SUNSET_TEMPLATE_STATUS_INVALID');
  if (value.runtimeEligible !== false) throw new Error('SUNSET_TEMPLATE_RUNTIME_BOUNDARY_INVALID');
  if (!isRecord(value.canvas) || value.canvas.width !== 1080 || value.canvas.height !== 1920) {
    throw new Error('SUNSET_TEMPLATE_CANVAS_INVALID');
  }

  const accumulator: ContractAccumulator = { texts: [], shapes: [], assets: [] };
  const defaultStyle: WalkStyle = {
    fontRole: 'CANONICAL_SANS',
    color: '#FFFFFF',
    alignment: 'CENTER',
  };
  for (const [key, child] of Object.entries(value)) {
    if (IGNORED_TREE_KEYS.has(key) || key === 'editorOnly') continue;
    walkContract(child, [key], defaultStyle, accumulator);
  }

  const editorOnlyStrings: string[] = [];
  collectEditorOnlyStrings(value, editorOnlyStrings);

  return {
    schemaVersion: typeof value.schemaVersion === 'string' ? value.schemaVersion : 'UNKNOWN',
    templateId: templateId as SunsetStoryTemplateId,
    referenceSha256: resolveReferenceSha(value),
    canvas: { width: 1080, height: 1920 },
    texts: dedupeById(accumulator.texts),
    shapes: dedupeById(accumulator.shapes),
    assets: dedupeById(accumulator.assets),
    editorOnlyStrings: [...new Set(editorOnlyStrings)],
    raw: value,
  };
}

function templateFileName(templateId: SunsetStoryTemplateId): string {
  const match = /_V([1-9])$/.exec(templateId);
  if (!match?.[1]) throw new Error(`SUNSET_TEMPLATE_VERSION_UNRESOLVED:${templateId}`);
  return `sunset-template-master.v${match[1]}.json`;
}

export async function loadSunsetStoryTemplateContract(
  templateId: SunsetStoryTemplateId,
  repositoryRoot = process.cwd(),
): Promise<SunsetStoryCanonicalTemplateContract> {
  const filePath = path.join(
    repositoryRoot,
    'control',
    'creative-standards',
    'templates',
    templateFileName(templateId),
  );
  const contents = await readFile(filePath, 'utf8');
  return normalizeSunsetStoryTemplateContract(JSON.parse(contents) as unknown);
}
