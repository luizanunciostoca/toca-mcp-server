import * as z from 'zod/v4';
import {
  buildCanonicalSunsetStoryRenderPlan,
  type SunsetStoryAiRenderPlannerPort,
  type SunsetStoryAiRenderPlannerRequest,
  type SunsetStoryRenderPlan,
} from '../../creative/sunset-story-render-plan.js';
import type { SunsetStoryTemplateId } from '../../creative/sunset-story-template-registry.js';

const DEFAULT_METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

export interface VertexGeminiAccessTokenProvider {
  getAccessToken(): Promise<string>;
}

export interface GcpMetadataAccessTokenProviderOptions {
  readonly fetchImpl?: typeof fetch;
  readonly metadataTokenUrl?: string;
}

export class GcpMetadataAccessTokenProvider implements VertexGeminiAccessTokenProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly metadataTokenUrl: string;

  constructor(options: GcpMetadataAccessTokenProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.metadataTokenUrl = options.metadataTokenUrl ?? DEFAULT_METADATA_TOKEN_URL;
  }

  async getAccessToken(): Promise<string> {
    const response = await this.fetchImpl(this.metadataTokenUrl, {
      headers: { 'Metadata-Flavor': 'Google' },
    });
    if (!response.ok) throw new Error(`VERTEX_METADATA_TOKEN_FAILED:${response.status}`);
    const payload = (await response.json()) as { access_token?: unknown };
    if (typeof payload.access_token !== 'string' || payload.access_token.length === 0) {
      throw new Error('VERTEX_METADATA_TOKEN_MISSING');
    }
    return payload.access_token;
  }
}

const scaleAdjustmentSchema = z.object({
  id: z.string().min(1),
  scale: z.number(),
});

const localDarkeningSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  opacity: z.number(),
  featherPx: z.number(),
});

const plannerResponseSchema = z.object({
  fontScales: z.array(scaleAdjustmentSchema).max(64).default([]),
  assetScales: z.array(scaleAdjustmentSchema).max(32).default([]),
  localDarkening: z.array(localDarkeningSchema).max(8).default([]),
});

type PlannerResponse = z.infer<typeof plannerResponseSchema>;

const visualQaResponseSchema = z.object({
  layoutSimilarity: z.number().min(0).max(1),
  typographySimilarity: z.number().min(0).max(1),
  brandIntegrity: z.number().min(0).max(1),
  blockingReasons: z.array(z.string().min(1)).max(20).default([]),
});

export interface VertexGeminiSunsetStoryOptions {
  readonly projectId: string;
  readonly location?: string;
  readonly model?: string;
  readonly accessTokenProvider?: VertexGeminiAccessTokenProvider;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

interface VertexGenerateContentResponse {
  readonly candidates?: readonly {
    readonly content?: {
      readonly parts?: readonly { readonly text?: unknown }[];
    };
  }[];
  readonly promptFeedback?: {
    readonly blockReason?: unknown;
    readonly blockReasonMessage?: unknown;
  };
}

function endpoint(location: string, projectId: string, model: string): string {
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
}

function jsonSchemaForPlanner(): Readonly<Record<string, unknown>> {
  return {
    type: 'OBJECT',
    properties: {
      fontScales: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { id: { type: 'STRING' }, scale: { type: 'NUMBER' } },
          required: ['id', 'scale'],
        },
      },
      assetScales: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { id: { type: 'STRING' }, scale: { type: 'NUMBER' } },
          required: ['id', 'scale'],
        },
      },
      localDarkening: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            x: { type: 'NUMBER' },
            y: { type: 'NUMBER' },
            width: { type: 'NUMBER' },
            height: { type: 'NUMBER' },
            opacity: { type: 'NUMBER' },
            featherPx: { type: 'NUMBER' },
          },
          required: ['x', 'y', 'width', 'height', 'opacity', 'featherPx'],
        },
      },
    },
    required: ['fontScales', 'assetScales', 'localDarkening'],
  };
}

function jsonSchemaForVisualQa(): Readonly<Record<string, unknown>> {
  return {
    type: 'OBJECT',
    properties: {
      layoutSimilarity: { type: 'NUMBER' },
      typographySimilarity: { type: 'NUMBER' },
      brandIntegrity: { type: 'NUMBER' },
      blockingReasons: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['layoutSimilarity', 'typographySimilarity', 'brandIntegrity', 'blockingReasons'],
  };
}

function imagePart(bytes: Uint8Array, mimeType: 'image/jpeg' | 'image/png'): Record<string, unknown> {
  return {
    inlineData: {
      mimeType,
      data: Buffer.from(bytes).toString('base64'),
    },
  };
}

function responseText(payload: VertexGenerateContentResponse): string {
  const blocked = payload.promptFeedback?.blockReason;
  if (typeof blocked === 'string' && blocked.length > 0) {
    const detail = payload.promptFeedback?.blockReasonMessage;
    throw new Error(
      `VERTEX_GEMINI_BLOCKED:${blocked}:${typeof detail === 'string' ? detail.slice(0, 300) : ''}`,
    );
  }
  const text = payload.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === 'string')?.text;
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('VERTEX_GEMINI_RESPONSE_TEXT_MISSING');
  }
  return text;
}

function adjustmentMap(
  values: readonly { readonly id: string; readonly scale: number }[],
  knownIds: ReadonlySet<string>,
  code: string,
): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  for (const value of values) {
    if (!knownIds.has(value.id)) throw new Error(`${code}_UNKNOWN_ID:${value.id}`);
    if (result.has(value.id)) throw new Error(`${code}_DUPLICATE_ID:${value.id}`);
    result.set(value.id, value.scale);
  }
  return result;
}

function applyPlannerResponse(
  request: SunsetStoryAiRenderPlannerRequest,
  response: PlannerResponse,
): SunsetStoryRenderPlan {
  const base = buildCanonicalSunsetStoryRenderPlan(
    request.canonicalContract,
    request.imageProfile,
    request.cropPlan,
  );
  const fontScales = adjustmentMap(
    response.fontScales,
    new Set(base.texts.map((item) => item.id)),
    'VERTEX_FONT_SCALE',
  );
  const assetScales = adjustmentMap(
    response.assetScales,
    new Set(base.assets.map((item) => item.id)),
    'VERTEX_ASSET_SCALE',
  );
  return {
    ...base,
    texts: base.texts.map((item) => ({ ...item, fontScale: fontScales.get(item.id) ?? 1 })),
    assets: base.assets.map((item) => ({ ...item, opticalScale: assetScales.get(item.id) ?? 1 })),
    localDarkening: response.localDarkening.map((item) => ({
      region: { x: item.x, y: item.y, width: item.width, height: item.height },
      opacity: item.opacity,
      featherPx: item.featherPx,
    })),
  };
}

abstract class VertexGeminiSunsetStoryBase {
  protected readonly fetchImpl: typeof fetch;
  protected readonly location: string;
  protected readonly model: string;
  protected readonly accessTokenProvider: VertexGeminiAccessTokenProvider;
  private readonly timeoutMs: number;

  constructor(protected readonly options: VertexGeminiSunsetStoryOptions) {
    if (!options.projectId.trim()) throw new Error('VERTEX_PROJECT_ID_MISSING');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.location = options.location ?? 'global';
    this.model = options.model ?? 'gemini-2.5-flash';
    this.accessTokenProvider =
      options.accessTokenProvider ?? new GcpMetadataAccessTokenProvider({ fetchImpl: this.fetchImpl });
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  protected async generate(
    parts: readonly Record<string, unknown>[],
    responseSchema: Readonly<Record<string, unknown>>,
  ): Promise<string> {
    const token = await this.accessTokenProvider.getAccessToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(
        endpoint(this.location, this.options.projectId, this.model),
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 4096,
              responseMimeType: 'application/json',
              responseSchema,
            },
          }),
        },
      );
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        throw new Error(`VERTEX_GEMINI_HTTP_${response.status}:${detail}`);
      }
      return responseText((await response.json()) as VertexGenerateContentResponse);
    } finally {
      clearTimeout(timer);
    }
  }
}

export class VertexGeminiSunsetStoryAiPlanner
  extends VertexGeminiSunsetStoryBase
  implements SunsetStoryAiRenderPlannerPort
{
  async plan(request: SunsetStoryAiRenderPlannerRequest): Promise<SunsetStoryRenderPlan> {
    const prompt = [
      'You are a constrained visual composition planner for TOCA OS Sunset Stories.',
      'The approved template contract is immutable. Never rewrite copy, move regions, replace assets, change crop, or invent brand pixels.',
      'Only propose small optical font scales, small official-asset optical scales, and optional local darkening behind text.',
      'Return empty arrays when no adjustment is necessary.',
      `Template: ${request.templateId}`,
      `Intent: ${request.intent}`,
      `Image profile: ${JSON.stringify(request.imageProfile)}`,
      `Crop plan: ${JSON.stringify(request.cropPlan.cropWindow)}`,
      `Texts: ${JSON.stringify(request.canonicalContract.texts)}`,
      `Assets: ${JSON.stringify(request.canonicalContract.assets)}`,
      'Allowed font scale range: 0.90 to 1.08.',
      'Allowed asset scale range: 0.92 to 1.08.',
      'Allowed local darkening opacity: 0 to 0.40. Maximum 8 regions.',
    ].join('\n');
    const parts: Record<string, unknown>[] = [
      { text: prompt },
      imagePart(request.imageProfile.width > 0 ? requestImageBytes(request) : new Uint8Array(), 'image/jpeg'),
    ];
    if (request.referenceImageBytes && request.referenceImageBytes.byteLength > 0) {
      parts.push({ text: 'Approved visual reference:' });
      parts.push(imagePart(request.referenceImageBytes, 'image/jpeg'));
    }
    const raw = await this.generate(parts, jsonSchemaForPlanner());
    return applyPlannerResponse(request, plannerResponseSchema.parse(JSON.parse(raw) as unknown));
  }
}

function requestImageBytes(request: SunsetStoryAiRenderPlannerRequest): Uint8Array {
  const value = (request as SunsetStoryAiRenderPlannerRequest & { readonly sourceImageBytes?: Uint8Array })
    .sourceImageBytes;
  if (!value || value.byteLength === 0) {
    throw new Error('VERTEX_SUNSET_SOURCE_IMAGE_BYTES_MISSING');
  }
  return value;
}

export interface SunsetStoryRasterVisualQaRequest {
  readonly templateId: SunsetStoryTemplateId;
  readonly referenceImageBytes: Uint8Array;
  readonly renderedPngBytes: Uint8Array;
}

export interface SunsetStoryRasterVisualQaResult {
  readonly layoutSimilarity: number;
  readonly typographySimilarity: number;
  readonly brandIntegrity: number;
  readonly blockingReasons: readonly string[];
}

export interface SunsetStoryRasterVisualQaPort {
  evaluate(request: SunsetStoryRasterVisualQaRequest): Promise<SunsetStoryRasterVisualQaResult>;
}

export class VertexGeminiSunsetStoryRasterVisualQa
  extends VertexGeminiSunsetStoryBase
  implements SunsetStoryRasterVisualQaPort
{
  async evaluate(request: SunsetStoryRasterVisualQaRequest): Promise<SunsetStoryRasterVisualQaResult> {
    const parts: Record<string, unknown>[] = [
      {
        text: [
          'Compare the approved Sunset Story reference with the newly rendered candidate.',
          'Judge only template fidelity: element placement, typography hierarchy, fixed copy, and official brand integrity.',
          'The background photo is expected to differ and must not reduce layout similarity by itself.',
          'brandIntegrity must be 1 only when logos appear intact, in the approved order, without reconstruction or deformation.',
          `Template: ${request.templateId}`,
          'First image: approved reference. Second image: rendered candidate.',
        ].join('\n'),
      },
      imagePart(request.referenceImageBytes, 'image/jpeg'),
      imagePart(request.renderedPngBytes, 'image/png'),
    ];
    const raw = await this.generate(parts, jsonSchemaForVisualQa());
    return visualQaResponseSchema.parse(JSON.parse(raw) as unknown);
  }
}
