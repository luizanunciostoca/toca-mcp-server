import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ExecutionError } from '../../core/errors.js';
import {
  evaluateSunsetStoryTemplateGate,
  getSunsetStoryTemplate,
  type SunsetFooterMode,
  type SunsetStoryElement,
  type SunsetStoryTemplatePlan,
  type SunsetTemplateId,
} from '../../creative/sunset-story-template-engine.js';
import type { CreativeTruthGateResult } from '../../contracts/creative-truth.js';

const execFileAsync = promisify(execFile);
const DEFAULT_HEADLINE_FONT =
  process.env.TOCA_SUNSET_HEADLINE_FONT?.trim() ||
  join(process.cwd(), 'assets/fonts/BodoniModa-Variable.ttf');
const DEFAULT_SANS_FONT =
  process.env.TOCA_SUNSET_FUNCTIONAL_FONT?.trim() ||
  join(process.cwd(), 'assets/fonts/Montserrat-Variable.ttf');

export type LegacyStoryTemplateId = 'PHOTO_ONLY' | 'EDITORIAL_TEXT' | 'EVENT_CTA';
export type StoryTemplateId = LegacyStoryTemplateId | SunsetTemplateId;

export interface StoryBrandAssetInput {
  readonly brand: string;
  readonly bytes: Uint8Array;
  readonly contentType?: 'image/png' | 'image/jpeg' | 'image/webp';
}

export interface LocalStoryComposeInput {
  readonly storyCreativeId: string;
  readonly contentItemId: string;
  readonly masterAssetId: string;
  readonly masterDriveFileId: string;
  readonly imageBytes: Uint8Array;
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly templateId: StoryTemplateId;
  readonly templatePlan?: SunsetStoryTemplatePlan;
  readonly message?: string;
  readonly cta?: string;
  readonly brandLabel?: string;
  readonly brandAssets?: readonly StoryBrandAssetInput[];
}

export interface LocalStoryComposeResult {
  readonly storyCreativeId: string;
  readonly contentItemId: string;
  readonly masterAssetId: string;
  readonly masterDriveFileId: string;
  readonly masterSha256: string;
  readonly outputSha256: string;
  readonly sourceImageBound: true;
  readonly editorProvider: 'LOCAL_IMAGEMAGICK';
  readonly pipelineVersion: 'local-story-composer-v1' | 'local-story-composer-v2-pure-template';
  readonly dimensions: '1080x1920';
  readonly aspectRatio: '9:16';
  readonly templateId: StoryTemplateId;
  readonly outputContentType: 'image/jpeg';
  readonly outputBytes: Uint8Array;
  readonly storyReady: true;
  readonly templateGate?: CreativeTruthGateResult;
}

export type LocalStoryComposerCommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<void>;

export class LocalStoryComposer {
  constructor(
    private readonly commandRunner: LocalStoryComposerCommandRunner = defaultCommandRunner,
    private readonly binary = process.env.IMAGE_MAGICK_CONVERT_BINARY?.trim() || 'convert',
  ) {}

  async compose(input: LocalStoryComposeInput): Promise<LocalStoryComposeResult> {
    validateInput(input);
    const pureTemplate = isPureTemplateId(input.templateId);
    const templateGate = pureTemplate
      ? evaluateSunsetStoryTemplateGate(input.templatePlan as SunsetStoryTemplatePlan)
      : undefined;
    if (templateGate) requireTemplateGatePassed(templateGate);

    const workspace = await mkdtemp(join(tmpdir(), 'toca-story-composer-'));
    const sourcePath = join(workspace, `master${extensionFor(input.contentType)}`);
    const outputPath = join(workspace, 'story.jpg');
    const logoPaths = new Map<string, string>();
    try {
      await writeFile(sourcePath, input.imageBytes);
      for (const [index, asset] of (input.brandAssets ?? []).entries()) {
        const path = join(
          workspace,
          `brand-${index}${extensionFor(asset.contentType ?? 'image/png')}`,
        );
        await writeFile(path, asset.bytes);
        logoPaths.set(asset.brand, path);
      }

      await this.commandRunner(
        this.binary,
        pureTemplate
          ? buildPureTemplateCommandArgs(input, sourcePath, outputPath, logoPaths)
          : buildLegacyCommandArgs(input, sourcePath, outputPath),
      );
      const outputBytes = await readFile(outputPath);
      if (outputBytes.byteLength === 0 || !isJpeg(outputBytes)) {
        throw new ExecutionError(
          'QUALITY_GATE_FAILED',
          'LOCAL_STORY_COMPOSER_OUTPUT_INVALID',
          false,
        );
      }
      return {
        storyCreativeId: input.storyCreativeId,
        contentItemId: input.contentItemId,
        masterAssetId: input.masterAssetId,
        masterDriveFileId: input.masterDriveFileId,
        masterSha256: sha256(input.imageBytes),
        outputSha256: sha256(outputBytes),
        sourceImageBound: true,
        editorProvider: 'LOCAL_IMAGEMAGICK',
        pipelineVersion: pureTemplate
          ? 'local-story-composer-v2-pure-template'
          : 'local-story-composer-v1',
        dimensions: '1080x1920',
        aspectRatio: '9:16',
        templateId: input.templateId,
        outputContentType: 'image/jpeg',
        outputBytes,
        storyReady: true,
        ...(templateGate ? { templateGate } : {}),
      };
    } catch (error) {
      if (error instanceof ExecutionError) throw error;
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        throw new ExecutionError(
          'CAPABILITY_UNAVAILABLE',
          `LOCAL_STORY_COMPOSER_BINARY_UNAVAILABLE:${this.binary}`,
          false,
        );
      }
      throw new ExecutionError(
        'PROVIDER_UNAVAILABLE',
        `LOCAL_STORY_COMPOSER_FAILED:${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

function buildPureTemplateCommandArgs(
  input: LocalStoryComposeInput,
  sourcePath: string,
  outputPath: string,
  logoPaths: ReadonlyMap<string, string>,
): string[] {
  const plan = input.templatePlan as SunsetStoryTemplatePlan;
  const descriptor = getSunsetStoryTemplate(plan.templateId);
  const args: string[] = [
    sourcePath,
    '-auto-orient',
    '-colorspace',
    'sRGB',
    '-filter',
    'Lanczos',
    '-resize',
    '1080x1920^',
    '-gravity',
    'center',
    '-extent',
    '1080x1920',
  ];

  const orangeElement = plan.elements.find((element) => element.kind === 'ORANGE_LOWER_THIRD');
  if (plan.backgroundTreatment === 'ORANGE_LOWER_THIRD' && orangeElement) {
    const region = regionFor(plan, orangeElement.regionId);
    args.push(
      '-fill',
      'rgba(255,122,0,0.92)',
      '-draw',
      `rectangle ${region.x},${region.y} ${region.x + region.width},${region.y + region.height}`,
    );
  } else if (plan.backgroundTreatment === 'LOCAL_DARKENING') {
    const footer = regionForOptional(plan, 'footer');
    const y = footer?.y ?? 1640;
    args.push('-fill', 'rgba(0,0,0,0.30)', '-draw', `rectangle 0,${y} 1080,1920`);
  }

  for (const element of plan.elements) {
    if (!descriptor.allowedElements.includes(element.kind)) {
      throw new ExecutionError('QUALITY_GATE_FAILED', 'FAILED_TEMPLATE_ELEMENT_NOT_ALLOWED', false);
    }
    const region = regionFor(plan, element.regionId);
    appendPureElement(args, element, region, logoPaths, plan.footerMode);
  }

  args.push('-quality', '95', '-define', 'jpeg:dct-method=float', outputPath);
  return args;
}

function appendPureElement(
  args: string[],
  element: SunsetStoryElement,
  region: { x: number; y: number; width: number; height: number },
  logoPaths: ReadonlyMap<string, string>,
  footerMode: SunsetFooterMode,
): void {
  const text = element.text?.trim() ?? '';
  if (element.kind === 'ORANGE_LOWER_THIRD') {
    args.push(
      '-fill',
      'rgba(255,122,0,0.92)',
      '-draw',
      `rectangle ${region.x},${region.y} ${region.x + region.width},${region.y + region.height}`,
    );
    return;
  }
  if (element.kind === 'TOCA_TOP_SIGNATURE') {
    appendLogo(args, logoPaths.get('TOCA_DO_MORCEGO'), region);
    return;
  }
  if (element.kind === 'FOUR_LOGO_FOOTER' || element.kind === 'REDUCED_FOOTER') {
    const brands =
      element.kind === 'FOUR_LOGO_FOOTER' || footerMode === 'FOUR_LOGOS_WHITE'
        ? ['TOCA_DO_MORCEGO', 'CORONA', 'RED_BULL', 'MORRO_DIGITAL']
        : ['CORONA', 'RED_BULL', 'MORRO_DIGITAL'];
    const slotWidth = Math.floor(region.width / brands.length);
    brands.forEach((brand, index) => {
      const logo = logoPaths.get(brand);
      if (!logo)
        throw new ExecutionError('QUALITY_GATE_FAILED', 'FAILED_BRAND_ASSET_MISSING', false);
      appendLogo(args, logo, {
        x: region.x + index * slotWidth,
        y: region.y,
        width: slotWidth,
        height: region.height,
      });
    });
    return;
  }
  if (!text)
    throw new ExecutionError(
      'QUALITY_GATE_FAILED',
      'FAILED_TEMPLATE_REQUIRED_ELEMENT_MISSING',
      false,
    );

  const font = fontFor(element.fontRole);
  const pointSize = element.fontSizePx ?? (element.kind === 'HEADLINE' ? 72 : 32);
  const fill = colorFor(element.textColor ?? 'WHITE');
  if (element.kind === 'SUPPORT_STRIP') {
    args.push(
      '-fill',
      'rgba(255,255,255,0.94)',
      '-draw',
      `rectangle ${region.x},${region.y} ${region.x + region.width},${region.y + region.height}`,
    );
  } else if (element.kind === 'CTA_OUTLINE') {
    args.push(
      '-stroke',
      'white',
      '-strokewidth',
      '2',
      '-fill',
      'rgba(0,0,0,0.08)',
      '-draw',
      `rectangle ${region.x},${region.y} ${region.x + region.width},${region.y + region.height}`,
      '-stroke',
      'none',
    );
  } else if (element.kind === 'TIME_BADGE') {
    args.push(
      '-fill',
      'rgba(255,122,0,0.96)',
      '-draw',
      `rectangle ${region.x},${region.y} ${region.x + region.width},${region.y + region.height}`,
    );
  }

  args.push(
    '(',
    '-size',
    `${region.width}x${region.height}`,
    '-background',
    'none',
    '-font',
    font,
    '-fill',
    fill,
    '-pointsize',
    String(pointSize),
    `caption:${text}`,
    ')',
    '-gravity',
    'northwest',
    '-geometry',
    `+${region.x}+${region.y}`,
    '-composite',
  );
}

function appendLogo(
  args: string[],
  logoPath: string | undefined,
  region: { x: number; y: number; width: number; height: number },
): void {
  if (!logoPath)
    throw new ExecutionError('QUALITY_GATE_FAILED', 'FAILED_BRAND_ASSET_MISSING', false);
  args.push(
    '(',
    logoPath,
    '-resize',
    `${Math.max(1, Math.round(region.width * 0.82))}x${Math.max(1, Math.round(region.height * 0.78))}>`,
    ')',
    '-gravity',
    'northwest',
    '-geometry',
    `+${region.x + Math.round(region.width * 0.09)}+${region.y + Math.round(region.height * 0.11)}`,
    '-composite',
  );
}

function regionFor(
  plan: SunsetStoryTemplatePlan,
  regionId: string,
): { x: number; y: number; width: number; height: number } {
  const region = plan.safeRegions.find((candidate) => candidate.regionId === regionId);
  if (region) return region;
  if (regionId === 'footer') return { x: 45, y: 1680, width: 990, height: 150 };
  throw new ExecutionError('QUALITY_GATE_FAILED', 'FAILED_TEMPLATE_SAFE_REGION_INVALID', false);
}

function regionForOptional(
  plan: SunsetStoryTemplatePlan,
  regionId: string,
): { x: number; y: number; width: number; height: number } | undefined {
  return plan.safeRegions.find((candidate) => candidate.regionId === regionId);
}

function fontFor(role: SunsetStoryElement['fontRole']): string {
  if (role === 'HEADLINE_SERIF') return DEFAULT_HEADLINE_FONT;
  return DEFAULT_SANS_FONT;
}

function colorFor(color: NonNullable<SunsetStoryElement['textColor']>): string {
  if (color === 'BLACK') return 'rgb(20,16,12)';
  if (color === 'ORANGE') return 'rgb(255,122,0)';
  if (color === 'DARK_BROWN') return 'rgb(91,63,42)';
  return 'white';
}

function requireTemplateGatePassed(gate: CreativeTruthGateResult): void {
  if (gate.status === 'PASSED') return;
  throw new ExecutionError(
    'QUALITY_GATE_FAILED',
    gate.failureCodes[0] ?? 'FAILED_QUALITY_GATE',
    false,
  );
}

function isPureTemplateId(templateId: StoryTemplateId): templateId is SunsetTemplateId {
  return templateId.startsWith('SUNSET_REF_');
}

function buildLegacyCommandArgs(
  input: LocalStoryComposeInput,
  sourcePath: string,
  outputPath: string,
): string[] {
  const args = [
    sourcePath,
    '-auto-orient',
    '-colorspace',
    'sRGB',
    '-filter',
    'Lanczos',
    '-resize',
    '1080x1920^',
    '-gravity',
    'center',
    '-extent',
    '1080x1920',
  ];
  if (input.templateId !== 'PHOTO_ONLY') {
    args.push(
      '-fill',
      'rgba(0,0,0,0.48)',
      '-draw',
      'rectangle 0,1250 1080,1920',
      '(',
      '-size',
      '936x250',
      '-background',
      'none',
      '-font',
      'DejaVu-Sans',
      '-fill',
      'white',
      '-pointsize',
      input.templateId === 'EVENT_CTA' ? '56' : '52',
      `caption:${input.message?.trim() ?? ''}`,
      ')',
      '-gravity',
      'southwest',
      '-geometry',
      '+72+250',
      '-composite',
    );
    if (input.cta?.trim())
      args.push(
        '(',
        '-size',
        '936x90',
        '-background',
        'none',
        '-font',
        'DejaVu-Sans',
        '-fill',
        'white',
        '-pointsize',
        '34',
        `caption:${input.cta.trim()}`,
        ')',
        '-gravity',
        'southwest',
        '-geometry',
        '+72+90',
        '-composite',
      );
    args.push(
      '-font',
      'DejaVu-Sans',
      '-fill',
      'white',
      '-gravity',
      'northwest',
      '-pointsize',
      '28',
      '-annotate',
      '+72+72',
      (input.brandLabel?.trim() || 'TOCA DO MORCEGO').toUpperCase(),
    );
  }
  args.push('-quality', '95', '-define', 'jpeg:dct-method=float', outputPath);
  return args;
}

function validateInput(input: LocalStoryComposeInput): void {
  if (
    !input.storyCreativeId.trim() ||
    !input.contentItemId.trim() ||
    !input.masterAssetId.trim() ||
    !input.masterDriveFileId.trim()
  )
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'LOCAL_STORY_COMPOSER_LINEAGE_REQUIRED',
      false,
    );
  if (input.imageBytes.byteLength === 0)
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'LOCAL_STORY_COMPOSER_MASTER_BYTES_REQUIRED',
      false,
    );
  if (isPureTemplateId(input.templateId)) {
    if (!input.templatePlan) {
      throw new ExecutionError('QUALITY_GATE_FAILED', 'FAILED_TEMPLATE_NOT_RESOLVED', false);
    }
    if (input.templatePlan.templateId !== input.templateId) {
      throw new ExecutionError('QUALITY_GATE_FAILED', 'FAILED_TEMPLATE_REFERENCE_MISMATCH', false);
    }
    if ((input.brandAssets?.length ?? 0) === 0) {
      throw new ExecutionError('QUALITY_GATE_FAILED', 'FAILED_BRAND_ASSET_MISSING', false);
    }
    return;
  }
  if (input.templateId !== 'PHOTO_ONLY' && !input.message?.trim())
    throw new ExecutionError('QUALITY_GATE_FAILED', 'LOCAL_STORY_COMPOSER_MESSAGE_REQUIRED', false);
  if ((input.message?.trim().length ?? 0) > 90 || (input.cta?.trim().length ?? 0) > 60)
    throw new ExecutionError('QUALITY_GATE_FAILED', 'LOCAL_STORY_COMPOSER_TEXT_TOO_LONG', false);
}

function extensionFor(
  contentType: StoryBrandAssetInput['contentType'] | LocalStoryComposeInput['contentType'],
): string {
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/webp') return '.webp';
  return '.jpg';
}
function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function isJpeg(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}
async function defaultCommandRunner(command: string, args: readonly string[]): Promise<void> {
  await execFileAsync(command, [...args], { maxBuffer: 1024 * 1024 });
}
