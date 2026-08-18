import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { OperationScopedGenerativeExceptionApproval } from '../../contracts/creative-truth-generative-reference-sets.js';
import type {
  CreativeStandard,
  DeterministicRenderManifest,
  FidelityEvidence,
  VenueReference,
} from '../../contracts/creative-truth.js';
import { TOCA_CREATIVE_TRUTH_POLICY_ID } from '../../contracts/creative-truth.js';
import {
  assertCreativeStandard,
  evaluateBrandIntegrity,
  evaluateQualityGate,
  requireGatePassed,
  sha256,
} from '../../creative/creative-truth.js';
import { evaluateOperationScopedGenerativeFidelity } from '../../creative/operation-scoped-generative-fidelity.js';
import { ExecutionError } from '../../core/errors.js';
import type {
  CreativeCanvas,
  LocalCreativeComposerCommandRunner,
  OfficialBrandAssetInput,
  ThePartyEnvironment,
} from './local-creative-composer.js';

const execFileAsync = promisify(execFile);
const THE_PARTY_NETWORKS = 'THE_PARTY_HYBRID_NETWORKS_V1';
const THE_PARTY_MINIMALIST = 'THE_PARTY_HYBRID_MINIMALIST_V1';
const FOOTER_ORDER = ['TOCA_DO_MORCEGO', 'CORONA', 'RED_BULL', 'MORRO_DIGITAL'] as const;

export interface LocalOperationScopedGenerativeComposeInput {
  readonly contentItemId: string;
  readonly creativeId: string;
  readonly standard: CreativeStandard;
  readonly visualStandard?: CreativeStandard;
  readonly approval: OperationScopedGenerativeExceptionApproval;
  readonly references: readonly VenueReference[];
  readonly fidelityEvidence: FidelityEvidence;
  readonly candidateImageBytes: Uint8Array;
  readonly candidateContentType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly canvas: CreativeCanvas;
  readonly headline?: string;
  readonly supportCopy?: string;
  readonly cta?: string;
  readonly functionalInfo?: string;
  readonly partyEnvironment?: ThePartyEnvironment;
  readonly requiredBrands: readonly string[];
  readonly brandAssets: readonly OfficialBrandAssetInput[];
  readonly createdAt?: string;
}

export interface LocalOperationScopedGenerativeComposeResult {
  readonly outputBytes: Uint8Array;
  readonly outputContentType: 'image/jpeg';
  readonly outputSha256: string;
  readonly dimensions: CreativeCanvas;
  readonly manifest: DeterministicRenderManifest;
  readonly provider: 'LOCAL_IMAGEMAGICK';
  readonly pipelineVersion: 'local-operation-scoped-generative-composer-v1';
  readonly readyForReview: true;
}

export class LocalOperationScopedGenerativeComposer {
  constructor(
    private readonly commandRunner: LocalCreativeComposerCommandRunner = defaultCommandRunner,
    private readonly binary = process.env.IMAGE_MAGICK_CONVERT_BINARY?.trim() || 'convert',
  ) {}

  async compose(
    input: LocalOperationScopedGenerativeComposeInput,
  ): Promise<LocalOperationScopedGenerativeComposeResult> {
    validateInput(input);
    assertCreativeStandard(input.standard);
    const renderStandard = resolveRenderStandard(input);
    assertCreativeStandard(renderStandard);

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

    const candidateSha256 = sha256(input.candidateImageBytes);
    const venueGate = evaluateOperationScopedGenerativeFidelity({
      contentItemId: input.contentItemId,
      operation: input.approval.operation,
      approval: input.approval,
      references: input.references,
      evidence: input.fidelityEvidence,
      candidateSha256,
      nowIso: input.createdAt ?? new Date().toISOString(),
    });
    requireGatePassed(venueGate);

    const workspace = await mkdtemp(join(tmpdir(), 'toca-generative-finalizer-'));
    const sourcePath = join(workspace, `candidate${extensionFor(input.candidateContentType)}`);
    const outputPath = join(workspace, 'creative.jpg');
    const logoPaths = new Map<string, string>();

    try {
      await writeFile(sourcePath, input.candidateImageBytes);
      for (const [index, entry] of input.brandAssets.entries()) {
        const path = join(workspace, `brand-${index}${extensionFor(entry.contentType)}`);
        await writeFile(path, entry.bytes);
        logoPaths.set(entry.registry.brandAssetId, path);
      }

      await this.commandRunner(
        this.binary,
        buildArgs(input, renderStandard, sourcePath, outputPath, logoPaths),
      );
      const outputBytes = await readFile(outputPath);
      const validOutput = outputBytes.byteLength > 0 && isJpeg(outputBytes);
      const qualityGate = evaluateQualityGate(validOutput, {
        dimensions: input.canvas,
        outputContentType: 'image/jpeg',
        deterministicComposition: true,
        sourceMasterHashVerified: false,
        operationScopedGenerativeFidelityVerified: true,
        generativeCandidateSha256: candidateSha256,
        referenceSetId: input.approval.referenceSetId,
        operation: input.approval.operation,
        visualStandardApplied: renderStandard.standardId,
        outputStandardApplied: input.standard.standardId,
      });
      requireGatePassed(qualityGate);

      const outputSha256 = sha256(outputBytes);
      const manifest: DeterministicRenderManifest = {
        contentItemId: input.contentItemId,
        creativeId: input.creativeId,
        policyId: TOCA_CREATIVE_TRUTH_POLICY_ID,
        standardId: input.standard.standardId,
        creativeMode: 'GENERATIVE_EXCEPTION',
        sourceAssetIds: [...new Set(input.references.map((reference) => reference.assetId))],
        masterAssetIds: [],
        brandAssetIds: input.brandAssets.map((entry) => entry.registry.brandAssetId),
        outputSha256,
        outputDimensions: input.canvas,
        exactAssetBinding: true,
        gates: [brandGate, venueGate, qualityGate],
        createdAt: input.createdAt ?? new Date().toISOString(),
      };

      return {
        outputBytes,
        outputContentType: 'image/jpeg',
        outputSha256,
        dimensions: input.canvas,
        manifest,
        provider: 'LOCAL_IMAGEMAGICK',
        pipelineVersion: 'local-operation-scoped-generative-composer-v1',
        readyForReview: true,
      };
    } catch (error) {
      if (error instanceof ExecutionError) throw error;
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        throw new ExecutionError(
          'CAPABILITY_UNAVAILABLE',
          `LOCAL_GENERATIVE_COMPOSER_BINARY_UNAVAILABLE:${this.binary}`,
          false,
        );
      }
      throw new ExecutionError(
        'PROVIDER_UNAVAILABLE',
        `LOCAL_GENERATIVE_COMPOSER_FAILED:${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

function validateInput(input: LocalOperationScopedGenerativeComposeInput): void {
  if (!input.contentItemId.trim() || !input.creativeId.trim()) {
    throw new ExecutionError('SOURCE_IMAGE_BINDING_FAILURE', 'CREATIVE_LINEAGE_REQUIRED', false);
  }
  if (
    input.candidateImageBytes.byteLength === 0 ||
    !hasExpectedImageSignature(input.candidateContentType, input.candidateImageBytes)
  ) {
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'CREATIVE_GENERATIVE_CANDIDATE_BYTES_INVALID',
      false,
    );
  }
  if (input.requiredBrands.length === 0) {
    throw new ExecutionError('POLICY_DENIED', 'FAILED_BRAND_ASSET_MISSING', false);
  }
  if (input.standard.operation !== 'ALL' && input.standard.operation !== input.approval.operation) {
    throw new ExecutionError('POLICY_DENIED', 'FAILED_STANDARD_NOT_RESOLVED', false);
  }
  if ((input.headline?.trim().length ?? 0) > 90) {
    throw new ExecutionError('QUALITY_GATE_FAILED', 'CREATIVE_HEADLINE_INVALID', false);
  }
  if ((input.supportCopy?.trim().length ?? 0) > 160 || (input.cta?.trim().length ?? 0) > 60) {
    throw new ExecutionError('QUALITY_GATE_FAILED', 'CREATIVE_COPY_TOO_LONG', false);
  }
}

function resolveRenderStandard(
  input: LocalOperationScopedGenerativeComposeInput,
): CreativeStandard {
  if (input.standard.operation !== 'ALL') return input.standard;
  const visualStandard = input.visualStandard;
  if (!visualStandard || visualStandard.operation !== input.approval.operation) {
    throw new ExecutionError(
      'POLICY_DENIED',
      'GENERATIVE_OPERATION_SCOPED_VISUAL_STANDARD_REQUIRED',
      false,
    );
  }
  return visualStandard;
}

function buildArgs(
  input: LocalOperationScopedGenerativeComposeInput,
  renderStandard: CreativeStandard,
  sourcePath: string,
  outputPath: string,
  logoPaths: ReadonlyMap<string, string>,
): string[] {
  const [widthText, heightText] = input.canvas.split('x');
  const width = Number(widthText);
  const height = Number(heightText);
  const side = Math.round(width * 0.07);
  const footerHeight = Math.round(height * 0.16);
  const footerTop = height - footerHeight;
  const isParty =
    renderStandard.standardId === THE_PARTY_NETWORKS ||
    renderStandard.standardId === THE_PARTY_MINIMALIST;
  const isNetworks = renderStandard.standardId === THE_PARTY_NETWORKS;
  const overlay = isParty ? 'rgba(7,7,9,0.34)' : 'rgba(80,35,0,0.26)';
  const footer = isParty ? 'rgba(7,7,9,0.82)' : 'rgba(82,35,0,0.62)';
  const accent =
    isNetworks && input.partyEnvironment === 'INTERNATIONAL'
      ? '#8F5AB7'
      : isParty
        ? '#C7AA75'
        : '#FFFFFF';

  const args: string[] = [
    sourcePath,
    '-auto-orient',
    '-colorspace',
    'sRGB',
    '-filter',
    'Lanczos',
    '-resize',
    `${width}x${height}^`,
    '-gravity',
    'center',
    '-extent',
    `${width}x${height}`,
    '-fill',
    overlay,
    '-draw',
    `rectangle 0,0 ${width},${height}`,
  ];

  if (isNetworks) {
    args.push(
      '-fill',
      accent,
      '-draw',
      `rectangle 0,0 ${Math.round(width * 0.018)},${height}`,
    );
  }

  if (isParty) {
    const hero = input.brandAssets.find((entry) => entry.registry.brand === 'THE_PARTY');
    const heroPath = hero ? logoPaths.get(hero.registry.brandAssetId) : undefined;
    if (!heroPath) {
      throw new ExecutionError('POLICY_DENIED', 'FAILED_BRAND_ASSET_MISSING', false);
    }
    args.push(
      '(',
      heroPath,
      '-resize',
      `${Math.round(width * 0.36)}x>`,
      ')',
      '-gravity',
      'north',
      '-geometry',
      `+0+${Math.round(height * 0.05)}`,
      '-composite',
    );
  }

  pushCaption(args, input.headline, 'DejaVu-Serif', 72, side, Math.round(height * 0.25), Math.round(width * 0.76), '#F7F4EF');
  pushCaption(args, input.supportCopy, 'DejaVu-Sans', 32, side, Math.round(height * 0.50), Math.round(width * 0.70), '#F7F4EF');

  if (input.cta?.trim()) {
    const top = Math.round(height * 0.66);
    args.push(
      '-stroke',
      accent,
      '-strokewidth',
      '2',
      '-fill',
      'rgba(7,7,9,0.42)',
      '-draw',
      `roundrectangle ${side},${top} ${Math.round(width * 0.70)},${top + 86} 8,8`,
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
      `+${side + 26}+${top + 54}`,
      input.cta.trim(),
    );
  }

  if (input.functionalInfo?.trim()) {
    args.push(
      '-fill',
      '#F7F4EF',
      '-font',
      'DejaVu-Sans',
      '-pointsize',
      '28',
      '-gravity',
      'northwest',
      '-annotate',
      `+${side}+${Math.round(height * 0.75)}`,
      input.functionalInfo.trim(),
    );
  }

  args.push('-fill', footer, '-draw', `rectangle 0,${footerTop} ${width},${height}`);
  pushFooterBrands(args, input, logoPaths, side, width, footerTop, footerHeight);
  args.push('-quality', '95', '-define', 'jpeg:dct-method=float', outputPath);
  return args;
}

function pushCaption(
  args: string[],
  text: string | undefined,
  font: string,
  pointSize: number,
  left: number,
  top: number,
  width: number,
  fill: string,
): void {
  if (!text?.trim()) return;
  args.push(
    '(',
    '-size',
    `${width}x400`,
    '-background',
    'none',
    '-font',
    font,
    '-fill',
    fill,
    '-pointsize',
    String(pointSize),
    `caption:${text.trim()}`,
    ')',
    '-gravity',
    'northwest',
    '-geometry',
    `+${left}+${top}`,
    '-composite',
  );
}

function pushFooterBrands(
  args: string[],
  input: LocalOperationScopedGenerativeComposeInput,
  logoPaths: ReadonlyMap<string, string>,
  side: number,
  width: number,
  footerTop: number,
  footerHeight: number,
): void {
  const footerBrands = FOOTER_ORDER
    .map((brand) => input.brandAssets.find((entry) => entry.registry.brand === brand))
    .filter((entry): entry is OfficialBrandAssetInput => entry !== undefined);
  if (footerBrands.length === 0) return;
  const slotWidth = Math.floor((width - side * 2) / footerBrands.length);
  for (const [index, entry] of footerBrands.entries()) {
    const logoPath = logoPaths.get(entry.registry.brandAssetId);
    if (!logoPath) continue;
    args.push(
      '(',
      logoPath,
      '-resize',
      `${Math.round(slotWidth * 0.78)}x${Math.round(footerHeight * 0.5)}>`,
      ')',
      '-gravity',
      'northwest',
      '-geometry',
      `+${side + index * slotWidth + Math.round(slotWidth * 0.1)}+${footerTop + Math.round(footerHeight * 0.25)}`,
      '-composite',
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

function hasExpectedImageSignature(
  contentType: 'image/jpeg' | 'image/png' | 'image/webp',
  bytes: Uint8Array,
): boolean {
  if (bytes.byteLength < 4) return false;
  if (contentType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (contentType === 'image/png') {
    return (
      bytes.byteLength >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  return (
    bytes.byteLength >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  );
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}
