import {
  photoToVideoSourceRightsSchema,
  photoToVideoStandardSchema,
  productVideoPolicySchema,
  sceneContinuationApprovalSchema,
  type PhotoToVideoOutputType,
  type PhotoToVideoRouteType,
  type PhotoToVideoSourceRights,
  type PhotoToVideoStandard,
  type ProductVideoPolicy,
  type SceneContinuationApproval,
} from '../../contracts/photo-to-video.js';
import type { BrandAsset, VenueAsset } from '../../contracts/creative-truth.js';
import { ExecutionError } from '../../core/errors.js';
import type { SpreadsheetValuesClient } from './media-assets.js';
import { GoogleSheetsCreativeTruthRegistry } from './creative-truth-registry.js';
import {
  GoogleSheetsThePartyContentOrchestration,
  type ThePartyContentOrchestrationRecord,
} from './the-party-content-orchestration.js';

export const PHOTO_TO_VIDEO_CREATIVE_TRUTH_REGISTRY_ID =
  '1bqF5zN5Lhesy_uls6gHMkOT-KLFRGo81OJMB_LPwXaU' as const;
export const PHOTO_TO_VIDEO_CONTENT_REGISTRY_ID =
  '1r02HLhmnTijFNkmZv4o1yeZPxCEUMXZC_QreDFB6yTw' as const;

const PRODUCT_POLICIES_RANGE = 'PRODUCT_VISUAL_POLICIES!A1:I1000';
const VIDEO_STANDARDS_RANGE = 'VIDEO_CREATIVE_STANDARDS!A1:N1000';
const VIDEO_RIGHTS_RANGE = 'VIDEO_SOURCE_RIGHTS!A1:I2000';
const VIDEO_EXCEPTIONS_RANGE = 'VIDEO_GENERATIVE_EXCEPTIONS!A1:Q1000';
const VIDEO_OUTPUTS_RANGE = 'VIDEO_OUTPUTS!A1:T5000';
const CONTENT_RANGE = 'CONTENT_ITEMS!A1:CF2000';
const APPROVED_RIGHTS = new Set(['OWNED', 'LICENSED', 'CLEARED', 'RIGHTS_CLEARED']);

export interface PhotoToVideoContentContext {
  readonly contentItemId: string;
  readonly productId: string;
  readonly operation: string;
  readonly outputType: PhotoToVideoOutputType;
  readonly inheritedVisualStandardId: string;
  readonly sourceAssetId: string;
  readonly thePartyContext?: ThePartyContentOrchestrationRecord;
}

export interface ResolvedPhotoToVideoContext {
  readonly content: PhotoToVideoContentContext;
  readonly productPolicy: ProductVideoPolicy;
  readonly standard: PhotoToVideoStandard;
  readonly venueAsset: VenueAsset;
  readonly rights: PhotoToVideoSourceRights;
  readonly approval?: SceneContinuationApproval;
}

export interface PhotoToVideoOutputEvidenceRecord {
  readonly outputId: string;
  readonly contentItemId: string;
  readonly productId: string;
  readonly operation: string;
  readonly routeType: PhotoToVideoRouteType;
  readonly standardId: string;
  readonly sourceAssetId: string;
  readonly sourceSha256: string;
  readonly outputSha256: string;
  readonly reviewer: string;
  readonly reviewedAt: string;
  readonly venueFidelity: 'PASS';
  readonly brandIntegrity: 'PASS';
  readonly quality: 'PASS';
  readonly sceneContinuationFidelity: 'PASS' | 'NOT_APPLICABLE';
  readonly status: 'VIDEO_CREATIVE_TRUTH_PASSED';
  readonly finalizedAt: string;
  readonly reviewMethod: 'HUMAN' | 'MULTIMODAL_PLUS_HUMAN';
  readonly reviewEvidenceRef: string;
  readonly sourceImageCompared: true;
}

export interface PhotoToVideoRegistry {
  resolve(
    contentItemId: string,
    routeType: PhotoToVideoRouteType,
  ): Promise<ResolvedPhotoToVideoContext>;
  getBrandAsset(brand: string, variant: string): Promise<BrandAsset | undefined>;
  recordFinalOutput(record: PhotoToVideoOutputEvidenceRecord): Promise<void>;
}

export class GoogleSheetsPhotoToVideoRegistry implements PhotoToVideoRegistry {
  private readonly base: GoogleSheetsCreativeTruthRegistry;
  private readonly party: GoogleSheetsThePartyContentOrchestration;

  constructor(
    private readonly client: SpreadsheetValuesClient,
    private readonly creativeTruthSpreadsheetId = PHOTO_TO_VIDEO_CREATIVE_TRUTH_REGISTRY_ID,
    private readonly contentSpreadsheetId = PHOTO_TO_VIDEO_CONTENT_REGISTRY_ID,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.base = new GoogleSheetsCreativeTruthRegistry(client, {
      spreadsheetId: creativeTruthSpreadsheetId,
    });
    this.party = new GoogleSheetsThePartyContentOrchestration(client, {
      spreadsheetId: contentSpreadsheetId,
    });
  }

  async resolve(
    contentItemId: string,
    routeType: PhotoToVideoRouteType,
  ): Promise<ResolvedPhotoToVideoContext> {
    const content = await this.resolveContent(contentItemId);
    const [productPolicy, standard, venueAsset, rights] = await Promise.all([
      this.resolveProductPolicy(content.productId, content.operation),
      this.resolveStandard(content, routeType),
      this.resolveVenueAsset(content),
      this.resolveRights(content.sourceAssetId, content.operation),
    ]);

    if (routeType === 'REAL_PHOTO_TO_MOTION_VIDEO' && !productPolicy.photoMotionAllowed) {
      deny('PHOTO_TO_VIDEO_ROUTE_NOT_ALLOWED');
    }
    if (
      routeType === 'GENERATIVE_SCENE_CONTINUATION_VIDEO' &&
      !productPolicy.sceneContinuationAllowed
    ) {
      deny('SCENE_CONTINUATION_ROUTE_NOT_ALLOWED');
    }
    assertRights(rights, routeType);
    assertSourceAsset(venueAsset, content);

    let effectiveContent = content;
    if (content.operation === 'THE_PARTY') {
      const partyContext = await this.party.get(content.contentItemId);
      if (partyContext.standardId !== content.inheritedVisualStandardId) {
        deny('PHOTO_TO_VIDEO_THE_PARTY_STANDARD_MISMATCH');
      }
      if (partyContext.visualStandardStatus === 'BLOCKED_NEEDS_ENVIRONMENT') {
        deny('THE_PARTY_ENVIRONMENT_REQUIRED');
      }
      effectiveContent = { ...content, thePartyContext: partyContext };
    }

    let approval: SceneContinuationApproval | undefined;
    if (routeType === 'GENERATIVE_SCENE_CONTINUATION_VIDEO') {
      approval = await this.resolveApproval(effectiveContent, venueAsset, rights);
    }

    return {
      content: effectiveContent,
      productPolicy,
      standard,
      venueAsset,
      rights,
      ...(approval ? { approval } : {}),
    };
  }

  getBrandAsset(brand: string, variant: string): Promise<BrandAsset | undefined> {
    return this.base.getBrandAsset(brand, variant);
  }

  async recordFinalOutput(record: PhotoToVideoOutputEvidenceRecord): Promise<void> {
    const rows = await this.client.readRange(this.creativeTruthSpreadsheetId, VIDEO_OUTPUTS_RANGE);
    const headers = headersFor(rows, 'VIDEO_OUTPUTS_SCHEMA_INVALID');
    const contentIndex = requireHeader(headers, 'content_item_id', 'VIDEO_OUTPUTS_SCHEMA_INVALID');
    const routeIndex = requireHeader(headers, 'route_type', 'VIDEO_OUTPUTS_SCHEMA_INVALID');
    const shaIndex = requireHeader(headers, 'output_sha256', 'VIDEO_OUTPUTS_SCHEMA_INVALID');
    const statusIndex = requireHeader(headers, 'status', 'VIDEO_OUTPUTS_SCHEMA_INVALID');
    requireHeader(headers, 'review_method', 'VIDEO_OUTPUTS_SCHEMA_INVALID');
    requireHeader(headers, 'review_evidence_ref', 'VIDEO_OUTPUTS_SCHEMA_INVALID');
    requireHeader(headers, 'source_image_compared', 'VIDEO_OUTPUTS_SCHEMA_INVALID');
    const matches = rows
      .slice(1)
      .filter(
        (row) =>
          cell(row[contentIndex]) === record.contentItemId &&
          cell(row[routeIndex]) === record.routeType &&
          cell(row[statusIndex]) === 'VIDEO_CREATIVE_TRUTH_PASSED',
      );
    if (
      matches.some((row) => cell(row[shaIndex]).toLowerCase() === record.outputSha256.toLowerCase())
    ) {
      return;
    }
    if (matches.length > 0) {
      throw new ExecutionError(
        'STATE_CONFLICT',
        'VIDEO_OUTPUT_DIFFERENT_FINAL_ASSET_ALREADY_RECORDED',
        false,
      );
    }
    await this.client.appendRow(this.creativeTruthSpreadsheetId, 'VIDEO_OUTPUTS!A:T', [
      record.outputId,
      record.contentItemId,
      record.productId,
      record.operation,
      record.routeType,
      record.standardId,
      record.sourceAssetId,
      record.sourceSha256,
      record.outputSha256,
      record.reviewer,
      record.reviewedAt,
      record.venueFidelity,
      record.brandIntegrity,
      record.quality,
      record.sceneContinuationFidelity,
      record.status,
      record.finalizedAt,
      record.reviewMethod,
      record.reviewEvidenceRef,
      record.sourceImageCompared ? 'TRUE' : 'FALSE',
    ]);
  }

  private async resolveContent(contentItemId: string): Promise<PhotoToVideoContentContext> {
    const normalized = contentItemId.trim();
    if (!normalized) deny('PHOTO_TO_VIDEO_CONTENT_ITEM_ID_REQUIRED');
    const rows = await this.client.readRange(this.contentSpreadsheetId, CONTENT_RANGE);
    const headers = headersFor(rows, 'PHOTO_TO_VIDEO_CONTENT_SCHEMA_INVALID');
    const idIndex = requireHeader(
      headers,
      'content_item_id',
      'PHOTO_TO_VIDEO_CONTENT_SCHEMA_INVALID',
    );
    const matches = rows.slice(1).filter((row) => cell(row[idIndex]) === normalized);
    if (matches.length !== 1) {
      deny(
        matches.length === 0
          ? 'PHOTO_TO_VIDEO_CONTENT_ITEM_NOT_FOUND'
          : 'PHOTO_TO_VIDEO_CONTENT_ITEM_AMBIGUOUS',
      );
    }
    const row = matches[0]!;
    const value = (name: string) => {
      const index = headers.get(name);
      return index === undefined ? '' : cell(row[index]);
    };
    const operation = value('operation');
    const format = value('format').toUpperCase();
    const sourceAssetId = value('source_asset_id');
    const inheritedVisualStandardId = value('creative_standard_id');
    const productId = value('video_product_id') || operation;
    if (!operation || !sourceAssetId || !inheritedVisualStandardId || !productId) {
      deny('PHOTO_TO_VIDEO_CONTENT_BINDING_INCOMPLETE');
    }
    const outputType = normalizeOutputType(format);
    return {
      contentItemId: normalized,
      productId,
      operation,
      outputType,
      inheritedVisualStandardId,
      sourceAssetId,
    };
  }

  private async resolveProductPolicy(
    productId: string,
    operation: string,
  ): Promise<ProductVideoPolicy> {
    const rows = await this.client.readRange(
      this.creativeTruthSpreadsheetId,
      PRODUCT_POLICIES_RANGE,
    );
    const headers = headersFor(rows, 'PRODUCT_VISUAL_POLICIES_SCHEMA_INVALID');
    const parsed = rows.slice(1).flatMap((row) => {
      const raw = objectFromRow(row, headers);
      if (raw.product_id !== productId || raw.operation !== operation || raw.status !== 'ACTIVE') {
        return [];
      }
      const result = productVideoPolicySchema.safeParse({
        productId: raw.product_id,
        operation: raw.operation,
        displayName: raw.display_name,
        photoMotionAllowed: bool(raw.photo_motion_allowed),
        sceneContinuationAllowed: bool(raw.scene_continuation_allowed),
        heroBrand: raw.hero_brand,
        heroBrandVariant: raw.hero_brand_variant,
        futureProductRuntimeMode: raw.future_product_runtime_mode,
        status: raw.status,
      });
      return result.success ? [result.data] : [];
    });
    if (parsed.length !== 1) deny('PRODUCT_VISUAL_POLICY_NOT_RESOLVED');
    return parsed[0]!;
  }

  private async resolveStandard(
    content: PhotoToVideoContentContext,
    routeType: PhotoToVideoRouteType,
  ): Promise<PhotoToVideoStandard> {
    const rows = await this.client.readRange(
      this.creativeTruthSpreadsheetId,
      VIDEO_STANDARDS_RANGE,
    );
    const headers = headersFor(rows, 'VIDEO_CREATIVE_STANDARDS_SCHEMA_INVALID');
    const matches = rows.slice(1).flatMap((row) => {
      const raw = objectFromRow(row, headers);
      if (
        raw.product_id !== content.productId ||
        raw.operation !== content.operation ||
        raw.output_type !== content.outputType ||
        raw.route_type !== routeType ||
        raw.status !== 'ACTIVE_CANONICAL'
      ) {
        return [];
      }
      const parsed = photoToVideoStandardSchema.safeParse({
        standardId: raw.standard_id,
        version: raw.version,
        productId: raw.product_id,
        operation: raw.operation,
        channel: raw.channel,
        outputType: raw.output_type,
        routeType: raw.route_type,
        size: raw.size,
        seconds: integer(raw.seconds),
        motionPreset: raw.motion_preset,
        brandPosition: raw.brand_position,
        inheritsContentVisualStandard: bool(raw.inherits_content_visual_standard),
        exactAssetBindingRequired: bool(raw.exact_asset_binding_required),
        status: raw.status,
      });
      return parsed.success ? [parsed.data] : [];
    });
    if (matches.length !== 1) deny('PHOTO_TO_VIDEO_STANDARD_NOT_RESOLVED');
    return matches[0]!;
  }

  private async resolveVenueAsset(content: PhotoToVideoContentContext): Promise<VenueAsset> {
    const venue = await this.base.getVenueAssetBySourceAssetId(content.sourceAssetId);
    if (!venue) deny('PHOTO_TO_VIDEO_SOURCE_VENUE_ASSET_NOT_FOUND');
    return venue;
  }

  private async resolveRights(
    sourceAssetId: string,
    operation: string,
  ): Promise<PhotoToVideoSourceRights> {
    const rows = await this.client.readRange(this.creativeTruthSpreadsheetId, VIDEO_RIGHTS_RANGE);
    const headers = headersFor(rows, 'VIDEO_SOURCE_RIGHTS_SCHEMA_INVALID');
    const matches = rows.slice(1).flatMap((row) => {
      const raw = objectFromRow(row, headers);
      if (
        raw.source_asset_id !== sourceAssetId ||
        raw.operation !== operation ||
        raw.status !== 'ACTIVE'
      ) {
        return [];
      }
      const parsed = photoToVideoSourceRightsSchema.safeParse({
        sourceAssetId: raw.source_asset_id,
        operation: raw.operation,
        rightsStatus: raw.rights_status,
        containsPeople: bool(raw.contains_people),
        likenessConsentStatus: raw.likeness_consent_status,
        approvedUses: splitPipe(raw.approved_uses),
        ...(raw.evidence_ref ? { evidenceRef: raw.evidence_ref } : {}),
        status: raw.status,
        ...(raw.validated_at ? { validatedAt: raw.validated_at } : {}),
      });
      return parsed.success ? [parsed.data] : [];
    });
    if (matches.length !== 1) deny('VIDEO_SOURCE_RIGHTS_NOT_CLEARED');
    return matches[0]!;
  }

  private async resolveApproval(
    content: PhotoToVideoContentContext,
    venueAsset: VenueAsset,
    rights: PhotoToVideoSourceRights,
  ): Promise<SceneContinuationApproval> {
    const rows = await this.client.readRange(
      this.creativeTruthSpreadsheetId,
      VIDEO_EXCEPTIONS_RANGE,
    );
    const headers = headersFor(rows, 'VIDEO_GENERATIVE_EXCEPTIONS_SCHEMA_INVALID');
    const matches = rows.slice(1).flatMap((row) => {
      const raw = objectFromRow(row, headers);
      if (raw.content_item_id !== content.contentItemId || raw.status !== 'APPROVED') return [];
      const parsed = sceneContinuationApprovalSchema.safeParse({
        exceptionId: raw.exception_id,
        contentItemId: raw.content_item_id,
        productId: raw.product_id,
        operation: raw.operation,
        sourceAssetId: raw.source_asset_id,
        sourceSha256: raw.source_sha256,
        requestedBy: raw.requested_by,
        approvedBy: raw.approved_by,
        approvalRef: raw.approval_ref,
        allowSceneContinuation: bool(raw.allow_scene_continuation),
        allowEnvironmentExpansion: bool(raw.allow_environment_expansion),
        allowArchitecturalInvention: bool(raw.allow_architectural_invention),
        allowAiLogoGeneration: bool(raw.allow_ai_logo_generation),
        peopleConsentConfirmed: bool(raw.people_consent_confirmed),
        status: raw.status,
        ...(raw.expires_at ? { expiresAt: raw.expires_at } : {}),
        createdAt: raw.created_at,
      });
      return parsed.success ? [parsed.data] : [];
    });
    if (matches.length !== 1) {
      throw new ExecutionError(
        'APPROVAL_REQUIRED',
        'VIDEO_SCENE_CONTINUATION_APPROVAL_REQUIRED',
        false,
      );
    }
    const approval = matches[0]!;
    const masterSha = venueAsset.masterSha256?.toLowerCase();
    if (
      !masterSha ||
      approval.productId !== content.productId ||
      approval.operation !== content.operation ||
      approval.sourceAssetId !== content.sourceAssetId ||
      approval.sourceSha256.toLowerCase() !== masterSha ||
      approval.allowArchitecturalInvention ||
      approval.allowAiLogoGeneration ||
      (rights.containsPeople &&
        (!approval.peopleConsentConfirmed || rights.likenessConsentStatus !== 'CONFIRMED'))
    ) {
      throw new ExecutionError(
        'APPROVAL_REQUIRED',
        'VIDEO_SCENE_CONTINUATION_APPROVAL_BINDING_MISMATCH',
        false,
      );
    }
    if (approval.expiresAt) {
      const expiry = Date.parse(approval.expiresAt);
      const current = trustedNowMillis(this.now);
      if (!Number.isFinite(expiry) || current >= expiry) {
        throw new ExecutionError(
          'APPROVAL_REQUIRED',
          'VIDEO_SCENE_CONTINUATION_APPROVAL_EXPIRED',
          false,
        );
      }
    }
    return approval;
  }
}

function assertSourceAsset(venue: VenueAsset, content: PhotoToVideoContentContext): void {
  if (
    venue.sourceAssetId !== content.sourceAssetId ||
    venue.operation !== content.operation ||
    !venue.venueVerified ||
    !venue.marketingReady ||
    venue.status !== 'ACTIVE_APPROVED' ||
    !venue.masterAssetId ||
    !venue.masterDriveFileId ||
    !venue.masterSha256
  ) {
    deny('PHOTO_TO_VIDEO_MARKETING_READY_SOURCE_REQUIRED');
  }
}

function assertRights(rights: PhotoToVideoSourceRights, routeType: PhotoToVideoRouteType): void {
  if (rights.status !== 'ACTIVE' || !APPROVED_RIGHTS.has(rights.rightsStatus)) {
    deny('VIDEO_SOURCE_RIGHTS_NOT_CLEARED');
  }
  const requiredUse =
    routeType === 'REAL_PHOTO_TO_MOTION_VIDEO' ? 'PHOTO_TO_MOTION' : 'SCENE_CONTINUATION';
  if (!rights.approvedUses.includes(requiredUse)) deny('VIDEO_SOURCE_USE_NOT_APPROVED');
  if (
    routeType === 'GENERATIVE_SCENE_CONTINUATION_VIDEO' &&
    rights.containsPeople &&
    rights.likenessConsentStatus !== 'CONFIRMED'
  ) {
    deny('VIDEO_LIKENESS_CONSENT_REQUIRED');
  }
}

function normalizeOutputType(value: string): PhotoToVideoOutputType {
  if (value === 'STORY' || value === 'STORIES') return 'STORY';
  if (value === 'REEL' || value === 'REELS' || value === 'VIDEO') return 'REEL';
  deny('PHOTO_TO_VIDEO_OUTPUT_TYPE_UNSUPPORTED');
}

function headersFor(
  rows: readonly (readonly unknown[])[],
  error: string,
): ReadonlyMap<string, number> {
  if (rows.length === 0) deny(error);
  const map = new Map<string, number>();
  for (const [index, value] of (rows[0] ?? []).entries()) {
    const key = cell(value).toLowerCase();
    if (!key) continue;
    if (map.has(key)) deny(error);
    map.set(key, index);
  }
  return map;
}

function requireHeader(headers: ReadonlyMap<string, number>, name: string, error: string): number {
  const index = headers.get(name);
  if (index === undefined) deny(`${error}:${name}`);
  return index;
}

function objectFromRow(
  row: readonly unknown[],
  headers: ReadonlyMap<string, number>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, index] of headers.entries()) result[name] = cell(row[index]);
  return result;
}

function cell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value).trim();
  }
  throw new Error(`Unsupported spreadsheet value type: ${typeof value}`);
}

function bool(value: unknown): boolean {
  return ['true', '1', 'yes', 'sim'].includes(cell(value).toLowerCase());
}

function integer(value: unknown): number {
  const parsed = Number.parseInt(cell(value), 10);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function splitPipe(value: unknown): string[] {
  return cell(value)
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
}

function trustedNowMillis(now: () => Date): number {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new ExecutionError('POLICY_DENIED', 'PHOTO_TO_VIDEO_TRUSTED_CLOCK_INVALID', false);
  }
  return value.getTime();
}

function deny(message: string): never {
  throw new ExecutionError('POLICY_DENIED', message, false);
}
