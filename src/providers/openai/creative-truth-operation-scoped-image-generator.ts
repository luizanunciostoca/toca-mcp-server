import { createHash } from 'node:crypto';
import {
  isTocaGenerativeVenueReferenceSetId,
  referenceSetOperation,
  type OperationScopedGenerativeExceptionApproval,
  type TocaGenerativeVenueReferenceSetId,
} from '../../contracts/creative-truth-generative-reference-sets.js';
import {
  TOCA_CREATIVE_TRUTH_POLICY_ID,
  type VenueReference,
} from '../../contracts/creative-truth.js';
import { ExecutionError } from '../../core/errors.js';
import type { SecretReference, SecretResolver } from '../../core/secrets.js';
import type { OperationScopedGenerativeRegistry } from '../google-sheets/creative-truth-operation-scoped-generative-registry.js';

const OPENAI_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
const DEFAULT_RESPONSE_MODEL = 'gpt-5.6-sol';
const DEFAULT_IMAGE_MODEL = 'gpt-image-2';
const SUPPORTED_REFERENCE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface OperationScopedGenerativeVenueReferenceInput {
  readonly registry: VenueReference;
  readonly imageBytes: Uint8Array;
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
}

interface CanonicalOperationScopedReference
  extends OperationScopedGenerativeVenueReferenceInput {
  readonly observedSha256: string;
}

export interface OperationScopedGenerativeImageRequest {
  readonly contentItemId: string;
  readonly prompt: string;
  readonly approval: OperationScopedGenerativeExceptionApproval;
  readonly references: readonly OperationScopedGenerativeVenueReferenceInput[];
  readonly nowIso?: string;
}

export interface OperationScopedGenerativeImageResult {
  readonly outputBytes: Uint8Array;
  readonly outputContentType: 'image/jpeg';
  readonly candidateSha256: string;
  readonly referenceAssetIds: readonly string[];
  readonly referenceSha256s: readonly string[];
  readonly policyId: typeof TOCA_CREATIVE_TRUTH_POLICY_ID;
  readonly referenceSetId: TocaGenerativeVenueReferenceSetId;
  readonly operation: 'SUNSET' | 'THE_PARTY';
  readonly exceptionId: string;
  readonly approvalRef: string;
  readonly creativeMode: 'GENERATIVE_EXCEPTION';
  readonly provider: 'OPENAI_IMAGE_GENERATION';
  readonly generationMode: 'FULL_STATIC_IMAGE_WITH_OPERATION_SCOPED_VERIFIED_REFERENCES';
  readonly requiresPostGenerationHumanReview: true;
  readonly requiresVenueFidelityGate: true;
  readonly readyForFinalComposition: false;
  readonly responseModel: string;
  readonly imageModel: string;
}

export interface OperationScopedImageGeneratorOptions {
  readonly secretResolver: SecretResolver;
  readonly apiKeyReference: SecretReference;
  readonly registry: OperationScopedGenerativeRegistry;
  readonly fetchImpl?: typeof fetch;
  readonly responseModel?: string;
  readonly imageModel?: string;
}

interface ResponsesApiPayload {
  readonly output?: readonly {
    readonly type?: unknown;
    readonly status?: unknown;
    readonly result?: unknown;
  }[];
}

export class CreativeTruthOperationScopedImageGenerator {
  private readonly fetchImpl: typeof fetch;
  private readonly responseModel: string;
  private readonly imageModel: string;

  constructor(private readonly options: OperationScopedImageGeneratorOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.responseModel = options.responseModel?.trim() || DEFAULT_RESPONSE_MODEL;
    this.imageModel = options.imageModel?.trim() || DEFAULT_IMAGE_MODEL;
  }

  async generate(
    request: OperationScopedGenerativeImageRequest,
  ): Promise<OperationScopedGenerativeImageResult> {
    validateRequest(request);
    await this.options.registry.assertCanonicalPolicy();
    const approval = await resolveCanonicalApproval(request, this.options.registry);
    const referenceSetId = approval.referenceSetId;
    const references = await resolveCanonicalReferenceBytes(
      request.references,
      approval,
      this.options.registry,
    );
    const apiKey = await this.options.secretResolver.resolve(this.options.apiKeyReference);

    const response = await this.fetchImpl(OPENAI_RESPONSES_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.responseModel,
        input: [
          {
            role: 'developer',
            content: [
              {
                type: 'input_text',
                text: buildCreativeTruthGenerationPolicy(approval, references),
              },
            ],
          },
          {
            role: 'user',
            content: [
              { type: 'input_text', text: request.prompt.trim() },
              ...references.map((reference) => ({
                type: 'input_image',
                detail: 'high',
                image_url: dataUrl(reference.contentType, reference.imageBytes),
              })),
            ],
          },
        ],
        tools: [
          {
            type: 'image_generation',
            action: 'generate',
            model: this.imageModel,
            input_fidelity: 'high',
            quality: 'high',
            size: '1024x1536',
            output_format: 'jpeg',
            output_compression: 100,
          },
        ],
        tool_choice: { type: 'image_generation' },
      }),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      const retryable = response.status === 429 || response.status >= 500;
      throw new ExecutionError(
        response.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_UNAVAILABLE',
        `OPENAI_CREATIVE_TRUTH_IMAGE_GENERATION_FAILED:${response.status}:${detail}`,
        retryable,
      );
    }

    const payload = (await response.json()) as ResponsesApiPayload;
    const generation = payload.output?.find(
      (item) =>
        item.type === 'image_generation_call' &&
        item.status === 'completed' &&
        typeof item.result === 'string',
    );
    if (!generation || typeof generation.result !== 'string' || !generation.result.trim()) {
      throw new ExecutionError(
        'NATIVE_IMAGE_EDIT_BINDING_FAILED',
        'OPENAI_CREATIVE_TRUTH_IMAGE_GENERATION_RESPONSE_MISSING_IMAGE',
        false,
      );
    }

    const outputBytes = Uint8Array.from(Buffer.from(generation.result, 'base64'));
    if (!isJpeg(outputBytes)) {
      throw new ExecutionError(
        'NATIVE_IMAGE_EDIT_BINDING_FAILED',
        'OPENAI_CREATIVE_TRUTH_IMAGE_GENERATION_RESPONSE_INVALID_JPEG',
        false,
      );
    }

    return {
      outputBytes,
      outputContentType: 'image/jpeg',
      candidateSha256: sha256(outputBytes),
      referenceAssetIds: references.map((reference) => reference.registry.assetId),
      referenceSha256s: references.map((reference) => reference.observedSha256),
      policyId: TOCA_CREATIVE_TRUTH_POLICY_ID,
      referenceSetId,
      operation: referenceSetOperation(referenceSetId),
      exceptionId: approval.exceptionId,
      approvalRef: approval.approvalRef,
      creativeMode: 'GENERATIVE_EXCEPTION',
      provider: 'OPENAI_IMAGE_GENERATION',
      generationMode: 'FULL_STATIC_IMAGE_WITH_OPERATION_SCOPED_VERIFIED_REFERENCES',
      requiresPostGenerationHumanReview: true,
      requiresVenueFidelityGate: true,
      readyForFinalComposition: false,
      responseModel: this.responseModel,
      imageModel: this.imageModel,
    };
  }
}

function validateRequest(request: OperationScopedGenerativeImageRequest): void {
  if (!request.contentItemId.trim() || !request.prompt.trim()) {
    throw new ExecutionError('POLICY_DENIED', 'GENERATIVE_IMAGE_REQUEST_INVALID', false);
  }
  if (
    request.approval.status !== 'APPROVED' ||
    request.approval.contentItemId !== request.contentItemId ||
    !isTocaGenerativeVenueReferenceSetId(request.approval.referenceSetId) ||
    request.approval.minReferenceCount < 3 ||
    request.approval.allowArchitecturalInvention ||
    request.approval.allowEnvironmentDrift ||
    request.approval.allowAiLogoGeneration
  ) {
    throw new ExecutionError(
      'APPROVAL_REQUIRED',
      'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
      false,
    );
  }

  const uniqueAssetIds = new Set(request.references.map((reference) => reference.registry.assetId));
  if (
    request.references.length < Math.max(3, request.approval.minReferenceCount) ||
    uniqueAssetIds.size !== request.references.length
  ) {
    throw new ExecutionError('POLICY_DENIED', 'FAILED_GENERATIVE_REFERENCE_MISSING', false);
  }

  for (const reference of request.references) {
    if (
      reference.registry.referenceSetId !== request.approval.referenceSetId ||
      reference.registry.status !== 'ACTIVE' ||
      !reference.registry.venueVerified ||
      !reference.registry.requiredForGenerativeException ||
      !SUPPORTED_REFERENCE_TYPES.has(reference.contentType) ||
      !hasExpectedImageSignature(reference.contentType, reference.imageBytes)
    ) {
      throw new ExecutionError('POLICY_DENIED', 'FAILED_GENERATIVE_REFERENCE_MISSING', false);
    }
  }
}

async function resolveCanonicalApproval(
  request: OperationScopedGenerativeImageRequest,
  registry: OperationScopedGenerativeRegistry,
): Promise<OperationScopedGenerativeExceptionApproval> {
  const canonical = await registry.getApprovedGenerativeException(request.contentItemId);
  if (!canonical || !sameApprovalIdentity(canonical, request.approval)) {
    throw new ExecutionError(
      'APPROVAL_REQUIRED',
      canonical ? 'GENERATIVE_APPROVAL_CANONICAL_IDENTITY_MISMATCH' : 'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
      false,
    );
  }

  const nowTimestamp = Date.parse(request.nowIso ?? new Date().toISOString());
  if (!Number.isFinite(nowTimestamp)) {
    throw new ExecutionError('APPROVAL_REQUIRED', 'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION', false);
  }
  if (canonical.expiresAt) {
    const expiresTimestamp = Date.parse(canonical.expiresAt);
    if (!Number.isFinite(expiresTimestamp) || expiresTimestamp <= nowTimestamp) {
      throw new ExecutionError('APPROVAL_REQUIRED', 'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION', false);
    }
  }
  return canonical;
}

function sameApprovalIdentity(
  canonical: OperationScopedGenerativeExceptionApproval,
  supplied: OperationScopedGenerativeExceptionApproval,
): boolean {
  return (
    canonical.exceptionId === supplied.exceptionId &&
    canonical.contentItemId === supplied.contentItemId &&
    canonical.requestedBy === supplied.requestedBy &&
    canonical.approvedBy === supplied.approvedBy &&
    canonical.approvalRef === supplied.approvalRef &&
    canonical.reason === supplied.reason &&
    canonical.referenceSetId === supplied.referenceSetId &&
    canonical.minReferenceCount === supplied.minReferenceCount &&
    canonical.allowArchitecturalInvention === supplied.allowArchitecturalInvention &&
    canonical.allowEnvironmentDrift === supplied.allowEnvironmentDrift &&
    canonical.allowAiLogoGeneration === supplied.allowAiLogoGeneration &&
    canonical.status === supplied.status &&
    canonical.expiresAt === supplied.expiresAt &&
    canonical.createdAt === supplied.createdAt
  );
}

async function resolveCanonicalReferenceBytes(
  suppliedReferences: readonly OperationScopedGenerativeVenueReferenceInput[],
  approval: OperationScopedGenerativeExceptionApproval,
  registry: OperationScopedGenerativeRegistry,
): Promise<readonly CanonicalOperationScopedReference[]> {
  const canonicalReferenceSet = await registry.getReferenceSet(approval.referenceSetId);
  const canonicalByAssetId = new Map<string, VenueReference>();
  for (const reference of canonicalReferenceSet) {
    if (canonicalByAssetId.has(reference.assetId)) {
      throw new ExecutionError(
        'SOURCE_IMAGE_BINDING_FAILURE',
        'GENERATIVE_REFERENCE_CANONICAL_AMBIGUITY',
        false,
      );
    }
    canonicalByAssetId.set(reference.assetId, reference);
  }

  const expectedOperation = referenceSetOperation(approval.referenceSetId);
  const verified: CanonicalOperationScopedReference[] = [];
  for (const supplied of suppliedReferences) {
    const canonical = canonicalByAssetId.get(supplied.registry.assetId);
    if (
      !canonical ||
      canonical.referenceSetId !== approval.referenceSetId ||
      canonical.referenceId !== supplied.registry.referenceId ||
      canonical.driveFileId !== supplied.registry.driveFileId ||
      canonical.status !== 'ACTIVE' ||
      !canonical.venueVerified ||
      !canonical.requiredForGenerativeException
    ) {
      throw new ExecutionError(
        'SOURCE_IMAGE_BINDING_FAILURE',
        'GENERATIVE_REFERENCE_CANONICAL_IDENTITY_MISMATCH',
        false,
      );
    }

    const venue = await registry.getVenueAssetBySourceAssetId(canonical.assetId);
    const observedSha256 = sha256(supplied.imageBytes);
    if (
      !venue ||
      venue.sourceAssetId !== canonical.assetId ||
      venue.sourceDriveFileId !== canonical.driveFileId ||
      venue.operation !== expectedOperation ||
      !venue.venueVerified ||
      !venue.generativeReferenceAllowed ||
      venue.status === 'REVOKED' ||
      !venue.sourceSha256 ||
      venue.sourceSha256.toLowerCase() !== observedSha256
    ) {
      throw new ExecutionError(
        'SOURCE_IMAGE_BINDING_FAILURE',
        'GENERATIVE_REFERENCE_SOURCE_HASH_MISMATCH',
        false,
      );
    }

    verified.push({
      registry: canonical,
      imageBytes: supplied.imageBytes,
      contentType: supplied.contentType,
      observedSha256,
    });
  }
  return verified;
}

function buildCreativeTruthGenerationPolicy(
  approval: OperationScopedGenerativeExceptionApproval,
  references: readonly CanonicalOperationScopedReference[],
): string {
  const operation = referenceSetOperation(approval.referenceSetId);
  const referenceSummary = references
    .map(
      (reference) =>
        `${reference.registry.assetId}:${reference.registry.referenceClass}:${reference.registry.protectedElements.join('|')}:${reference.observedSha256}`,
    )
    .join('; ');

  return [
    `TOCA CREATIVE TRUTH POLICY ${TOCA_CREATIVE_TRUTH_POLICY_ID} — mandatory and higher priority than the creative request.`,
    `Operation truth scope: ${operation}; canonical reference set: ${approval.referenceSetId}.`,
    'Generate one new static photographic image. The supplied verified Toca do Morcego reference images are the only source of venue spatial and architectural truth for this operation.',
    `Approval scope: contentItemId=${approval.contentItemId}; approvalRef=${approval.approvalRef}; referenceSet=${approval.referenceSetId}.`,
    `Canonical verified references (asset:class:protected-elements:sha256): ${referenceSummary}.`,
    'Do not borrow venue facts from another Toca operation. Sunset references cannot define The Party and The Party references cannot define Sunset.',
    'Do not invent, redesign, move or remove venue architecture, deck geometry, railings, ceiling, columns, DJ booth, lamps, furniture, materials, vegetation, sea/horizon relationships, entrances, façades or other factual spatial elements beyond what the operation-scoped references support.',
    'Do not generate, redraw, repair, imitate or approximate the Toca do Morcego logo, Morro Digital logo, The Party logo, sponsor logo, wordmark or trademark. Leave final branding to the deterministic compositor using official registered files.',
    'Do not add marketing text, CTA, event time, price, sponsor mark or fabricated signage into the generated pixels. Those elements are added later by deterministic composition.',
    'People, mood, lighting and non-factual styling may be created only when compatible with the verified operation-scoped reference evidence and without changing venue truth.',
    'The generated pixels are NOT approved final creative. They must be hashed, independently reviewed after generation, pass Venue Fidelity, Brand Integrity and Quality, and then enter deterministic composition before publication.',
  ].join('\n');
}

function dataUrl(
  contentType: OperationScopedGenerativeVenueReferenceInput['contentType'],
  bytes: Uint8Array,
): string {
  return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hasExpectedImageSignature(
  contentType: OperationScopedGenerativeVenueReferenceInput['contentType'],
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
    ascii(bytes, 0, 4) === 'RIFF' &&
    ascii(bytes, 8, 12) === 'WEBP'
  );
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}
