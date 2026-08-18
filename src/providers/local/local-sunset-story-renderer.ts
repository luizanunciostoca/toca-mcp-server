import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type {
  CreativeEnhancementProvenance,
  CreativeMode,
  CreativeStandard,
  DeterministicRenderManifest,
  FidelityEvidence,
  VenueAsset,
} from '../../contracts/creative-truth.js';
import {
  TOCA_CREATIVE_TRUTH_POLICY_ID,
  creativeEnhancementProvenanceSchema,
} from '../../contracts/creative-truth.js';
import { ExecutionError } from '../../core/errors.js';
import {
  assertCreativeStandard,
  evaluateBrandIntegrity,
  evaluateQualityGate,
  evaluateVenueFidelity,
  requireGatePassed,
  sha256,
} from '../../creative/creative-truth.js';
import type {
  LocalCreativeComposerCommandRunner,
  OfficialBrandAssetInput,
} from './local-creative-composer.js';

const execFileAsync = promisify(execFile);

export const SUNSET_STORY_STANDARD_ID = 'SUNSET_STORY_V1' as const;
export const SUNSET_STORY_STANDARD_VERSION = '1.2' as const;
export const SUNSET_STORY_REQUIRED_BRANDS = [
  'TOCA_DO_MORCEGO',
  'CORONA',
  'RED_BULL',
  'MORRO_DIGITAL',
] as const;
export const SUNSET_STORY_REQUIRED_BRAND_ASSET_IDS = [
  'BRAND-TOCA-WHITE-V1',
  'BRAND-CORONA-WHITE-V1',
  'BRAND-REDBULL-WHITE-V1',
  'BRAND-MORRO-WHITE-V1',
] as const;

export type SunsetStoryTemplateClass =
  | 'SUNSET_HERO_LIFESTYLE'
  | 'SUNSET_VIEW_SCENERY'
  | 'SUNSET_SOCIAL_EXPERIENCE'
  | 'SUNSET_DRINKS_EXPERIENCE'
  | 'SUNSET_INFO_HOURS';

interface SunsetStoryLayout {
  readonly headline: readonly [left: number, top: number, width: number, height: number, pointSize: number];
  readonly support: readonly [left: number, top: number, width: number, height: number];
  readonly cta: readonly [left: number, top: number, width: number];
  readonly functionalInfoTop: number;
}

const LAYOUTS: Readonly<Record<SunsetStoryTemplateClass, SunsetStoryLayout>> = {
  SUNSET_HERO_LIFESTYLE: {
    headline: [74, 250, 910, 390, 108],
    support: [74, 720, 500, 150],
    cta: [74, 920, 430],
    functionalInfoTop: 130,
  },
  SUNSET_VIEW_SCENERY: {
    headline: [90, 500, 900, 410, 112],
    support: [90, 930, 620, 150],
    cta: [90, 1110, 430],
    functionalInfoTop: 180,
  },
  SUNSET_SOCIAL_EXPERIENCE: {
    headline: [90, 1010, 860, 330, 96],
    support: [70, 250, 620, 160],
    cta: [300, 900, 480],
    functionalInfoTop: 150,
  },
  SUNSET_DRINKS_EXPERIENCE: {
    headline: [90, 1080, 900, 330, 92],
    support: [90, 900, 620, 145],
    cta: [260, 1410, 560],
    functionalInfoTop: 150,
  },
  SUNSET_INFO_HOURS: {
    headline: [60, 315, 960, 520, 138],
    support: [90, 930, 640, 150],
    cta: [250, 1240, 580],
    functionalInfoTop: 140,
  },
};

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;
const SIDE_MARGIN = 90;
const FOOTER_TOP = 1680;
const FOOTER_BOTTOM = 1830;
const FOOTER_SLOT_WIDTH = 225;
const FOOTER_SLOT_HEIGHT = 118;
const FOOTER_SLOT_TOP = 1700;
const FOOTER_SLOT_LEFTS = [45, 270, 495, 720] as const;
const HEADLINE_FONT = 'DejaVu-Serif';
const SANS_FONT = 'DejaVu-Sans';

export interface LocalSunsetStoryComposeInput {
  readonly contentItemId: string;
  readonly creativeId: string;
  readonly standard: CreativeStandard;
  readonly creativeMode: CreativeMode;
  readonly venueAsset: VenueAsset;
  readonly sourceImageBytes: Uint8Array;
  readonly sourceContentType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly enhancementProvenance?: CreativeEnhancementProvenance;
  readonly templateClass: SunsetStoryTemplateClass;
  readonly headline?: string;
  readonly supportCopy?: string;
  readonly cta?: string;
  readonly functionalInfo?: string;
  readonly requiredBrands: readonly string[];
  readonly brandAssets: readonly OfficialBrandAssetInput[];
  readonly fidelityEvidence?: FidelityEvidence;
  readonly createdAt?: string;
}

export interface LocalSunsetStoryComposeResult {
  readonly outputBytes: Uint8Array;
  readonly outputContentType: 'image/jpeg';
  readonly outputSha256: string;
  readonly dimensions: '1080x1920';
  readonly manifest: DeterministicRenderManifest;
  readonly provider: 'LOCAL_IMAGEMAGICK';
  readonly pipelineVersion: 'local-sunset-story-renderer-v1';
  readonly readyForReview: true;
}

export class LocalSunsetStoryRenderer {
  constructor(
    private readonly commandRunner: LocalCreativeComposerCommandRunner = defaultCommandRunner,
    private readonly binary = process.env.IMAGE_MAGICK_CONVERT_BINARY?.trim() || 'convert',
  ) {}

  async compose(input: LocalSunsetStoryComposeInput): Promise<LocalSunsetStoryComposeResult> {
    validateInput(input);
    assertCreativeStandard(input.standard);
    assertSourceBinding(input);

    const orderedBrandAssets = resolveRequiredBrandAssets(input.brandAssets);
    const brandGate = evaluateBrandIntegrity(
      SUNSET_STORY_REQUIRED_BRANDS,
      orderedBrandAssets.map((entry) => ({
        asset: entry.registry,
        observedDriveFileId: entry.driveFileId,
        observedSha256: sha256(entry.bytes),
        ...(entry.aiGenerated === true ? { aiGenerated: true } : {}),
      })),
    );
    requireGatePassed(brandGate);

    const venueGate = evaluateVenueFidelity({
      contentItemId: input.contentItemId,
      creativeMode: input.creativeMode,
      venueAsset: input.venueAsset,
      ...(input.fidelityEvidence ? { evidence: input.fidelityEvidence } : {}),
      candidateSha256: sha256(input.sourceImageBytes),
      nowIso: input.createdAt ?? new Date().toISOString(),
    });
    requireGatePassed(venueGate);

    const workspace = await mkdtemp(join(tmpdir(), 'toca-sunset-story-'));
    const sourcePath = join(workspace, `source${extensionFor(input.sourceContentType)}`);
    const outputPath = join(workspace, 'sunset-story.jpg');
    const logoPaths = new Map<string, string>();

    try {
      await writeFile(sourcePath, input.sourceImageBytes);
      for (const [index, entry] of orderedBrandAssets.entries()) {
        const logoPath = join(workspace, `brand-${index}${extensionFor(entry.contentType)}`);
        await writeFile(logoPath, entry.bytes);
        logoPaths.set(entry.registry.brandAssetId, logoPath);
      }

      await this.commandRunner(
        this.binary,
        buildSunsetStoryArgs(input, sourcePath, outputPath, logoPaths),
      );
      const outputBytes = await readFile(outputPath);
      const qualityGate = evaluateQualityGate(outputBytes.byteLength > 0 && isJpeg(outputBytes), {
        dimensions: '1080x1920',
        outputContentType: 'image/jpeg',
        deterministicComposition: true,
        dedicatedRenderer: 'SUNSET_STORY_V1',
        rendererVersion: 'local-sunset-story-renderer-v1',
        standardVersion: SUNSET_STORY_STANDARD_VERSION,
        templateClass: input.templateClass,
        headlineFont: HEADLINE_FONT,
        supportFont: SANS_FONT,
        sideMarginPx: SIDE_MARGIN,
        requiredBrandOrder: [...SUNSET_STORY_REQUIRED_BRANDS],
        requiredBrandAssetIds: [...SUNSET_STORY_REQUIRED_BRAND_ASSET_IDS],
        brandFooterTopPx: FOOTER_TOP,
        brandFooterBottomPx: FOOTER_BOTTOM,
        sourceMasterHashVerified: true,
        enhancementProvenanceVerified: input.creativeMode === 'REAL_PLUS_ENHANCEMENT',
        visualStandardApplied: input.standard.standardId,
      });
      requireGatePassed(qualityGate);

      const outputSha256 = sha256(outputBytes);
      const manifest: DeterministicRenderManifest = {
        contentItemId: input.contentItemId,
        creativeId: input.creativeId,
        policyId: TOCA_CREATIVE_TRUTH_POLICY_ID,
        standardId: SUNSET_STORY_STANDARD_ID,
        creativeMode: input.creativeMode,
        sourceAssetIds: [input.venueAsset.sourceAssetId],
        masterAssetIds: [input.venueAsset.masterAssetId!],
        brandAssetIds: orderedBrandAssets.map((entry) => entry.registry.brandAssetId),
        ...(input.enhancementProvenance
          ? { enhancementProvenance: input.enhancementProvenance }
          : {}),
        outputSha256,
        outputDimensions: '1080x1920',
        exactAssetBinding: true,
        gates: [brandGate, venueGate, qualityGate],
        createdAt: input.createdAt ?? new Date().toISOString(),
      };

      return {
        outputBytes,
        outputContentType: 'image/jpeg',
        outputSha256,
        dimensions: '1080x1920',
        manifest,
        provider: 'LOCAL_IMAGEMAGICK',
        pipelineVersion: 'local-sunset-story-renderer-v1',
        readyForReview: true,
      };
    } catch (error) {
      if (error instanceof ExecutionError) throw error;
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        throw new ExecutionError(
          'CAPABILITY_UNAVAILABLE',
          `LOCAL_SUNSET_STORY_RENDERER_BINARY_UNAVAILABLE:${this.binary}`,
          false,
        );
      }
      throw new ExecutionError(
        'PROVIDER_UNAVAILABLE',
        `LOCAL_SUNSET_STORY_RENDERER_FAILED:${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

export function buildSunsetStoryArgs(
  input: LocalSunsetStoryComposeInput,
  sourcePath: string,
  outputPath: string,
  logoPaths: ReadonlyMap<string, string>,
): string[] {
  const layout = LAYOUTS[input.templateClass];
  const args: string[] = [
    sourcePath,
    '-auto-orient',
    '-colorspace',
    'sRGB',
    '-filter',
    'Lanczos',
    '-resize',
    `${CANVAS_WIDTH}x${CANVAS_HEIGHT}^`,
    '-gravity',
    'center',
    '-extent',
    `${CANVAS_WIDTH}x${CANVAS_HEIGHT}`,
    '-fill',
    'rgba(0,0,0,0.10)',
    '-draw',
    `rectangle 0,0 ${CANVAS_WIDTH},${CANVAS_HEIGHT}`,
    '-fill',
    'rgba(0,0,0,0.46)',
    '-draw',
    `rectangle 0,1600 ${CANVAS_WIDTH},${CANVAS_HEIGHT}`,
  ];

  pushFunctionalInfo(args, input, layout);
  pushHeadline(args, input, layout);
  pushSupportCopy(args, input, layout);
  pushCta(args, input, layout);
  pushMandatoryFooter(args, logoPaths);
  args.push('-quality', '95', '-define', 'jpeg:dct-method=float', outputPath);
  return args;
}

function pushFunctionalInfo(
  args: string[],
  input: LocalSunsetStoryComposeInput,
  layout: SunsetStoryLayout,
): void {
  if (!input.functionalInfo?.trim()) return;
  const width = Math.min(520, Math.max(330, input.functionalInfo.trim().length * 19 + 70));
  const left = Math.round((CANVAS_WIDTH - width) / 2);
  const top = layout.functionalInfoTop;
  args.push(
    '-stroke',
    '#FFFFFF',
    '-strokewidth',
    '1',
    '-fill',
    '#E65A00',
    '-draw',
    `rectangle ${left},${top} ${left + width},${top + 72}`,
    '-stroke',
    'none',
    '-fill',
    '#FFFFFF',
    '-font',
    SANS_FONT,
    '-pointsize',
    '34',
    '-gravity',
    'north',
    '-annotate',
    `+0+${top + 49}`,
    input.functionalInfo.trim(),
  );
}

function pushHeadline(
  args: string[],
  input: LocalSunsetStoryComposeInput,
  layout: SunsetStoryLayout,
): void {
  if (!input.headline?.trim()) return;
  const [left, top, width, height, pointSize] = layout.headline;
  args.push(
    '(',
    '-size',
    `${width}x${height}`,
    '-background',
    'none',
    '-font',
    HEADLINE_FONT,
    '-fill',
    '#FFFFFF',
    '-pointsize',
    String(pointSize),
    '-gravity',
    input.templateClass === 'SUNSET_INFO_HOURS' ? 'center' : 'northwest',
    `caption:${input.headline.trim()}`,
    ')',
    '-gravity',
    'northwest',
    '-geometry',
    `+${left}+${top}`,
    '-composite',
  );
}

function pushSupportCopy(
  args: string[],
  input: LocalSunsetStoryComposeInput,
  layout: SunsetStoryLayout,
): void {
  if (!input.supportCopy?.trim()) return;
  const [left, top, width, height] = layout.support;
  args.push(
    '-fill',
    'rgba(255,255,255,0.88)',
    '-draw',
    `rectangle ${left},${top} ${left + width},${top + height}`,
    '(',
    '-size',
    `${width - 44}x${height - 26}`,
    '-background',
    'none',
    '-font',
    SANS_FONT,
    '-fill',
    '#3A1C0F',
    '-pointsize',
    '32',
    `caption:${input.supportCopy.trim()}`,
    ')',
    '-gravity',
    'northwest',
    '-geometry',
    `+${left + 22}+${top + 13}`,
    '-composite',
  );
}

function pushCta(
  args: string[],
  input: LocalSunsetStoryComposeInput,
  layout: SunsetStoryLayout,
): void {
  if (!input.cta?.trim()) return;
  const [left, top, width] = layout.cta;
  args.push(
    '-stroke',
    '#FFFFFF',
    '-strokewidth',
    '2',
    '-fill',
    'rgba(0,0,0,0.16)',
    '-draw',
    `rectangle ${left},${top} ${left + width},${top + 82}`,
    '-stroke',
    'none',
    '-fill',
    '#FFFFFF',
    '-font',
    SANS_FONT,
    '-pointsize',
    '34',
    '-gravity',
    'northwest',
    '-annotate',
    `+${left + 28}+${top + 53}`,
    input.cta.trim(),
  );
}

function pushMandatoryFooter(
  args: string[],
  logoPaths: ReadonlyMap<string, string>,
): void {
  const maxSizes = [
    [135, 112],
    [180, 92],
    [180, 92],
    [170, 86],
  ] as const;

  for (const [index, assetId] of SUNSET_STORY_REQUIRED_BRAND_ASSET_IDS.entries()) {
    const logoPath = logoPaths.get(assetId);
    if (!logoPath) {
      throw new ExecutionError('POLICY_DENIED', 'FAILED_BRAND_ASSET_MISSING', false);
    }
    const [maxWidth, maxHeight] = maxSizes[index]!;
    args.push(
      '(',
      logoPath,
      '-resize',
      `${maxWidth}x${maxHeight}>`,
      '-background',
      'none',
      '-gravity',
      'center',
      '-extent',
      `${FOOTER_SLOT_WIDTH}x${FOOTER_SLOT_HEIGHT}`,
      ')',
      '-gravity',
      'northwest',
      '-geometry',
      `+${FOOTER_SLOT_LEFTS[index]}+${FOOTER_SLOT_TOP}`,
      '-composite',
    );
  }
}

function validateInput(input: LocalSunsetStoryComposeInput): void {
  if (
    input.standard.standardId !== SUNSET_STORY_STANDARD_ID ||
    input.standard.version !== SUNSET_STORY_STANDARD_VERSION ||
    input.standard.operation !== 'SUNSET' ||
    input.standard.channel !== 'INSTAGRAM' ||
    !input.standard.format.toUpperCase().includes('STOR')
  ) {
    throw new ExecutionError('POLICY_DENIED', 'FAILED_STANDARD_NOT_RESOLVED', false);
  }
  if (input.creativeMode === 'GENERATIVE_EXCEPTION') {
    throw new ExecutionError('POLICY_DENIED', 'FAILED_STANDARD_NOT_RESOLVED', false);
  }
  if (input.sourceImageBytes.byteLength === 0) {
    throw new ExecutionError('SOURCE_IMAGE_BINDING_FAILURE', 'FAILED_LINEAGE_MISSING', false);
  }
  if ((input.headline?.trim().length ?? 0) > 90) {
    throw new ExecutionError('QUALITY_GATE_FAILED', 'CREATIVE_HEADLINE_INVALID', false);
  }
  if ((input.supportCopy?.trim().length ?? 0) > 160 || (input.cta?.trim().length ?? 0) > 60) {
    throw new ExecutionError('QUALITY_GATE_FAILED', 'CREATIVE_COPY_TOO_LONG', false);
  }
  const callerBrands = [...new Set(input.requiredBrands)];
  if (
    callerBrands.length !== SUNSET_STORY_REQUIRED_BRANDS.length ||
    SUNSET_STORY_REQUIRED_BRANDS.some((brand) => !callerBrands.includes(brand))
  ) {
    throw new ExecutionError('POLICY_DENIED', 'FAILED_BRAND_ASSET_MISSING', false);
  }
}

function resolveRequiredBrandAssets(
  brandAssets: readonly OfficialBrandAssetInput[],
): OfficialBrandAssetInput[] {
  return SUNSET_STORY_REQUIRED_BRAND_ASSET_IDS.map((assetId, index) => {
    const expectedBrand = SUNSET_STORY_REQUIRED_BRANDS[index]!;
    const matches = brandAssets.filter(
      (entry) =>
        entry.registry.brandAssetId === assetId &&
        entry.registry.brand === expectedBrand &&
        entry.registry.variant === 'WHITE',
    );
    if (matches.length !== 1) {
      throw new ExecutionError('POLICY_DENIED', 'FAILED_BRAND_ASSET_MISSING', false);
    }
    return matches[0]!;
  });
}

function assertSourceBinding(input: LocalSunsetStoryComposeInput): void {
  const venue = input.venueAsset;
  if (
    venue.operation !== 'SUNSET' ||
    !venue.venueVerified ||
    !venue.marketingReady ||
    !venue.masterAssetId ||
    !venue.masterDriveFileId ||
    !venue.masterSha256
  ) {
    throw new ExecutionError('SOURCE_IMAGE_BINDING_FAILURE', 'FAILED_LINEAGE_MISSING', false);
  }

  if (input.creativeMode === 'REAL_COMPOSITE') {
    if (sha256(input.sourceImageBytes) !== venue.masterSha256) {
      throw new ExecutionError(
        'SOURCE_IMAGE_BINDING_FAILURE',
        'CREATIVE_MASTER_HASH_MISMATCH',
        false,
      );
    }
    return;
  }

  if (input.creativeMode !== 'REAL_PLUS_ENHANCEMENT') {
    throw new ExecutionError('POLICY_DENIED', 'FAILED_STANDARD_NOT_RESOLVED', false);
  }
  const parsed = creativeEnhancementProvenanceSchema.safeParse(input.enhancementProvenance);
  if (!parsed.success) {
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'FAILED_ENHANCEMENT_PROVENANCE',
      false,
    );
  }
  const provenance = parsed.data;
  if (
    provenance.policyId !== TOCA_CREATIVE_TRUTH_POLICY_ID ||
    provenance.creativeMode !== 'REAL_PLUS_ENHANCEMENT' ||
    provenance.sourceAssetId !== venue.masterAssetId ||
    provenance.sourceDriveFileId !== venue.masterDriveFileId ||
    provenance.sourceSha256 !== venue.masterSha256 ||
    provenance.outputSha256 !== sha256(input.sourceImageBytes)
  ) {
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'FAILED_ENHANCEMENT_PROVENANCE',
      false,
    );
  }
}

async function defaultCommandRunner(command: string, args: readonly string[]): Promise<void> {
  await execFileAsync(command, [...args], { maxBuffer: 2 * 1024 * 1024 });
}

function extensionFor(contentType: 'image/jpeg' | 'image/png' | 'image/webp'): string {
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/webp') return '.webp';
  return '.jpg';
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}
