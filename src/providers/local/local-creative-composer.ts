import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type {
  BrandAsset,
  CreativeEnhancementProvenance,
  CreativeMode,
  CreativeStandard,
  DeterministicRenderManifest,
  FidelityEvidence,
  GenerativeExceptionApproval,
  VenueAsset,
  VenueReference,
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

const execFileAsync = promisify(execFile);

const THE_PARTY_HYBRID_NETWORKS_STANDARD_ID = 'THE_PARTY_HYBRID_NETWORKS_V1';
const THE_PARTY_HYBRID_MINIMALIST_STANDARD_ID = 'THE_PARTY_HYBRID_MINIMALIST_V1';
const THE_PARTY_FOOTER_ORDER = [
  'TOCA_DO_MORCEGO',
  'CORONA',
  'RED_BULL',
  'MORRO_DIGITAL',
] as const;

export type CreativeCanvas = '1080x1350' | '1080x1080' | '1080x1920';
export type ThePartyEnvironment = 'INTERNATIONAL' | 'NATIONAL';

export interface OfficialBrandAssetInput {
  readonly registry: BrandAsset;
  readonly bytes: Uint8Array;
  readonly contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly driveFileId: string;
  readonly aiGenerated?: boolean;
}

export interface LocalCreativeComposeInput {
  readonly contentItemId: string;
  readonly creativeId: string;
  readonly standard: CreativeStandard;
  readonly creativeMode: CreativeMode;
  readonly venueAsset?: VenueAsset;
  readonly sourceImageBytes: Uint8Array;
  readonly sourceContentType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly enhancementProvenance?: CreativeEnhancementProvenance;
  readonly canvas: CreativeCanvas;
  readonly headline?: string;
  readonly supportCopy?: string;
  readonly cta?: string;
  readonly functionalInfo?: string;
  readonly partyEnvironment?: ThePartyEnvironment;
  readonly requiredBrands: readonly string[];
  readonly brandAssets: readonly OfficialBrandAssetInput[];
  readonly generativeException?: GenerativeExceptionApproval;
  readonly references?: readonly VenueReference[];
  readonly fidelityEvidence?: FidelityEvidence;
  readonly createdAt?: string;
}

export interface LocalCreativeComposeResult {
  readonly outputBytes: Uint8Array;
  readonly outputContentType: 'image/jpeg';
  readonly outputSha256: string;
  readonly dimensions: CreativeCanvas;
  readonly manifest: DeterministicRenderManifest;
  readonly provider: 'LOCAL_IMAGEMAGICK';
  readonly pipelineVersion: 'local-creative-composer-v1';
  readonly readyForReview: true;
}

export type LocalCreativeComposerCommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<void>;

export class LocalCreativeComposer {
  constructor(
    private readonly commandRunner: LocalCreativeComposerCommandRunner = defaultCommandRunner,
    private readonly binary = process.env.IMAGE_MAGICK_CONVERT_BINARY?.trim() || 'convert',
  ) {}

  async compose(input: LocalCreativeComposeInput): Promise<LocalCreativeComposeResult> {
    validateInput(input);
    assertCreativeStandard(input.standard);
    assertRealAssetBinding(input);

    const brandGate = evaluateBrandIntegrity(
      input.requiredBrands,
      input.brandAssets.map((entry) => ({
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
      ...(input.venueAsset ? { venueAsset: input.venueAsset } : {}),
      ...(input.generativeException ? { generativeException: input.generativeException } : {}),
      ...(input.references ? { references: input.references } : {}),
      ...(input.fidelityEvidence ? { evidence: input.fidelityEvidence } : {}),
      candidateSha256: sha256(input.sourceImageBytes),
      nowIso: input.createdAt ?? new Date().toISOString(),
    });
    requireGatePassed(venueGate);

    const workspace = await mkdtemp(join(tmpdir(), 'toca-creative-composer-'));
    const sourcePath = join(workspace, `source${extensionFor(input.sourceContentType)}`);
    const outputPath = join(workspace, 'creative.jpg');
    const logoPaths = new Map<string, string>();

    try {
      await writeFile(sourcePath, input.sourceImageBytes);
      for (const [index, entry] of input.brandAssets.entries()) {
        const path = join(workspace, `brand-${index}${extensionFor(entry.contentType)}`);
        await writeFile(path, entry.bytes);
        logoPaths.set(entry.registry.brandAssetId, path);
      }

      await this.commandRunner(
        this.binary,
        buildImageMagickArgs(input, sourcePath, outputPath, logoPaths),
      );
      const outputBytes = await readFile(outputPath);
      const validOutput = outputBytes.byteLength > 0 && isJpeg(outputBytes);
      const qualityGate = evaluateQualityGate(validOutput, {
        dimensions: input.canvas,
        outputContentType: 'image/jpeg',
        deterministicComposition: true,
        sourceMasterHashVerified: input.creativeMode === 'GENERATIVE_EXCEPTION' ? false : true,
        enhancementProvenanceVerified: input.creativeMode === 'REAL_PLUS_ENHANCEMENT',
        visualStandardApplied: input.standard.standardId,
        ...(isThePartyStandard(input.standard.standardId)
          ? { thePartyEnvironment: input.partyEnvironment ?? 'MINIMALIST_NEUTRAL' }
          : {}),
      });
      requireGatePassed(qualityGate);

      const outputSha256 = sha256(outputBytes);
      const createdAt = input.createdAt ?? new Date().toISOString();
      const manifest: DeterministicRenderManifest = {
        contentItemId: input.contentItemId,
        creativeId: input.creativeId,
        policyId: TOCA_CREATIVE_TRUTH_POLICY_ID,
        standardId: input.standard.standardId,
        creativeMode: input.creativeMode,
        sourceAssetIds: sourceAssetIdsFor(input),
        masterAssetIds: input.venueAsset?.masterAssetId ? [input.venueAsset.masterAssetId] : [],
        brandAssetIds: input.brandAssets.map((entry) => entry.registry.brandAssetId),
        ...(input.enhancementProvenance
          ? { enhancementProvenance: input.enhancementProvenance }
          : {}),
        outputSha256,
        outputDimensions: input.canvas,
        exactAssetBinding: true,
        gates: [brandGate, venueGate, qualityGate],
        createdAt,
      };

      return {
        outputBytes,
        outputContentType: 'image/jpeg',
        outputSha256,
        dimensions: input.canvas,
        manifest,
        provider: 'LOCAL_IMAGEMAGICK',
        pipelineVersion: 'local-creative-composer-v1',
        readyForReview: true,
      };
    } catch (error) {
      if (error instanceof ExecutionError) throw error;
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        throw new ExecutionError(
          'CAPABILITY_UNAVAILABLE',
          `LOCAL_CREATIVE_COMPOSER_BINARY_UNAVAILABLE:${this.binary}`,
          false,
        );
      }
      throw new ExecutionError(
        'PROVIDER_UNAVAILABLE',
        `LOCAL_CREATIVE_COMPOSER_FAILED:${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

function buildImageMagickArgs(
  input: LocalCreativeComposeInput,
  sourcePath: string,
  outputPath: string,
  logoPaths: ReadonlyMap<string, string>,
): string[] {
  if (input.standard.standardId === THE_PARTY_HYBRID_NETWORKS_STANDARD_ID) {
    return buildThePartyArgs(input, sourcePath, outputPath, logoPaths, 'NETWORKS');
  }
  if (input.standard.standardId === THE_PARTY_HYBRID_MINIMALIST_STANDARD_ID) {
    return buildThePartyArgs(input, sourcePath, outputPath, logoPaths, 'MINIMALIST');
  }
  return buildDefaultArgs(input, sourcePath, outputPath, logoPaths);
}

function buildDefaultArgs(
  input: LocalCreativeComposeInput,
  sourcePath: string,
  outputPath: string,
  logoPaths: ReadonlyMap<string, string>,
): string[] {
  const [width, height] = input.canvas.split('x');
  const w = Number(width);
  const h = Number(height);
  const footerHeight = Math.round(h * 0.17);
  const footerTop = h - footerHeight;
  const side = Math.round(w * 0.07);
  const textWidth = Math.round(w * 0.72);
  const args: string[] = [
    sourcePath,
    '-auto-orient',
    '-colorspace',
    'sRGB',
    '-filter',
    'Lanczos',
    '-resize',
    `${w}x${h}^`,
    '-gravity',
    'center',
    '-extent',
    `${w}x${h}`,
    '-fill',
    'rgba(0,0,0,0.28)',
    '-draw',
    `rectangle 0,0 ${w},${h}`,
    '-fill',
    'rgba(121,48,0,0.58)',
    '-draw',
    `rectangle 0,${footerTop} ${w},${h}`,
  ];

  pushHeadline(args, input, side, Math.round(h * 0.12), textWidth, h, 'white');
  pushSupport(args, input, side, Math.round(h * 0.41), w, h, 'white');
  pushCta(args, input, side, Math.round(h * 0.56), w, 'white', 'rgba(0,0,0,0.22)');
  pushFunctionalInfo(args, input, side, Math.round(h * 0.65), w, h);
  pushFooterBrands(args, input, logoPaths, THE_PARTY_FOOTER_ORDER, side, w, footerTop, footerHeight);

  args.push('-quality', '95', '-define', 'jpeg:dct-method=float', outputPath);
  return args;
}

function buildThePartyArgs(
  input: LocalCreativeComposeInput,
  sourcePath: string,
  outputPath: string,
  logoPaths: ReadonlyMap<string, string>,
  family: 'NETWORKS' | 'MINIMALIST',
): string[] {
  const [width, height] = input.canvas.split('x');
  const w = Number(width);
  const h = Number(height);
  const side = Math.round(w * 0.08);
  const footerHeight = Math.round(h * 0.12);
  const footerTop = h - footerHeight;
  const isStory = input.canvas === '1080x1920';
  const heroLogoWidth = Math.round(w * (isStory ? 0.42 : 0.34));
  const heroLogoTop = Math.round(h * (isStory ? 0.045 : 0.035));
  const textTop = Math.round(h * (isStory ? 0.27 : 0.23));
  const accent = resolvePartyAccent(input.partyEnvironment, family);
  const backgroundOverlay = family === 'MINIMALIST' ? 'rgba(7,7,9,0.34)' : 'rgba(7,7,9,0.22)';
  const footerOverlay = family === 'MINIMALIST' ? 'rgba(7,7,9,0.82)' : 'rgba(7,7,9,0.76)';
  const supportBox = family === 'MINIMALIST' ? 'rgba(247,244,239,0.90)' : 'rgba(7,7,9,0.62)';
  const supportText = family === 'MINIMALIST' ? '#070709' : '#F7F4EF';
  const textWidth = Math.round(w * (family === 'MINIMALIST' ? 0.70 : 0.76));

  const args: string[] = [
    sourcePath,
    '-auto-orient',
    '-colorspace',
    'sRGB',
    '-filter',
    'Lanczos',
    '-resize',
    `${w}x${h}^`,
    '-gravity',
    'center',
    '-extent',
    `${w}x${h}`,
    '-fill',
    backgroundOverlay,
    '-draw',
    `rectangle 0,0 ${w},${h}`,
  ];

  if (family === 'NETWORKS') {
    args.push(
      '-fill',
      accent.overlay,
      '-draw',
      `rectangle 0,0 ${Math.round(w * 0.018)},${h}`,
      '-fill',
      accent.glow,
      '-draw',
      `rectangle 0,0 ${w},${Math.round(h * 0.035)}`,
    );
  }

  const heroLogo = input.brandAssets.find((entry) => entry.registry.brand === 'THE_PARTY');
  const heroLogoPath = heroLogo ? logoPaths.get(heroLogo.registry.brandAssetId) : undefined;
  if (heroLogoPath) {
    args.push(
      '(',
      heroLogoPath,
      '-resize',
      `${heroLogoWidth}x>`,
      ')',
      '-gravity',
      'north',
      '-geometry',
      `+0+${heroLogoTop}`,
      '-composite',
    );
  }

  if (input.functionalInfo?.trim()) {
    const infoWidth = Math.round(w * (family === 'MINIMALIST' ? 0.34 : 0.40));
    const infoHeight = Math.round(h * 0.045);
    const infoLeft = Math.round((w - infoWidth) / 2);
    const infoTop = Math.round(h * (isStory ? 0.19 : 0.16));
    args.push(
      '-stroke',
      accent.line,
      '-strokewidth',
      '2',
      '-fill',
      'rgba(7,7,9,0.64)',
      '-draw',
      `roundrectangle ${infoLeft},${infoTop} ${infoLeft + infoWidth},${infoTop + infoHeight} 8,8`,
      '-stroke',
      'none',
      '-fill',
      '#F7F4EF',
      '-font',
      'DejaVu-Sans',
      '-pointsize',
      isStory ? '30' : '26',
      '-gravity',
      'north',
      '-annotate',
      `+0+${infoTop + Math.round(infoHeight * 0.70)}`,
      input.functionalInfo.trim(),
    );
  }

  pushHeadline(args, input, side, textTop, textWidth, h, '#F7F4EF');

  if (input.supportCopy?.trim()) {
    const supportTop = Math.round(h * (isStory ? 0.53 : 0.50));
    const boxWidth = Math.round(w * (family === 'MINIMALIST' ? 0.68 : 0.74));
    const boxHeight = Math.round(h * (family === 'MINIMALIST' ? 0.105 : 0.12));
    args.push(
      '-fill',
      supportBox,
      '-draw',
      `roundrectangle ${side},${supportTop} ${side + boxWidth},${supportTop + boxHeight} 8,8`,
      '(',
      '-size',
      `${boxWidth - 48}x${boxHeight - 20}`,
      '-background',
      'none',
      '-font',
      'DejaVu-Sans',
      '-fill',
      supportText,
      '-pointsize',
      isStory ? '31' : '27',
      `caption:${input.supportCopy.trim()}`,
      ')',
      '-gravity',
      'northwest',
      '-geometry',
      `+${side + 24}+${supportTop + 12}`,
      '-composite',
    );
  }

  pushCta(
    args,
    input,
    side,
    Math.round(h * (isStory ? 0.69 : 0.67)),
    w,
    accent.line,
    'rgba(7,7,9,0.54)',
  );

  args.push(
    '-fill',
    footerOverlay,
    '-draw',
    `rectangle 0,${footerTop} ${w},${h}`,
  );
  pushFooterBrands(
    args,
    input,
    logoPaths,
    THE_PARTY_FOOTER_ORDER,
    side,
    w,
    footerTop,
    footerHeight,
  );

  args.push('-quality', '95', '-define', 'jpeg:dct-method=float', outputPath);
  return args;
}

function resolvePartyAccent(
  environment: ThePartyEnvironment | undefined,
  family: 'NETWORKS' | 'MINIMALIST',
): { readonly line: string; readonly overlay: string; readonly glow: string } {
  if (family === 'MINIMALIST') {
    return {
      line: '#C7AA75',
      overlay: 'rgba(199,170,117,0.72)',
      glow: 'rgba(199,170,117,0.22)',
    };
  }
  if (environment === 'INTERNATIONAL') {
    return {
      line: '#8F5AB7',
      overlay: 'rgba(76,53,83,0.82)',
      glow: 'rgba(143,90,183,0.28)',
    };
  }
  return {
    line: '#C7AA75',
    overlay: 'rgba(161,72,22,0.82)',
    glow: 'rgba(199,170,117,0.26)',
  };
}

function pushHeadline(
  args: string[],
  input: LocalCreativeComposeInput,
  left: number,
  top: number,
  width: number,
  height: number,
  fill: string,
): void {
  if (!input.headline?.trim()) return;
  args.push(
    '(',
    '-size',
    `${width}x${Math.round(height * 0.24)}`,
    '-background',
    'none',
    '-font',
    'DejaVu-Serif',
    '-fill',
    fill,
    '-pointsize',
    input.canvas === '1080x1080' ? '62' : '72',
    `caption:${input.headline.trim()}`,
    ')',
    '-gravity',
    'northwest',
    '-geometry',
    `+${left}+${top}`,
    '-composite',
  );
}

function pushSupport(
  args: string[],
  input: LocalCreativeComposeInput,
  left: number,
  top: number,
  width: number,
  height: number,
  fill: string,
): void {
  if (!input.supportCopy?.trim()) return;
  args.push(
    '(',
    '-size',
    `${Math.round(width * 0.68)}x${Math.round(height * 0.12)}`,
    '-background',
    'none',
    '-font',
    'DejaVu-Sans',
    '-fill',
    fill,
    '-pointsize',
    '34',
    `caption:${input.supportCopy.trim()}`,
    ')',
    '-gravity',
    'northwest',
    '-geometry',
    `+${left}+${top}`,
    '-composite',
  );
}

function pushCta(
  args: string[],
  input: LocalCreativeComposeInput,
  left: number,
  top: number,
  width: number,
  stroke: string,
  fill: string,
): void {
  if (!input.cta?.trim()) return;
  const right = Math.round(width * 0.67);
  args.push(
    '-stroke',
    stroke,
    '-strokewidth',
    '2',
    '-fill',
    fill,
    '-draw',
    `roundrectangle ${left},${top} ${right},${top + 86} 8,8`,
    '-stroke',
    'none',
    '-fill',
    '#F7F4EF',
    '-font',
    'DejaVu-Sans',
    '-pointsize',
    '34',
    '-gravity',
    'northwest',
    '-annotate',
    `+${left + 28}+${top + 54}`,
    input.cta.trim(),
  );
}

function pushFunctionalInfo(
  args: string[],
  input: LocalCreativeComposeInput,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  if (!input.functionalInfo?.trim()) return;
  args.push(
    '-fill',
    'rgba(0,0,0,0.48)',
    '-draw',
    `roundrectangle ${left},${top} ${Math.round(width * 0.58)},${top + 74} 8,8`,
    '-fill',
    'white',
    '-font',
    'DejaVu-Sans',
    '-pointsize',
    '30',
    '-gravity',
    'northwest',
    '-annotate',
    `+${left + 24}+${top + Math.round(height * 0.025)}`,
    input.functionalInfo.trim(),
  );
}

function pushFooterBrands(
  args: string[],
  input: LocalCreativeComposeInput,
  logoPaths: ReadonlyMap<string, string>,
  canonicalOrder: readonly string[],
  side: number,
  width: number,
  footerTop: number,
  footerHeight: number,
): void {
  const footerBrands = canonicalOrder
    .map((brand) => input.brandAssets.find((entry) => entry.registry.brand === brand))
    .filter((entry): entry is OfficialBrandAssetInput => entry !== undefined);
  if (footerBrands.length === 0) return;
  const slotWidth = Math.floor((width - side * 2) / footerBrands.length);
  for (const [index, entry] of footerBrands.entries()) {
    const logoPath = logoPaths.get(entry.registry.brandAssetId);
    if (!logoPath) continue;
    const x = side + index * slotWidth + Math.round(slotWidth * 0.1);
    const y = footerTop + Math.round(footerHeight * 0.25);
    args.push(
      '(',
      logoPath,
      '-resize',
      `${Math.round(slotWidth * 0.78)}x${Math.round(footerHeight * 0.5)}>`,
      ')',
      '-gravity',
      'northwest',
      '-geometry',
      `+${x}+${y}`,
      '-composite',
    );
  }
}

function validateInput(input: LocalCreativeComposeInput): void {
  if (!input.contentItemId.trim() || !input.creativeId.trim()) {
    throw new ExecutionError('SOURCE_IMAGE_BINDING_FAILURE', 'CREATIVE_LINEAGE_REQUIRED', false);
  }
  if (input.sourceImageBytes.byteLength === 0) {
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'CREATIVE_SOURCE_IMAGE_BYTES_REQUIRED',
      false,
    );
  }
  if (input.creativeMode !== 'GENERATIVE_EXCEPTION' && !input.venueAsset) {
    throw new ExecutionError('POLICY_DENIED', 'FAILED_NO_VENUE_VERIFIED_ASSET', false);
  }
  if (input.creativeMode === 'REAL_PLUS_ENHANCEMENT' && !input.enhancementProvenance) {
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'FAILED_ENHANCEMENT_PROVENANCE',
      false,
    );
  }
  if (input.creativeMode !== 'REAL_PLUS_ENHANCEMENT' && input.enhancementProvenance) {
    throw new ExecutionError('POLICY_DENIED', 'FAILED_ENHANCEMENT_PROVENANCE', false);
  }
  if (
    input.creativeMode === 'GENERATIVE_EXCEPTION' &&
    (!input.generativeException || (input.references?.length ?? 0) === 0)
  ) {
    throw new ExecutionError('APPROVAL_REQUIRED', 'FAILED_GENERATIVE_REFERENCE_MISSING', false);
  }
  if ((input.headline?.trim().length ?? 0) > 90) {
    throw new ExecutionError('QUALITY_GATE_FAILED', 'CREATIVE_HEADLINE_INVALID', false);
  }
  if ((input.supportCopy?.trim().length ?? 0) > 160 || (input.cta?.trim().length ?? 0) > 60) {
    throw new ExecutionError('QUALITY_GATE_FAILED', 'CREATIVE_COPY_TOO_LONG', false);
  }
  if (input.requiredBrands.length === 0) {
    throw new ExecutionError('POLICY_DENIED', 'FAILED_BRAND_ASSET_MISSING', false);
  }
  if (isThePartyStandard(input.standard.standardId)) {
    if (input.standard.operation !== 'THE_PARTY' || !input.requiredBrands.includes('THE_PARTY')) {
      throw new ExecutionError('POLICY_DENIED', 'FAILED_STANDARD_NOT_RESOLVED', false);
    }
    if (
      input.standard.standardId === THE_PARTY_HYBRID_NETWORKS_STANDARD_ID &&
      !input.partyEnvironment
    ) {
      throw new ExecutionError('POLICY_DENIED', 'THE_PARTY_ENVIRONMENT_REQUIRED', false);
    }
  }
}

function assertRealAssetBinding(input: LocalCreativeComposeInput): void {
  if (input.creativeMode === 'GENERATIVE_EXCEPTION') return;
  const venue = input.venueAsset;
  if (!venue?.masterAssetId || !venue.masterDriveFileId || !venue.masterSha256) {
    throw new ExecutionError('SOURCE_IMAGE_BINDING_FAILURE', 'FAILED_LINEAGE_MISSING', false);
  }
  if (input.standard.operation !== 'ALL' && venue.operation !== input.standard.operation) {
    throw new ExecutionError('POLICY_DENIED', 'FAILED_STANDARD_NOT_RESOLVED', false);
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

function isThePartyStandard(standardId: string): boolean {
  return (
    standardId === THE_PARTY_HYBRID_NETWORKS_STANDARD_ID ||
    standardId === THE_PARTY_HYBRID_MINIMALIST_STANDARD_ID
  );
}

function sourceAssetIdsFor(input: LocalCreativeComposeInput): string[] {
  if (input.venueAsset) return [input.venueAsset.sourceAssetId];
  const referenceIds = [...new Set((input.references ?? []).map((reference) => reference.assetId))];
  if (referenceIds.length === 0) {
    throw new ExecutionError('SOURCE_IMAGE_BINDING_FAILURE', 'FAILED_LINEAGE_MISSING', false);
  }
  return referenceIds;
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
