import { createHash } from 'node:crypto';
import {
  TOCA_CREATIVE_TRUTH_POLICY_ID,
  TOCA_VENUE_REFERENCE_SET_ID,
  type GenerativeExceptionApproval,
  type VenueReference,
} from '../../contracts/creative-truth.js';
import { ExecutionError } from '../../core/errors.js';
import type { SecretReference, SecretResolver } from '../../core/secrets.js';
import type { GoogleSheetsCreativeTruthRegistry } from '../google-sheets/creative-truth-registry.js';

const OPENAI_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
const DEFAULT_RESPONSE_MODEL = 'gpt-5';
const DEFAULT_IMAGE_MODEL = 'gpt-image-1';
const SUPPORTED_REFERENCE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface GenerativeVenueReferenceInput {
  readonly registry: VenueReference;
  readonly imageBytes: Uint8Array;
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
}

interface CanonicalGenerativeVenueReferenceInput extends GenerativeVenueReferenceInput {
  readonly observedSha256: string;
}

export interface CreativeTruthGenerativeImageRequest {
  readonly contentItemId: string;
  readonly prompt: string;
  readonly approval: GenerativeExceptionApproval;
  readonly references: readonly GenerativeVenueReferenceInput[];
  readonly nowIso?: string;
}

export interface CreativeTruthGenerativeImageResult {
  readonly outputBytes: Uint8Array;
  readonly outputContentType: 'image/jpeg';
  readonly candidateSha256: string;
  readonly referenceAssetIds: readonly string[];
  readonly referenceSha256s: readonly string[];
  readonly policyId: typeof TOCA_CREATIVE_TRUTH_POLICY_ID;
  readonly referenceSetId: typeof TOCA_VENUE_REFERENCE_SET_ID;
  readonly exceptionId: string;
  readonly approvalRef: string;
  readonly creativeMode: 'GENERATIVE_EXCEPTION';
  readonly provider: 'OPENAI_IMAGE_GENERATION';
  readonly generationMode: 'FULL_STATIC_IMAGE_WITH_VERIFIED_REFERENCES';
  readonly requiresPostGenerationHumanReview: true;
  readonly requiresVenueFidelityGate: true;
  readonly readyForFinalComposition: false;
  readonly responseModel: string;
  readonly imageModel: string;
}

export interface CreativeTruthOpenAiImageGeneratorOptions {
  readonly secretResolver: SecretResolver;
  readonly apiKeyReference: SecretReference;
  readonly registry: Pick<
    GoogleSheetsCreativeTruthRegistry,
    | 'assertCanonicalPolicy'
    | 'getApprovedGenerativeException'
    | 'getReferenceSet'
    | 'getVenueAssetBySourceAssetId'
  >;
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

export class CreativeTruthOpenAiImageGenerator {
  private readonly fetchImpl: typeof fetch;
  private readonly responseModel: string;
  private readonly imageModel: string;

  constructor(private readonly options: CreativeTruthOpenAiImageGeneratorOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.responseModel = options.responseModel?.trim() || DEFAULT_RESPONSE_MODEL;
    this.imageModel = options.imageModel?.trim() || DEFAULT_IMAGE_MODEL;
  }

  async generate(
    request: CreativeTruthGenerativeImageRequest,
  ): Promise<CreativeTruthGenerativeImageResult> {
    const suppliedReferences = validateRequest(request);
    await this.options.registry.assertCanonicalPolicy();
    const approval = await resolveCanonicalApproval(request, this.options.registry);
    const references = await resolveCanonicalReferenceBytes(
      suppliedReferences,
      this.options.registry,
    );
    const referenceAssetIds = references.map((reference) => reference.registry.assetId);
    const referenceSha256s = references.map((reference) => reference.observedSha256);
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
              {
                type: 'input_text',
                text: request.prompt.trim(),
              },
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
      referenceAssetIds,
      referenceSha256s,
      policyId: TOCA_CREATIVE_TRUTH_POLICY_ID,
      referenceSetId: TOCA_VENUE_REFERENCE_SET_ID,
      exceptionId: approval.exceptionId,
      approvalRef: approval.approvalRef,
      creativeMode: 'GENERATIVE_EXCEPTION',
      provider: 'OPENAI_IMAGE_GENERATION',
      generationMode: 'FULL_STATIC_IMAGE_WITH_VERIFIED_REFERENCES',
      requiresPostGenerationHumanReview: true,
      requiresVenueFidelityGate: true,
      readyForFinalComposition: false,
      responseModel: this.responseModel,
      imageModel: this.imageModel,
    };
  }
}

function validateRequest(
  request: CreativeTruthGenerativeImageRequest,
): readonly GenerativeVenueReferenceInput[] {
  if (!request.contentItemId.trim() || !request.prompt.trim()) {
    throw new ExecutionError('POLICY_DENIED', 'GENERATIVE_IMAGE_REQUEST_INVALID', false);
  }

  const approval = request.approval;
  if (
    approval.status !== 'APPROVED' ||
    approval.contentItemId !== request.contentItemId ||
    approval.referenceSetId !== TOCA_VENUE_REFERENCE_SET_ID ||
    approval.minReferenceCount < 3 ||
    approval.allowArchitecturalInvention ||
    approval.allowEnvironmentDrift ||
    approval.allowAiLogoGeneration
  ) {
    throw new ExecutionError(
      'APPROVAL_REQUIRED',
      'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
      false,
    );
  }

  const nowTimestamp = Date.parse(request.nowIso ?? new Date().toISOString());
  if (!Number.isFinite(nowTimestamp)) {
    throw new ExecutionError(
      'APPROVAL_REQUIRED',
      'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
      false,
    );
  }
  if (approval.expiresAt) {
    const expiresTimestamp = Date.parse(approval.expiresAt);
    if (!Number.isFinite(expiresTimestamp) || expiresTimestamp <= nowTimestamp) {
      throw new ExecutionError(
        'APPROVAL_REQUIRED',
        'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
        false,
      );
    }
  }

  const minimum = Math.max(3, approval.minReferenceCount);
  const references = [...request.references];
  const uniqueIds = new Set(references.map((reference) => reference.registry.assetId));
  if (references.length < minimum || uniqueIds.size !== references.length) {
    throw new ExecutionError('POLICY_DENIED', 'FAILED_GENERATIVE_REFERENCE_MISSING', false);
  }

  for (const reference of references) {
    if (
      reference.registry.referenceSetId !== TOCA_VENUE_REFERENCE_SET_ID ||
      reference.registry.status !== 'ACTIVE' ||
      !reference.registry.venueVerified ||
      !reference.registry.requiredForGenerativeException ||
      !SUPPORTED_REFERENCE_TYPES.has(reference.contentType) ||
      !hasExpectedImageSignature(reference.contentType, reference.imageBytes)
    ) {
      throw new ExecutionError('POLICY_DENIED', 'FAILED_GENERATIVE_REFERENCE_MISSING', false);
    }
  }

  return references;
}

async function resolveCanonicalApproval(
  request: CreativeTruthGenerativeImageRequest,
  registry: Pick<GoogleSheetsCreativeTruthRegistry, 'getApprovedGenerativeException'>,
): Promise<GenerativeExceptionApproval> {
  const canonical = await registry.getApprovedGenerativeException(request.contentItemId);
  if (!canonical || canonical.status !== 'APPROVED') {
    throw new ExecutionError(
      'APPROVAL_REQUIRED',
      'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
      false,
    );
  }
  if (!sameApprovalIdentity(canonical, request.approval)) {
    throw new ExecutionError(
      'APPROVAL_REQUIRED',
      'GENERATIVE_APPROVAL_CANONICAL_IDENTITY_MISMATCH',
      false,
    );
  }

  const nowTimestamp = Date.parse(request.nowIso ?? new Date().toISOString());
  if (!Number.isFinite(nowTimestamp)) {
    throw new ExecutionError(
      'APPROVAL_REQUIRED',
      'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
      false,
    );
  }
  if (canonical.expiresAt) {
    const expiresTimestamp = Date.parse(canonical.expiresAt);
    if (!Number.isFinite(expiresTimestamp) || expiresTimestamp <= nowTimestamp) {
      throw new ExecutionError(
        'APPROVAL_REQUIRED',
        'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
        false,
      );
    }
  }
  if (request.references.length < Math.max(3, canonical.minReferenceCount)) {
    throw new ExecutionError('POLICY_DENIED', 'FAILED_GENERATIVE_REFERENCE_MISSING', false);
  }
  return canonical;
}

function sameApprovalIdentity(
  canonical: GenerativeExceptionApproval,
  supplied: GenerativeExceptionApproval,
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
  suppliedReferences: readonly GenerativeVenueReferenceInput[],
  registry: Pick<
    GoogleSheetsCreativeTruthRegistry,
    'getReferenceSet' | 'getVenueAssetBySourceAssetId'
  >,
): Promise<readonly CanonicalGenerativeVenueReferenceInput[]> {
  const canonicalReferenceSet = await registry.getReferenceSet(TOCA_VENUE_REFERENCE_SET_ID);
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

  const verified: CanonicalGenerativeVenueReferenceInput[] = [];
  for (const supplied of suppliedReferences) {
    const canonical = canonicalByAssetId.get(supplied.registry.assetId);
    if (
      !canonical ||
      canonical.referenceSetId !== TOCA_VENUE_REFERENCE_SET_ID ||
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
  approval: GenerativeExceptionApproval,
  references: readonly CanonicalGenerativeVenueReferenceInput[],
): string {
  const referenceSummary = references
    .map(
      (reference) =>
        `${reference.registry.assetId}:${reference.registry.referenceClass}:${reference.registry.protectedElements.join('|')}:${reference.observedSha256}`,
    )
    .join('; ');

  return [
    `TOCA CREATIVE TRUTH POLICY ${TOCA_CREATIVE_TRUTH_POLICY_ID} — mandatory and higher priority than the creative request.`,
    'Generate one new static photographic image. The supplied verified Toca do Morcego reference images are the only source of venue spatial and architectural truth.',
    `Approval scope: contentItemId=${approval.contentItemId}; approvalRef=${approval.approvalRef}; referenceSet=${TOCA_VENUE_REFERENCE_SET_ID}.`,
    `Canonical verified references (asset:class:protected-elements:sha256): ${referenceSummary}.`,
    'Do not invent, redesign, move or remove venue architecture, deck geometry, railings, lamps, furniture, materials, vegetation, sea/horizon relationships or other factual spatial elements beyond what the references support.',
    'Do not generate, redraw, repair, imitate or approximate the Toca do Morcego logo, Morro Digital logo, sponsor logo, wordmark or trademark. Leave final branding to the deterministic compositor using official registered files.',
    'Do not add marketing text, CTA, event time, price, sponsor mark or fabricated signage into the generated pixels. Those elements are added later by deterministic composition.',
    'People, mood, lighting and non-factual styling may be created only when compatible with the verified reference evidence and without changing venue truth.',
    'The generated pixels are NOT approved final creative. They must be hashed, independently reviewed after generation, pass Venue Fidelity, Brand Integrity and Quality, and then enter deterministic composition before publication.',
  ].join('\n');
}

function dataUrl(
  contentType: GenerativeVenueReferenceInput['contentType'],
  bytes: Uint8Array,
): string {
  return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hasExpectedImageSignature(
  contentType: GenerativeVenueReferenceInput['contentType'],
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
