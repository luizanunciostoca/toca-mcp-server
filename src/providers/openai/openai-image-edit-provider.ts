import { createHash } from 'node:crypto';
import type { CreativeMode } from '../../contracts/creative-truth.js';
import { TOCA_CREATIVE_TRUTH_POLICY_ID } from '../../contracts/creative-truth.js';
import { buildTocaImageEditPrompt } from '../../creative/creative-truth.js';
import { ExecutionError } from '../../core/errors.js';
import type { SecretReference, SecretResolver } from '../../core/secrets.js';

export const TOCA_CANONICAL_IMAGE_TREATMENT_PROMPT = `Transforme a imagem carregada, de baixa qualidade e desfocada, em uma qualidade cinematografica de detalhamento extremo.
Preserve 100% da identidade original, estrutura, fundo, elementos, enquadramento e composição.
RECUPERAÇÃO DE MICRO-DETALHES:
Elementos, Imagens, ícones e textos nítidos
Clareza de alto contraste, profundidade intensa e iluminação cinematográfica equilibrada. Realismo de nível de pôster com detalhes dramáticos, porém precisos.
Saída em resolução 8K, qualidade ProRes, nitidez de nível de estúdio.
Apenas texturas fotorrealistas. Apenas melhorias fieis à fonte original.`;

const OPENAI_IMAGE_EDIT_ENDPOINT = 'https://api.openai.com/v1/images/edits';
const SUPPORTED_SOURCE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface TocaCreativeTruthEditBinding {
  readonly brandScope: 'TOCA_DO_MORCEGO';
  readonly policyId: typeof TOCA_CREATIVE_TRUTH_POLICY_ID;
  readonly creativeMode: CreativeMode;
}

export interface OpenAiImageEditRequest {
  readonly sourceAssetId: string;
  readonly sourceDriveFileId: string;
  readonly imageBytes: Uint8Array;
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly prompt?: string;
  readonly creativeTruth?: TocaCreativeTruthEditBinding;
}

export interface OpenAiImageEditResult {
  readonly outputBytes: Uint8Array;
  readonly outputContentType: 'image/jpeg';
  readonly sourceSha256: string;
  readonly outputSha256: string;
  readonly sourceImageBound: true;
  readonly editMode: 'EDIT_EXISTING_IMAGE';
  readonly editorProvider: 'OPENAI_IMAGE_EDIT';
  readonly inputFidelity: 'high';
  readonly requestedQuality: 'high';
  readonly requestedSize: 'auto';
  readonly requestedOutputFormat: 'jpeg';
  readonly prompt: string;
  readonly sourceAssetId: string;
  readonly sourceDriveFileId: string;
  readonly creativeTruthBound?: true;
  readonly requiresVenueFidelityGate?: true;
}

export interface OpenAiImageEditProviderOptions {
  readonly secretResolver: SecretResolver;
  readonly apiKeyReference: SecretReference;
  readonly fetchImpl?: typeof fetch;
  readonly model?: string;
}

interface ImageEditResponse {
  readonly data?: readonly { readonly b64_json?: unknown }[];
}

export class OpenAiImageEditProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly model: string;

  constructor(private readonly options: OpenAiImageEditProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.model = options.model ?? 'gpt-image-1';
  }

  async edit(request: OpenAiImageEditRequest): Promise<OpenAiImageEditResult> {
    validateRequest(request);
    const sourceBytes = Uint8Array.from(request.imageBytes);
    const sourceSha256 = sha256(sourceBytes);
    const apiKey = await this.options.secretResolver.resolve(this.options.apiKeyReference);
    const basePrompt = request.prompt?.trim() || TOCA_CANONICAL_IMAGE_TREATMENT_PROMPT;
    const prompt = request.creativeTruth
      ? buildTocaImageEditPrompt(basePrompt, request.creativeTruth.creativeMode)
      : basePrompt;

    const form = new FormData();
    form.set('model', this.model);
    form.set('prompt', prompt);
    form.set('input_fidelity', 'high');
    form.set('quality', 'high');
    form.set('size', 'auto');
    form.set('output_format', 'jpeg');
    form.set('output_compression', '100');
    form.set(
      'image',
      new Blob([sourceBytes], { type: request.contentType }),
      sourceFilename(request.contentType),
    );

    const response = await this.fetchImpl(OPENAI_IMAGE_EDIT_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      const retryable = response.status === 429 || response.status >= 500;
      throw new ExecutionError(
        response.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_UNAVAILABLE',
        `OPENAI_IMAGE_EDIT_FAILED:${response.status}:${detail}`,
        retryable,
      );
    }

    const payload = (await response.json()) as ImageEditResponse;
    const encoded = payload.data?.[0]?.b64_json;
    if (typeof encoded !== 'string' || !encoded.trim()) {
      throw new ExecutionError(
        'NATIVE_IMAGE_EDIT_BINDING_FAILED',
        'OPENAI_IMAGE_EDIT_RESPONSE_MISSING_IMAGE',
        false,
      );
    }

    let outputBytes: Uint8Array;
    try {
      outputBytes = Uint8Array.from(Buffer.from(encoded, 'base64'));
    } catch {
      throw new ExecutionError(
        'NATIVE_IMAGE_EDIT_BINDING_FAILED',
        'OPENAI_IMAGE_EDIT_RESPONSE_INVALID_BASE64',
        false,
      );
    }
    if (outputBytes.byteLength === 0) {
      throw new ExecutionError(
        'NATIVE_IMAGE_EDIT_BINDING_FAILED',
        'OPENAI_IMAGE_EDIT_RESPONSE_EMPTY',
        false,
      );
    }

    return {
      outputBytes,
      outputContentType: 'image/jpeg',
      sourceSha256,
      outputSha256: sha256(outputBytes),
      sourceImageBound: true,
      editMode: 'EDIT_EXISTING_IMAGE',
      editorProvider: 'OPENAI_IMAGE_EDIT',
      inputFidelity: 'high',
      requestedQuality: 'high',
      requestedSize: 'auto',
      requestedOutputFormat: 'jpeg',
      prompt,
      sourceAssetId: request.sourceAssetId,
      sourceDriveFileId: request.sourceDriveFileId,
      ...(request.creativeTruth
        ? { creativeTruthBound: true as const, requiresVenueFidelityGate: true as const }
        : {}),
    };
  }
}

function validateRequest(request: OpenAiImageEditRequest): void {
  if (!request.sourceAssetId.trim() || !request.sourceDriveFileId.trim()) {
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      'SOURCE_IMAGE_IDENTIFIERS_REQUIRED',
      false,
    );
  }
  if (!SUPPORTED_SOURCE_TYPES.has(request.contentType)) {
    throw new ExecutionError(
      'SOURCE_IMAGE_BINDING_FAILURE',
      `SOURCE_IMAGE_MIME_UNSUPPORTED:${request.contentType}`,
      false,
    );
  }
  if (request.imageBytes.byteLength === 0) {
    throw new ExecutionError('SOURCE_IMAGE_FETCH_BLOCK', 'SOURCE_IMAGE_EMPTY', false);
  }
  if (request.creativeTruth?.policyId !== undefined) {
    if (
      request.creativeTruth.brandScope !== 'TOCA_DO_MORCEGO' ||
      request.creativeTruth.policyId !== TOCA_CREATIVE_TRUTH_POLICY_ID
    ) {
      throw new ExecutionError('POLICY_DENIED', 'INVALID_CREATIVE_TRUTH_BINDING', false);
    }
  }
}

function sourceFilename(contentType: OpenAiImageEditRequest['contentType']): string {
  if (contentType === 'image/png') return 'source.png';
  if (contentType === 'image/webp') return 'source.webp';
  return 'source.jpg';
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
