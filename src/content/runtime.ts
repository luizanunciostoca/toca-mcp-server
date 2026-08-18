import { createHash } from 'node:crypto';
import type pg from 'pg';
import { createDomainEvent } from '../events/domain-events.js';
import { PostgresTransactionalOutbox } from '../events/postgres-transactional-outbox.js';
import type { TransactionalOutboxWriter } from '../events/transactional-outbox.js';
import { PostgresContentItemStore } from '../persistence/postgres-content-item-store.js';
import {
  CONTENT_ITEM_FORMATS,
  planContentRepurpose,
  validateAccessibility,
  validateFactClaims,
  validateRights,
  type AccessibilityCheck,
  type ContentItemFormat,
  type ContentItemStore,
  type ContentItemVersion,
  type ContentValidationStatus,
  type FactClaimCheck,
  type JsonValue,
  type RightsCheck,
} from './content-item.js';
import { VIDEO_CONTENT_TECHNICAL_EXTENSION_CAPABILITY_SET } from './capability-ids.js';
import { assertVideoThumbnailCreativeTruth } from './video-thumbnail-creative-truth.js';
import {
  validateAudioNormalization,
  validateDuration,
  validateExportManifest,
  validateMusicRights,
  validateSafeArea,
  validateSelectedVideoAssets,
  validateSubtitleTrack,
  validateTimeline,
  validateVideoBrief,
  validateVideoQuality,
  validateStoryboard,
  validateScript,
  type AudioNormalizationResult,
  type DurationPolicy,
  type MusicRightsInput,
  type SafeAreaPolicy,
  type ScriptSegment,
  type SelectedVideoAsset,
  type StoryboardScene,
  type SubtitleTrack,
  type VideoBrief,
  type VideoExportManifest,
  type VideoGateResult,
  type VideoTimeline,
} from './video.js';

export interface VideoContentRuntimeInput {
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly content_item_id: string;
  readonly version_id: string;
  readonly correlation_id: string;
  readonly idempotency_key?: string;
  readonly evidence: readonly string[];
  readonly payload: Readonly<Record<string, unknown>>;
  readonly approval_ref?: string;
  readonly target_channel?: string;
  readonly target_format?: string;
  readonly target_language?: string;
  readonly event_id?: string;
  readonly experiment_id?: string;
}

export interface VideoContentRuntimeReadback {
  readonly verified: boolean;
  readonly evidence: readonly string[];
  readonly externalResourceId?: string;
  readonly reason?: string;
}

export interface VideoContentRuntimeService {
  execute(capabilityId: string, input: VideoContentRuntimeInput): Promise<unknown>;
  readback(
    capabilityId: string,
    result: unknown,
    input: VideoContentRuntimeInput,
  ): Promise<VideoContentRuntimeReadback>;
}

export const VIDEO_CONTENT_WRITE_CAPABILITY_IDS = new Set<string>([
  'video.brief.create',
  'video.storyboard.generate',
  'video.script.generate',
  'video.asset.select',
  'video.timeline.compose',
  'video.subtitle.generate',
  'video.caption.embed',
  'video.audio.normalize',
  'video.thumbnail.generate',
  'video.export.reel',
  'video.export.story',
  'content_item.version.create',
  'content_item.variant.create',
  'content_item.channel.adapt',
  'content_item.language.localize',
  'content_item.event.link',
  'content_item.experiment.link',
]);

interface ArtifactRow {
  readonly artifact_id: string;
  readonly artifact_ref: string;
  readonly content_item_id: string;
  readonly version_id: string;
  readonly capability_id: string;
  readonly idempotency_key: string;
  readonly payload_sha256: string;
  readonly payload: unknown;
  readonly evidence: unknown;
  readonly created_at: Date | string;
}

interface PersistedArtifact {
  readonly artifactId: string;
  readonly artifactRef: string;
  readonly contentItemId: string;
  readonly versionId: string;
  readonly capabilityId: string;
  readonly idempotencyKey: string;
  readonly payloadSha256: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly evidence: readonly string[];
  readonly createdAt: string;
}

class PostgresVideoArtifactStore {
  readonly #outbox: TransactionalOutboxWriter;

  constructor(
    private readonly pool: pg.Pool,
    outbox?: TransactionalOutboxWriter,
  ) {
    this.#outbox = outbox ?? new PostgresTransactionalOutbox(pool);
  }

  async put(capabilityId: string, input: VideoContentRuntimeInput): Promise<PersistedArtifact> {
    const idempotencyKey = runtimeIdempotencyKey(capabilityId, input);
    const payloadSha256 = sha256(canonicalJson(input.payload));
    const artifactId = `r29_${sha256(`${capabilityId}|${input.content_item_id}|${idempotencyKey}`).slice(0, 40)}`;
    const artifactRef = `toca://r29/content/${encodeURIComponent(input.content_item_id)}/artifacts/${artifactId}`;
    const now = new Date().toISOString();
    const evidence = normalizeEvidence(input.evidence);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const existing = await client.query<ArtifactRow>(
        `select * from content_video_artifacts
         where content_item_id = $1 and capability_id = $2 and idempotency_key = $3
         for update`,
        [input.content_item_id, capabilityId, idempotencyKey],
      );
      const existingRow = existing.rows[0];
      if (existingRow) {
        const artifact = artifactFromRow(existingRow);
        if (artifact.payloadSha256 !== payloadSha256) {
          throw new Error('VIDEO_CONTENT_IDEMPOTENCY_CONFLICT');
        }
        await client.query('commit');
        return artifact;
      }

      const inserted = await client.query<ArtifactRow>(
        `insert into content_video_artifacts (
           artifact_id, artifact_ref, tenant_id, workspace_id, organization_id,
           content_item_id, version_id, capability_id, idempotency_key,
           payload_sha256, payload, evidence, correlation_id, created_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14::timestamptz
         ) returning *`,
        [
          artifactId,
          artifactRef,
          input.tenant_id,
          input.workspace_id,
          input.organization_id,
          input.content_item_id,
          input.version_id,
          capabilityId,
          idempotencyKey,
          payloadSha256,
          JSON.stringify(input.payload),
          JSON.stringify(evidence),
          input.correlation_id,
          now,
        ],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error('VIDEO_CONTENT_ARTIFACT_INSERT_FAILED');
      const artifact = artifactFromRow(row);
      await this.#outbox.enqueue(
        client,
        createDomainEvent({
          tenantId: input.tenant_id,
          workspaceId: input.workspace_id,
          organizationId: input.organization_id,
          eventKey: `${capabilityId}:${input.content_item_id}:${idempotencyKey}`,
          eventType: 'content.video_artifact.created',
          aggregateType: 'ContentItem',
          aggregateId: input.content_item_id,
          aggregateVersion: 1,
          correlationId: input.correlation_id,
          occurredAt: now,
          payload: {
            artifact_id: artifact.artifactId,
            artifact_ref: artifact.artifactRef,
            capability_id: capabilityId,
            version_id: input.version_id,
            payload_sha256: payloadSha256,
          },
          evidence,
        }),
      );
      await client.query('commit');
      return artifact;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async get(artifactRef: string): Promise<PersistedArtifact | undefined> {
    const result = await this.pool.query<ArtifactRow>(
      'select * from content_video_artifacts where artifact_ref = $1',
      [artifactRef],
    );
    const row = result.rows[0];
    return row ? artifactFromRow(row) : undefined;
  }
}

export class PostgresVideoContentRuntime implements VideoContentRuntimeService {
  readonly #contentStore: ContentItemStore;
  readonly #artifactStore: PostgresVideoArtifactStore;

  constructor(pool: pg.Pool) {
    const outbox = new PostgresTransactionalOutbox(pool);
    this.#contentStore = new PostgresContentItemStore(pool, { outbox });
    this.#artifactStore = new PostgresVideoArtifactStore(pool, outbox);
  }

  async execute(capabilityId: string, input: VideoContentRuntimeInput): Promise<unknown> {
    assertRuntimeCapability(capabilityId);
    await this.#assertScopeAndVersion(input);

    switch (capabilityId) {
      case 'content_item.version.create':
        return this.#derive(input, 'VERSION');
      case 'content_item.variant.create':
        return this.#derive(input, 'VARIANT');
      case 'content_item.channel.adapt':
        return this.#derive(input, 'CHANNEL_ADAPTATION');
      case 'content_item.language.localize':
        return this.#derive(input, 'LOCALIZATION');
      case 'content_item.event.link':
        return this.#linkEvent(input);
      case 'content_item.experiment.link':
        return this.#linkExperiment(input);
      case 'content_item.fact.validate':
        return validationResult(
          validateFactClaims(payloadArray<FactClaimCheck>(input, 'checks')),
          input,
        );
      case 'content_item.rights.validate':
        return validationResult(validateRights(payloadArray<RightsCheck>(input, 'checks')), input);
      case 'content_item.accessibility.validate':
        return validationResult(
          validateAccessibility(payloadObject<AccessibilityCheck>(input, 'check')),
          input,
        );
      case 'content.repurpose.plan':
        return this.#repurposePlan(input);
      case 'video.music_rights.validate':
        return validationResult(
          validateMusicRights(payloadObject<MusicRightsInput>(input, 'input')),
          input,
        );
      case 'video.safe_area.validate': {
        const result = validateSafeArea(
          payloadObject<VideoTimeline>(input, 'timeline'),
          payloadObject<SafeAreaPolicy>(input, 'policy'),
        );
        return {
          ...result,
          content_item_id: input.content_item_id,
          version_id: input.version_id,
          evidence: input.evidence,
        };
      }
      case 'video.duration.validate':
        return validationResult(
          validateDuration(
            payloadNumber(input, 'duration_ms'),
            payloadObject<DurationPolicy>(input, 'policy'),
          ),
          input,
        );
      case 'video.quality.validate': {
        const quality = validateVideoQuality(payloadArray<VideoGateResult>(input, 'gates'));
        return {
          ...quality,
          content_item_id: input.content_item_id,
          version_id: input.version_id,
          evidence: input.evidence,
        };
      }
      default:
        validateVideoWritePayload(capabilityId, input);
        return this.#artifactStore.put(capabilityId, input);
    }
  }

  async readback(
    capabilityId: string,
    result: unknown,
    input: VideoContentRuntimeInput,
  ): Promise<VideoContentRuntimeReadback> {
    if (!VIDEO_CONTENT_WRITE_CAPABILITY_IDS.has(capabilityId)) {
      return {
        verified: true,
        evidence: [`r29:readback:not-required:${capabilityId}`],
        externalResourceId: `toca://r29/content/${encodeURIComponent(input.content_item_id)}`,
      };
    }

    if (capabilityId.startsWith('content_item.')) {
      const item = await this.#contentStore.get(input.content_item_id);
      const contentRef = `toca://r29/content/${encodeURIComponent(input.content_item_id)}`;
      const record = asRecord(result);
      let verified = false;
      let externalResourceId = contentRef;

      if (
        capabilityId === 'content_item.version.create' ||
        capabilityId === 'content_item.variant.create' ||
        capabilityId === 'content_item.channel.adapt' ||
        capabilityId === 'content_item.language.localize'
      ) {
        const resultVersionId =
          typeof record.versionId === 'string' ? record.versionId.trim() : undefined;
        const versions = await this.#contentStore.listVersions(input.content_item_id);
        verified = Boolean(
          item &&
          resultVersionId &&
          item.currentVersionId === resultVersionId &&
          versions.some((version) => version.versionId === resultVersionId),
        );
        if (resultVersionId) {
          externalResourceId = `${contentRef}/versions/${encodeURIComponent(resultVersionId)}`;
        }
      } else if (capabilityId === 'content_item.event.link') {
        const targetEventId = optionalInputText(input.event_id ?? input.payload.event_id);
        verified = Boolean(item && targetEventId && item.eventId === targetEventId);
      } else if (capabilityId === 'content_item.experiment.link') {
        const targetExperimentId = optionalInputText(
          input.experiment_id ?? input.payload.experiment_id,
        );
        verified = Boolean(item && targetExperimentId && item.experimentId === targetExperimentId);
      }

      return {
        verified,
        evidence: [
          verified
            ? `r29:content:${input.content_item_id}:${capabilityId}:verified`
            : `r29:content:${input.content_item_id}:${capabilityId}:mismatch`,
        ],
        externalResourceId,
        ...(!verified ? { reason: 'R29_CONTENT_READBACK_MISMATCH' } : {}),
      };
    }

    const record = asRecord(result);
    const artifactRef = typeof record.artifactRef === 'string' ? record.artifactRef : undefined;
    if (!artifactRef) {
      return {
        verified: false,
        evidence: ['r29:artifact-ref:missing'],
        reason: 'R29_ARTIFACT_REF_REQUIRED',
      };
    }
    const artifact = await this.#artifactStore.get(artifactRef);
    const expectedSha = sha256(canonicalJson(input.payload));
    const verified =
      artifact?.capabilityId === capabilityId &&
      artifact.contentItemId === input.content_item_id &&
      artifact.versionId === input.version_id &&
      artifact.payloadSha256 === expectedSha;
    return {
      verified,
      evidence: [
        verified ? `r29:artifact:${artifactRef}:verified` : `r29:artifact:${artifactRef}:mismatch`,
      ],
      ...(verified
        ? { externalResourceId: artifactRef }
        : { reason: 'R29_ARTIFACT_READBACK_MISMATCH' }),
    };
  }

  async #assertScopeAndVersion(input: VideoContentRuntimeInput): Promise<void> {
    requireText(input.tenant_id, 'R29_TENANT_REQUIRED');
    requireText(input.workspace_id, 'R29_WORKSPACE_REQUIRED');
    requireText(input.organization_id, 'R29_ORGANIZATION_REQUIRED');
    requireText(input.content_item_id, 'R29_CONTENT_ITEM_REQUIRED');
    requireText(input.version_id, 'R29_VERSION_REQUIRED');
    requireText(input.correlation_id, 'R29_CORRELATION_REQUIRED');
    normalizeEvidence(input.evidence);
    const item = await this.#contentStore.get(input.content_item_id);
    if (!item) throw new Error('R29_CONTENT_ITEM_NOT_FOUND');
    if (
      item.tenantId !== input.tenant_id ||
      item.workspaceId !== input.workspace_id ||
      item.organizationId !== input.organization_id ||
      item.assignedRouteId !== 'R29'
    ) {
      throw new Error('R29_CONTENT_SCOPE_MISMATCH');
    }
    const versions = await this.#contentStore.listVersions(input.content_item_id);
    if (!versions.some((version) => version.versionId === input.version_id)) {
      throw new Error('R29_CONTENT_VERSION_NOT_FOUND');
    }
  }

  async #derive(
    input: VideoContentRuntimeInput,
    derivationType: 'VERSION' | 'VARIANT' | 'CHANNEL_ADAPTATION' | 'LOCALIZATION',
  ): Promise<ContentItemVersion> {
    const item = await this.#contentStore.get(input.content_item_id);
    if (!item) throw new Error('R29_CONTENT_ITEM_NOT_FOUND');
    const payload = input.payload as JsonValue;
    const versionId = payloadText(input, 'new_version_id');
    const sourceRefs = payloadStringArray(input, 'source_refs');
    const sourceAssetIds = optionalPayloadStringArray(input, 'source_asset_ids');
    const derivedAssetIds = optionalPayloadStringArray(input, 'derived_asset_ids');
    const variantKey = optionalPayloadText(input, 'variant_key');
    const channel =
      derivationType === 'CHANNEL_ADAPTATION'
        ? requireText(input.target_channel ?? '', 'R29_TARGET_CHANNEL_REQUIRED')
        : input.target_channel;
    const format =
      derivationType === 'CHANNEL_ADAPTATION' ? contentItemFormat(input.target_format) : undefined;
    const language =
      derivationType === 'LOCALIZATION'
        ? requireText(input.target_language ?? '', 'R29_TARGET_LANGUAGE_REQUIRED')
        : input.target_language;
    return this.#contentStore.createVersion({
      versionId,
      contentItemId: input.content_item_id,
      expectedRecordVersion: item.recordVersion,
      derivationType,
      sourceVersionId: input.version_id,
      ...(variantKey ? { variantKey } : {}),
      ...(channel ? { channel } : {}),
      ...(format ? { format } : {}),
      ...(language ? { language } : {}),
      ...(sourceAssetIds ? { sourceAssetIds } : {}),
      ...(derivedAssetIds ? { derivedAssetIds } : {}),
      payload,
      sourceRefs,
      idempotencyKey: runtimeIdempotencyKey(`content_item.${derivationType.toLowerCase()}`, input),
      correlationId: input.correlation_id,
      evidence: input.evidence,
    });
  }

  async #linkEvent(input: VideoContentRuntimeInput): Promise<unknown> {
    const item = await this.#contentStore.get(input.content_item_id);
    if (!item) throw new Error('R29_CONTENT_ITEM_NOT_FOUND');
    const targetId = requireText(
      input.event_id ?? payloadText(input, 'event_id'),
      'R29_EVENT_ID_REQUIRED',
    );
    return this.#contentStore.linkEvent({
      contentItemId: input.content_item_id,
      expectedRecordVersion: item.recordVersion,
      targetId,
      correlationId: input.correlation_id,
      evidence: input.evidence,
    });
  }

  async #linkExperiment(input: VideoContentRuntimeInput): Promise<unknown> {
    const item = await this.#contentStore.get(input.content_item_id);
    if (!item) throw new Error('R29_CONTENT_ITEM_NOT_FOUND');
    const targetId = requireText(
      input.experiment_id ?? payloadText(input, 'experiment_id'),
      'R29_EXPERIMENT_ID_REQUIRED',
    );
    return this.#contentStore.linkExperiment({
      contentItemId: input.content_item_id,
      expectedRecordVersion: item.recordVersion,
      targetId,
      correlationId: input.correlation_id,
      evidence: input.evidence,
    });
  }

  async #repurposePlan(input: VideoContentRuntimeInput): Promise<unknown> {
    const versions = await this.#contentStore.listVersions(input.content_item_id);
    const source = versions.find((version) => version.versionId === input.version_id);
    if (!source) throw new Error('R29_CONTENT_VERSION_NOT_FOUND');
    const destinations = payloadArray<{
      readonly channel: string;
      readonly format: ContentItemVersion['format'];
      readonly language: string;
      readonly variantKey: string;
    }>(input, 'destinations');
    return {
      status: 'READY',
      content_item_id: input.content_item_id,
      version_id: input.version_id,
      plan: planContentRepurpose(source, destinations),
      evidence: input.evidence,
    };
  }
}

function validateVideoWritePayload(capabilityId: string, input: VideoContentRuntimeInput): void {
  switch (capabilityId) {
    case 'video.brief.create':
      validateVideoBrief(payloadObject<VideoBrief>(input, 'brief'));
      break;
    case 'video.storyboard.generate':
      validateStoryboard(
        payloadArray<StoryboardScene>(input, 'scenes'),
        payloadNumber(input, 'target_duration_ms'),
      );
      break;
    case 'video.script.generate':
      validateScript(
        payloadArray<ScriptSegment>(input, 'segments'),
        payloadNumber(input, 'target_duration_ms'),
      );
      break;
    case 'video.asset.select':
      validateSelectedVideoAssets(payloadArray<SelectedVideoAsset>(input, 'assets'));
      break;
    case 'video.timeline.compose':
      validateTimeline(payloadObject<VideoTimeline>(input, 'timeline'));
      break;
    case 'video.subtitle.generate':
      validateSubtitleTrack(
        payloadObject<SubtitleTrack>(input, 'track'),
        payloadNumber(input, 'duration_ms'),
      );
      break;
    case 'video.audio.normalize':
      validateAudioNormalization(payloadObject<AudioNormalizationResult>(input, 'result'));
      break;
    case 'video.export.reel':
    case 'video.export.story': {
      const manifest = payloadObject<VideoExportManifest>(input, 'manifest');
      const approvalRef = requireText(input.approval_ref ?? '', 'R29_VIDEO_APPROVAL_REF_REQUIRED');
      if (manifest.approvalRef !== approvalRef) throw new Error('R29_VIDEO_APPROVAL_REF_MISMATCH');
      validateExportManifest(manifest);
      break;
    }
    case 'video.caption.embed':
      if (Object.keys(input.payload).length === 0)
        throw new Error('R29_VIDEO_ARTIFACT_PAYLOAD_REQUIRED');
      break;
    case 'video.thumbnail.generate':
      assertVideoThumbnailCreativeTruth(
        input.content_item_id,
        input.payload.creative_truth_manifest,
        payloadText(input, 'output_sha256'),
      );
      break;
    default:
      throw new Error(`R29_VIDEO_RUNTIME_UNHANDLED:${capabilityId}`);
  }
}

function validationResult(
  status: ContentValidationStatus,
  input: VideoContentRuntimeInput,
): unknown {
  return {
    status,
    content_item_id: input.content_item_id,
    version_id: input.version_id,
    evidence: input.evidence,
  };
}

function assertRuntimeCapability(capabilityId: string): void {
  if (!VIDEO_CONTENT_TECHNICAL_EXTENSION_CAPABILITY_SET.has(capabilityId)) {
    throw new Error(`R29_VIDEO_CAPABILITY_NOT_SUPPORTED:${capabilityId}`);
  }
}

export function runtimeIdempotencyKey(
  capabilityId: string,
  input: VideoContentRuntimeInput,
): string {
  const supplied = input.idempotency_key?.trim();
  if (supplied) return supplied;
  return `r29:${capabilityId}:${sha256(canonicalJson({ content_item_id: input.content_item_id, version_id: input.version_id, payload: input.payload }))}`;
}

function artifactFromRow(row: ArtifactRow): PersistedArtifact {
  return {
    artifactId: row.artifact_id,
    artifactRef: row.artifact_ref,
    contentItemId: row.content_item_id,
    versionId: row.version_id,
    capabilityId: row.capability_id,
    idempotencyKey: row.idempotency_key,
    payloadSha256: row.payload_sha256,
    payload: asRecord(row.payload),
    evidence: jsonStringArray(row.evidence),
    createdAt: timestamp(row.created_at),
  };
}

function payloadObject<T>(input: VideoContentRuntimeInput, key: string): T {
  const value = input.payload[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`R29_PAYLOAD_OBJECT_REQUIRED:${key}`);
  }
  return value as T;
}

function payloadArray<T>(input: VideoContentRuntimeInput, key: string): readonly T[] {
  const value = input.payload[key];
  if (!Array.isArray(value)) throw new Error(`R29_PAYLOAD_ARRAY_REQUIRED:${key}`);
  return value as readonly T[];
}

function payloadNumber(input: VideoContentRuntimeInput, key: string): number {
  const value = input.payload[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`R29_PAYLOAD_NUMBER_REQUIRED:${key}`);
  }
  return value;
}

function payloadText(input: VideoContentRuntimeInput, key: string): string {
  const value = input.payload[key];
  if (typeof value !== 'string') throw new Error(`R29_PAYLOAD_TEXT_REQUIRED:${key}`);
  return requireText(value, `R29_PAYLOAD_TEXT_REQUIRED:${key}`);
}

function optionalPayloadText(input: VideoContentRuntimeInput, key: string): string | undefined {
  const value = input.payload[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`R29_PAYLOAD_TEXT_INVALID:${key}`);
  return requireText(value, `R29_PAYLOAD_TEXT_INVALID:${key}`);
}

function payloadStringArray(input: VideoContentRuntimeInput, key: string): readonly string[] {
  const value = input.payload[key];
  if (!Array.isArray(value)) throw new Error(`R29_PAYLOAD_STRING_ARRAY_REQUIRED:${key}`);
  return normalizeEvidence(value.map((item) => (typeof item === 'string' ? item : '')));
}

function optionalPayloadStringArray(
  input: VideoContentRuntimeInput,
  key: string,
): readonly string[] | undefined {
  const value = input.payload[key];
  if (value === undefined || value === null) return undefined;
  return payloadStringArray(input, key);
}

function contentItemFormat(value: string | undefined): ContentItemFormat {
  const normalized = requireText(value ?? '', 'R29_TARGET_FORMAT_REQUIRED');
  if (!(CONTENT_ITEM_FORMATS as readonly string[]).includes(normalized)) {
    throw new Error('R29_TARGET_FORMAT_INVALID');
  }
  return normalized as ContentItemFormat;
}

function optionalInputText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeEvidence(value: readonly string[]): readonly string[] {
  const normalized = [...new Set(value.map((item) => item.trim()).filter(Boolean))].sort();
  if (normalized.length === 0) throw new Error('R29_EVIDENCE_REQUIRED');
  return normalized;
}

function jsonStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new Error('R29_DB_STRING_ARRAY_INVALID');
  return value.map((item) => {
    if (typeof item !== 'string') throw new Error('R29_DB_STRING_ARRAY_INVALID');
    return item;
  });
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Readonly<Record<string, unknown>>;
}

function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function timestamp(value: Date | string): string {
  const normalized = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  if (!Number.isFinite(Date.parse(normalized))) throw new Error('R29_DB_TIMESTAMP_INVALID');
  return normalized;
}
