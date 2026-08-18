import { createHash } from 'node:crypto';
import type {
  PhotoToVideoDurationSeconds,
  PhotoToVideoSize,
  SceneContinuationApproval,
} from '../../contracts/photo-to-video.js';
import { ExecutionError } from '../../core/errors.js';
import type { SecretReference, SecretResolver } from '../../core/secrets.js';
import type {
  CreativeVideoSourceContentType,
  LoadedCreativeVideoSource,
} from '../google-drive/creative-video-source-loader.js';

const OPENAI_VIDEOS_ENDPOINT = 'https://api.openai.com/v1/videos';
const SUPPORTED_MODELS = new Set(['sora-2', 'sora-2-pro']);

export interface SceneContinuationVideoRequest {
  readonly contentItemId: string;
  readonly operation: string;
  readonly productId: string;
  readonly inheritedVisualStandardId: string;
  readonly source: LoadedCreativeVideoSource;
  readonly approval: SceneContinuationApproval;
  readonly prompt: string;
  readonly seconds: PhotoToVideoDurationSeconds;
  readonly size: PhotoToVideoSize;
  readonly thePartyEnvironment?: string;
  readonly thePartyEditionId?: string;
}

export interface SceneContinuationVideoResult {
  readonly outputBytes: Uint8Array;
  readonly outputContentType: 'video/mp4';
  readonly outputSha256: string;
  readonly provider: 'OPENAI_VIDEO_API';
  readonly providerJobId: string;
  readonly providerModel: 'sora-2' | 'sora-2-pro';
  readonly requiresPostGenerationHumanReview: true;
  readonly requiresSceneContinuationFidelityGate: true;
}

export interface OpenAiSceneContinuationVideoProviderOptions {
  readonly secretResolver: SecretResolver;
  readonly apiKeyReference: SecretReference;
  readonly fetchImpl?: typeof fetch;
  readonly model?: 'sora-2' | 'sora-2-pro';
  readonly pollIntervalMs?: number;
  readonly maxPolls?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => Date;
}

interface VideoJobPayload {
  readonly id?: unknown;
  readonly status?: unknown;
  readonly model?: unknown;
  readonly error?: unknown;
}

export class OpenAiSceneContinuationVideoProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly model: 'sora-2' | 'sora-2-pro';
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(private readonly options: OpenAiSceneContinuationVideoProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.model = options.model ?? 'sora-2';
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.maxPolls = options.maxPolls ?? 180;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => new Date());
    if (!SUPPORTED_MODELS.has(this.model)) throw new Error('OPENAI_VIDEO_MODEL_UNSUPPORTED');
  }

  async generate(request: SceneContinuationVideoRequest): Promise<SceneContinuationVideoResult> {
    validateRequest(request, this.now());
    const apiKey = await this.options.secretResolver.resolve(this.options.apiKeyReference);
    const form = new FormData();
    form.set('model', this.model);
    form.set('prompt', buildPrompt(request));
    form.set('seconds', String(request.seconds));
    form.set('size', request.size);
    const sourceBuffer = Uint8Array.from(request.source.bytes).buffer as ArrayBuffer;
    form.set(
      'input_reference',
      new Blob([sourceBuffer], { type: request.source.contentType }),
      sourceFileName(request.source.contentType),
    );

    const createResponse = await this.fetchImpl(OPENAI_VIDEOS_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const created = await readJobResponse(createResponse, 'CREATE');
    const videoId = asNonEmptyString(created.id, 'OPENAI_VIDEO_JOB_ID_MISSING');

    let completed: VideoJobPayload | undefined;
    for (let attempt = 0; attempt < this.maxPolls; attempt += 1) {
      const response = await this.fetchImpl(`${OPENAI_VIDEOS_ENDPOINT}/${encodeURIComponent(videoId)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const job = await readJobResponse(response, 'RETRIEVE');
      const status = asNonEmptyString(job.status, 'OPENAI_VIDEO_STATUS_MISSING');
      if (status === 'completed') {
        completed = job;
        break;
      }
      if (status === 'failed' || status === 'cancelled') {
        throw new ExecutionError(
          'PROVIDER_UNAVAILABLE',
          `OPENAI_SCENE_CONTINUATION_VIDEO_${status.toUpperCase()}`,
          false,
        );
      }
      if (attempt + 1 < this.maxPolls) await this.sleep(this.pollIntervalMs);
    }
    if (!completed) {
      throw new ExecutionError('PROVIDER_UNAVAILABLE', 'OPENAI_SCENE_CONTINUATION_VIDEO_TIMEOUT', true);
    }

    const contentResponse = await this.fetchImpl(
      `${OPENAI_VIDEOS_ENDPOINT}/${encodeURIComponent(videoId)}/content`,
      { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!contentResponse.ok) {
      const detail = (await safeText(contentResponse)).slice(0, 400);
      throw providerHttpError(contentResponse.status, `CONTENT:${detail}`);
    }
    const outputBytes = new Uint8Array(await contentResponse.arrayBuffer());
    if (!isMp4(outputBytes)) {
      throw new ExecutionError('OUTPUT_TECH_SPEC_MISMATCH', 'OPENAI_VIDEO_OUTPUT_INVALID_MP4', false);
    }

    return {
      outputBytes,
      outputContentType: 'video/mp4',
      outputSha256: sha256(outputBytes),
      provider: 'OPENAI_VIDEO_API',
      providerJobId: videoId,
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
    !request.productId.trim() ||
    !request.operation.trim() ||
    !request.inheritedVisualStandardId.trim() ||
    !request.prompt.trim() ||
    request.source.bytes.byteLength === 0 ||
    approval.status !== 'APPROVED' ||
    approval.contentItemId !== request.contentItemId ||
    approval.productId !== request.productId ||
    approval.operation !== request.operation ||
    approval.sourceSha256.toLowerCase() !== request.source.sha256.toLowerCase() ||
    !approval.allowSceneContinuation ||
    approval.allowArchitecturalInvention ||
    approval.allowAiLogoGeneration
  ) {
    throw new ExecutionError('APPROVAL_REQUIRED', 'VIDEO_SCENE_CONTINUATION_REQUEST_NOT_APPROVED', false);
  }
  if (approval.expiresAt) {
    const expiry = Date.parse(approval.expiresAt);
    if (!Number.isFinite(expiry) || now.getTime() >= expiry) {
      throw new ExecutionError('APPROVAL_REQUIRED', 'VIDEO_SCENE_CONTINUATION_APPROVAL_EXPIRED', false);
    }
  }
}

function buildPrompt(request: SceneContinuationVideoRequest): string {
  const environment = request.thePartyEnvironment
    ? ` Canonical The Party environment: ${request.thePartyEnvironment}.`
    : '';
  const edition = request.thePartyEditionId
    ? ` Canonical edition_id: ${request.thePartyEditionId}.`
    : '';
  const expansion = request.approval.allowEnvironmentExpansion
    ? 'Controlled environment expansion was explicitly approved, but all newly visible geometry must remain plausible and consistent with the source image; do not invent signature architecture.'
    : 'Do not reveal or invent unseen architecture or venue areas. Keep camera movement and continuation constrained to geometry and spatial facts supported by the source image.';
  return [
    'Create a short vertical promotional video by continuing the supplied source photograph in time.',
    'The source photograph is the factual visual anchor and must remain recognizably the same venue, people, products, materials, perspective and lighting context.',
    expansion,
    'Do not generate, redraw, repair or hallucinate any logo, brand mark, written text, sign, sponsor mark or factual venue label. Official branding is applied later by a deterministic compositor.',
    'Do not transform the venue into a generic nightclub, beach club, rooftop, arena or any other place.',
    `Product/operation: ${request.productId}/${request.operation}. Inherited canonical visual standard: ${request.inheritedVisualStandardId}.${environment}${edition}`,
    `Creative direction: ${request.prompt.trim()}`,
    'Prefer natural subject motion, physically plausible light motion and cinematic camera motion. Preserve identity and avoid sudden scene cuts.',
  ].join(' ');
}

async function readJobResponse(response: Response, operation: string): Promise<VideoJobPayload> {
  if (!response.ok) {
    const detail = (await safeText(response)).slice(0, 400);
    throw providerHttpError(response.status, `${operation}:${detail}`);
  }
  return (await response.json()) as VideoJobPayload;
}

function providerHttpError(status: number, detail: string): ExecutionError {
  return new ExecutionError(
    status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_UNAVAILABLE',
    `OPENAI_SCENE_CONTINUATION_VIDEO_FAILED:${status}:${detail}`,
    status === 429 || status >= 500,
  );
}

function asNonEmptyString(value: unknown, error: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ExecutionError('PROVIDER_UNAVAILABLE', error, false);
  }
  return value.trim();
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function sourceFileName(contentType: CreativeVideoSourceContentType): string {
  if (contentType === 'image/png') return 'source.png';
  if (contentType === 'image/webp') return 'source.webp';
  return 'source.jpg';
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isMp4(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp';
}
