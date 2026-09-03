import { createHash } from 'node:crypto';
import { ExecutionError } from '../../core/errors.js';
import type { SecretReference, SecretResolver } from '../../core/secrets.js';
import type {
  SceneContinuationVideoRequest,
  SceneContinuationVideoResult,
} from '../openai/openai-scene-continuation-video-provider.js';

const SUPPORTED_MODELS = new Set(['veo-3.1-generate-001', 'veo-3.1-fast-generate-001']);
const SUPPORTED_DURATIONS = new Set([4, 8]);

export interface VertexVeoSceneContinuationVideoProviderOptions {
  readonly projectId: string;
  readonly artifactBucket: string;
  readonly accessTokenResolver: SecretResolver;
  readonly accessTokenReference: SecretReference;
  readonly location?: string;
  readonly model?: 'veo-3.1-generate-001' | 'veo-3.1-fast-generate-001';
  readonly fetchImpl?: typeof fetch;
  readonly pollIntervalMs?: number;
  readonly maxPolls?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => Date;
}

interface VertexOperationPayload {
  readonly name?: unknown;
  readonly done?: unknown;
  readonly error?: unknown;
  readonly response?: unknown;
}

export class VertexVeoSceneContinuationVideoProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly location: string;
  private readonly model: 'veo-3.1-generate-001' | 'veo-3.1-fast-generate-001';
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(private readonly options: VertexVeoSceneContinuationVideoProviderOptions) {
    if (!options.projectId.trim() || !options.artifactBucket.trim()) {
      throw new Error('VERTEX_VEO_CONFIG_REQUIRED');
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.location = options.location?.trim() || 'us-central1';
    this.model = options.model ?? 'veo-3.1-generate-001';
    this.pollIntervalMs = options.pollIntervalMs ?? 15_000;
    this.maxPolls = options.maxPolls ?? 80;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => new Date());
    if (!SUPPORTED_MODELS.has(this.model)) throw new Error('VERTEX_VEO_MODEL_UNSUPPORTED');
  }

  async generate(request: SceneContinuationVideoRequest): Promise<SceneContinuationVideoResult> {
    validateRequest(request, trustedNow(this.now));
    if (!SUPPORTED_DURATIONS.has(request.seconds)) {
      throw new ExecutionError(
        'OUTPUT_TECH_SPEC_MISMATCH',
        `VERTEX_VEO_DURATION_UNSUPPORTED:${request.seconds}`,
        false,
      );
    }
    if (request.size !== '720x1280') {
      throw new ExecutionError(
        'OUTPUT_TECH_SPEC_MISMATCH',
        `VERTEX_VEO_SIZE_UNSUPPORTED:${request.size}`,
        false,
      );
    }
    if (request.source.contentType === 'image/webp') {
      throw new ExecutionError(
        'OUTPUT_TECH_SPEC_MISMATCH',
        'VERTEX_VEO_INPUT_WEBP_UNSUPPORTED',
        false,
      );
    }

    const token = await this.options.accessTokenResolver.resolve(this.options.accessTokenReference);
    const modelEndpoint = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(this.options.projectId)}/locations/${encodeURIComponent(this.location)}/publishers/google/models/${encodeURIComponent(this.model)}`;
    const storagePrefix = `gs://${this.options.artifactBucket}/video-generative/veo/${safeSegment(request.contentItemId)}/${request.source.sha256.slice(0, 16)}/`;
    const createResponse = await this.fetchImpl(`${modelEndpoint}:predictLongRunning`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        instances: [
          {
            prompt: buildPrompt(request),
            image: {
              bytesBase64Encoded: Buffer.from(request.source.bytes).toString('base64'),
              mimeType: request.source.contentType,
            },
          },
        ],
        parameters: {
          aspectRatio: '9:16',
          durationSeconds: request.seconds,
          storageUri: storagePrefix,
          sampleCount: 1,
          resizeMode: 'crop',
          resolution: '720p',
          personGeneration: 'allow_adult',
        },
      }),
    });
    const created = await readJson(createResponse, 'CREATE');
    const operationName = nonEmptyString(created.name, 'VERTEX_VEO_OPERATION_NAME_MISSING');

    let completed: VertexOperationPayload | undefined;
    for (let attempt = 0; attempt < this.maxPolls; attempt += 1) {
      const response = await this.fetchImpl(`${modelEndpoint}:fetchPredictOperation`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ operationName }),
      });
      const operation = await readJson(response, 'POLL');
      if (operation.done === true) {
        if (operation.error) {
          throw new ExecutionError(
            'PROVIDER_UNAVAILABLE',
            `VERTEX_VEO_OPERATION_FAILED:${safeJson(operation.error)}`,
            false,
          );
        }
        completed = operation;
        break;
      }
      if (attempt + 1 < this.maxPolls) await this.sleep(this.pollIntervalMs);
    }
    if (!completed) {
      throw new ExecutionError('PROVIDER_UNAVAILABLE', 'VERTEX_VEO_OPERATION_TIMEOUT', true);
    }

    const gcsUri = extractVideoGcsUri(completed.response);
    const objectName = parseExpectedGcsUri(gcsUri, this.options.artifactBucket);
    const mediaUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.options.artifactBucket)}/o/${encodeURIComponent(objectName)}?alt=media`;
    const mediaResponse = await this.fetchImpl(mediaUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!mediaResponse.ok) {
      throw providerHttpError(
        mediaResponse.status,
        `DOWNLOAD:${(await safeText(mediaResponse)).slice(0, 400)}`,
      );
    }
    const outputBytes = new Uint8Array(await mediaResponse.arrayBuffer());
    if (!isMp4(outputBytes)) {
      throw new ExecutionError(
        'OUTPUT_TECH_SPEC_MISMATCH',
        'VERTEX_VEO_OUTPUT_INVALID_MP4',
        false,
      );
    }

    return {
      outputBytes,
      outputContentType: 'video/mp4',
      outputSha256: sha256(outputBytes),
      provider: 'GOOGLE_VERTEX_VEO',
      providerJobId: operationName,
      providerModel: this.model,
      requiresPostGenerationHumanReview: true,
      requiresSceneContinuationFidelityGate: true,
    };
  }
}

function validateRequest(request: SceneContinuationVideoRequest, now: Date): void {
  const approval = request.approval;
  if (
    !request.contentItemId.trim() ||
    !request.sourceAssetId.trim() ||
    !request.productId.trim() ||
    !request.operation.trim() ||
    !request.inheritedVisualStandardId.trim() ||
    !request.prompt.trim() ||
    request.source.bytes.byteLength === 0 ||
    approval.status !== 'APPROVED' ||
    approval.contentItemId !== request.contentItemId ||
    approval.sourceAssetId !== request.sourceAssetId ||
    approval.productId !== request.productId ||
    approval.operation !== request.operation ||
    approval.sourceSha256.toLowerCase() !== request.source.sha256.toLowerCase() ||
    !approval.allowSceneContinuation ||
    approval.allowArchitecturalInvention ||
    approval.allowAiLogoGeneration
  ) {
    throw new ExecutionError(
      'APPROVAL_REQUIRED',
      'VIDEO_SCENE_CONTINUATION_REQUEST_NOT_APPROVED',
      false,
    );
  }
  if (approval.expiresAt) {
    const expiry = Date.parse(approval.expiresAt);
    if (!Number.isFinite(expiry) || now.getTime() >= expiry) {
      throw new ExecutionError(
        'APPROVAL_REQUIRED',
        'VIDEO_SCENE_CONTINUATION_APPROVAL_EXPIRED',
        false,
      );
    }
  }
}

function trustedNow(now: () => Date): Date {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new ExecutionError('POLICY_DENIED', 'VERTEX_VEO_TRUSTED_CLOCK_INVALID', false);
  }
  return value;
}

function buildPrompt(request: SceneContinuationVideoRequest): string {
  const environment = request.thePartyEnvironment
    ? ` Canonical The Party environment: ${request.thePartyEnvironment}.`
    : '';
  const edition = request.thePartyEditionId
    ? ` Canonical edition_id: ${request.thePartyEditionId}.`
    : '';
  const expansion = request.approval.allowEnvironmentExpansion
    ? 'Controlled environment expansion was explicitly approved, but newly visible geometry must remain plausible and source-consistent; never invent signature architecture.'
    : 'Do not reveal or invent unseen architecture or venue areas. Constrain camera movement to spatial facts supported by the source image.';
  return [
    'Create a short vertical promotional video by continuing the supplied source photograph in time.',
    'Treat the source photograph as the factual visual anchor. Preserve the same venue, people, products, materials, perspective and lighting context.',
    expansion,
    'Do not generate, redraw, repair, morph, translate or replace any logo, brand mark, written text, sign, sponsor mark or factual venue label. Deterministic branding is applied later.',
    'Do not transform the venue into a generic nightclub, beach club, rooftop, arena or any other place.',
    `Product/operation: ${request.productId}/${request.operation}. Inherited canonical visual standard: ${request.inheritedVisualStandardId}.${environment}${edition}`,
    `Creative direction: ${request.prompt.trim()}`,
    'Prefer physically plausible subject, light and camera motion. Preserve human identity and avoid sudden scene cuts or newly invented people.',
  ].join(' ');
}

async function readJson(response: Response, operation: string): Promise<VertexOperationPayload> {
  if (!response.ok) {
    const detail = (await safeText(response)).slice(0, 400);
    throw providerHttpError(response.status, `${operation}:${detail}`);
  }
  return (await response.json()) as VertexOperationPayload;
}

function extractVideoGcsUri(response: unknown): string {
  if (!response || typeof response !== 'object') {
    throw new ExecutionError('PROVIDER_UNAVAILABLE', 'VERTEX_VEO_RESPONSE_MISSING', false);
  }
  const value = response as {
    generatedVideos?: unknown;
    videos?: unknown;
    generatedSamples?: unknown;
    raiMediaFilteredCount?: unknown;
  };
  if (Array.isArray(value.generatedVideos)) {
    const first = value.generatedVideos[0] as
      | { video?: { uri?: unknown; gcsUri?: unknown; mimeType?: unknown } }
      | undefined;
    const candidate = first?.video?.uri ?? first?.video?.gcsUri;
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  if (Array.isArray(value.videos)) {
    const first = value.videos[0] as { gcsUri?: unknown; mimeType?: unknown } | undefined;
    if (first?.mimeType === 'video/mp4' && typeof first.gcsUri === 'string' && first.gcsUri.trim()) {
      return first.gcsUri.trim();
    }
  }
  if (Array.isArray(value.generatedSamples)) {
    const first = value.generatedSamples[0] as
      | { video?: { gcsUri?: unknown; uri?: unknown; mimeType?: unknown } }
      | undefined;
    const candidate = first?.video?.gcsUri ?? first?.video?.uri;
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  if (typeof value.raiMediaFilteredCount === 'number' && value.raiMediaFilteredCount > 0) {
    throw new ExecutionError('POLICY_DENIED', 'VERTEX_VEO_OUTPUT_FILTERED', false);
  }
  throw new ExecutionError('PROVIDER_UNAVAILABLE', 'VERTEX_VEO_OUTPUT_URI_MISSING', false);
}

function parseExpectedGcsUri(uri: string, bucket: string): string {
  const prefix = `gs://${bucket}/`;
  if (!uri.startsWith(prefix)) {
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'VERTEX_VEO_OUTPUT_BUCKET_MISMATCH',
      false,
    );
  }
  const objectName = uri.slice(prefix.length);
  if (!objectName || objectName.includes('..')) {
    throw new ExecutionError('SOURCE_IMAGE_BINDING_FAILURE', 'VERTEX_VEO_OUTPUT_URI_INVALID', false);
  }
  return objectName;
}

function providerHttpError(status: number, detail: string): ExecutionError {
  return new ExecutionError(
    status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_UNAVAILABLE',
    `VERTEX_VEO_SCENE_CONTINUATION_FAILED:${status}:${detail}`,
    status === 429 || status >= 500,
  );
}

function nonEmptyString(value: unknown, error: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ExecutionError('PROVIDER_UNAVAILABLE', error, false);
  }
  return value.trim();
}

function safeSegment(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, '-');
  if (!normalized) throw new ExecutionError('POLICY_DENIED', 'VERTEX_VEO_CONTENT_ID_INVALID', false);
  return normalized.slice(0, 128);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 400);
  } catch {
    return 'unserializable-error';
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isMp4(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp';
}
