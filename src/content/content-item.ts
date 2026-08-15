import type { RouteId } from '../governance/types.js';

export const CONTENT_ITEM_STATES = [
  'PLANNED',
  'BRIEFED',
  'IN_PRODUCTION',
  'REVIEW',
  'APPROVED',
  'READY_FOR_SCHEDULING',
  'SCHEDULED',
  'PUBLISHED',
  'MEASURED',
  'ARCHIVED',
  'CANCELED',
] as const;
export type ContentItemState = (typeof CONTENT_ITEM_STATES)[number];

export const CONTENT_ITEM_FORMATS = [
  'SINGLE_IMAGE',
  'CAROUSEL',
  'STORY',
  'REEL',
  'AD_CREATIVE',
  'VIDEO',
] as const;
export type ContentItemFormat = (typeof CONTENT_ITEM_FORMATS)[number];

export const CONTENT_DERIVATION_TYPES = [
  'ORIGINAL',
  'VERSION',
  'VARIANT',
  'CHANNEL_ADAPTATION',
  'LOCALIZATION',
  'REPURPOSE',
] as const;
export type ContentDerivationType = (typeof CONTENT_DERIVATION_TYPES)[number];

export const CONTENT_VALIDATION_TYPES = [
  'FACT',
  'RIGHTS',
  'ACCESSIBILITY',
  'QUALITY',
  'SAFE_AREA',
  'DURATION',
  'MUSIC_RIGHTS',
] as const;
export type ContentValidationType = (typeof CONTENT_VALIDATION_TYPES)[number];

export const CONTENT_VALIDATION_STATUSES = ['PASS', 'FAIL', 'REVIEW_REQUIRED'] as const;
export type ContentValidationStatus = (typeof CONTENT_VALIDATION_STATUSES)[number];

export const CONTENT_RIGHTS_STATUSES = [
  'OWNED',
  'LICENSED',
  'CONSENTED',
  'PUBLIC_DOMAIN',
  'ROYALTY_FREE',
  'ORIGINAL',
  'UNKNOWN',
  'RESTRICTED',
  'EXPIRED',
] as const;
export type ContentRightsStatus = (typeof CONTENT_RIGHTS_STATUSES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface ContentItem {
  readonly contentItemId: string;
  readonly contentKey: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly assignedRouteId: RouteId;
  readonly productRef: string | null;
  readonly slotRef: string | null;
  readonly channel: string;
  readonly format: ContentItemFormat;
  readonly language: string;
  readonly state: ContentItemState;
  readonly currentContentVersion: number;
  readonly currentVersionId: string;
  readonly eventId: string | null;
  readonly experimentId: string | null;
  readonly recordVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ContentItemVersion {
  readonly versionId: string;
  readonly contentItemId: string;
  readonly versionNumber: number;
  readonly idempotencyKey: string;
  readonly derivationType: ContentDerivationType;
  readonly parentVersionId: string | null;
  readonly sourceVersionId: string | null;
  readonly lineageRootVersionId: string;
  readonly variantKey: string | null;
  readonly channel: string;
  readonly format: ContentItemFormat;
  readonly language: string;
  readonly sourceAssetIds: readonly string[];
  readonly derivedAssetIds: readonly string[];
  readonly payload: JsonValue;
  readonly sourceRefs: readonly string[];
  readonly evidence: readonly string[];
  readonly createdAt: string;
}

export interface ContentItemValidation {
  readonly validationId: string;
  readonly contentItemId: string;
  readonly versionId: string;
  readonly validationType: ContentValidationType;
  readonly status: ContentValidationStatus;
  readonly issues: readonly string[];
  readonly evidence: readonly string[];
  readonly details: JsonValue;
  readonly createdAt: string;
}

export interface CreateContentItemInput {
  readonly contentItemId: string;
  readonly contentKey: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly assignedRouteId?: RouteId;
  readonly productRef?: string | null;
  readonly slotRef?: string | null;
  readonly channel: string;
  readonly format: ContentItemFormat;
  readonly language: string;
  readonly initialVersionId: string;
  readonly sourceAssetIds?: readonly string[];
  readonly derivedAssetIds?: readonly string[];
  readonly payload?: JsonValue;
  readonly sourceRefs: readonly string[];
  readonly eventId?: string | null;
  readonly experimentId?: string | null;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly evidence: readonly string[];
  readonly now?: string;
}

export interface CreateContentItemVersionInput {
  readonly versionId: string;
  readonly contentItemId: string;
  readonly expectedRecordVersion: number;
  readonly derivationType: Exclude<ContentDerivationType, 'ORIGINAL'>;
  readonly sourceVersionId: string;
  readonly parentVersionId?: string | null;
  readonly variantKey?: string | null;
  readonly channel?: string;
  readonly format?: ContentItemFormat;
  readonly language?: string;
  readonly sourceAssetIds?: readonly string[];
  readonly derivedAssetIds?: readonly string[];
  readonly payload: JsonValue;
  readonly sourceRefs: readonly string[];
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly evidence: readonly string[];
  readonly now?: string;
}

export interface ContentLinkInput {
  readonly contentItemId: string;
  readonly expectedRecordVersion: number;
  readonly targetId: string;
  readonly correlationId: string;
  readonly evidence: readonly string[];
  readonly now?: string;
}

export interface TransitionContentItemInput {
  readonly contentItemId: string;
  readonly expectedRecordVersion: number;
  readonly state: ContentItemState;
  readonly correlationId: string;
  readonly evidence: readonly string[];
  readonly now?: string;
}

export interface RecordContentValidationInput {
  readonly validationId: string;
  readonly contentItemId: string;
  readonly versionId: string;
  readonly validationType: ContentValidationType;
  readonly status: ContentValidationStatus;
  readonly issues?: readonly string[];
  readonly details?: JsonValue;
  readonly evidence: readonly string[];
  readonly correlationId: string;
  readonly now?: string;
}

export interface ContentItemStore {
  create(input: CreateContentItemInput): Promise<ContentItem>;
  get(contentItemId: string): Promise<ContentItem | undefined>;
  createVersion(input: CreateContentItemVersionInput): Promise<ContentItemVersion>;
  listVersions(contentItemId: string): Promise<readonly ContentItemVersion[]>;
  transitionState(input: TransitionContentItemInput): Promise<ContentItem>;
  linkEvent(input: ContentLinkInput): Promise<ContentItem>;
  linkExperiment(input: ContentLinkInput): Promise<ContentItem>;
  recordValidation(input: RecordContentValidationInput): Promise<ContentItemValidation>;
}

const CONTENT_ITEM_STATE_TRANSITIONS: Readonly<
  Record<ContentItemState, readonly ContentItemState[]>
> = {
  PLANNED: ['BRIEFED', 'CANCELED'],
  BRIEFED: ['IN_PRODUCTION', 'CANCELED'],
  IN_PRODUCTION: ['REVIEW', 'CANCELED'],
  REVIEW: ['IN_PRODUCTION', 'APPROVED', 'CANCELED'],
  APPROVED: ['IN_PRODUCTION', 'READY_FOR_SCHEDULING', 'CANCELED'],
  READY_FOR_SCHEDULING: ['SCHEDULED', 'CANCELED'],
  SCHEDULED: ['READY_FOR_SCHEDULING', 'PUBLISHED', 'CANCELED'],
  PUBLISHED: ['MEASURED', 'ARCHIVED'],
  MEASURED: ['ARCHIVED'],
  ARCHIVED: [],
  CANCELED: ['ARCHIVED'],
};

export function assertContentItemStateTransition(
  current: ContentItemState,
  next: ContentItemState,
): void {
  if (current === next) return;
  if (!CONTENT_ITEM_STATE_TRANSITIONS[current].includes(next)) {
    throw new Error(`CONTENT_ITEM_STATE_TRANSITION_INVALID:${current}:${next}`);
  }
}

export function validateContentItem(item: ContentItem): void {
  requireText(item.contentItemId, 'CONTENT_ITEM_ID_REQUIRED');
  requireText(item.contentKey, 'CONTENT_ITEM_KEY_REQUIRED');
  requireText(item.tenantId, 'CONTENT_ITEM_TENANT_REQUIRED');
  requireText(item.workspaceId, 'CONTENT_ITEM_WORKSPACE_REQUIRED');
  requireText(item.organizationId, 'CONTENT_ITEM_ORGANIZATION_REQUIRED');
  requireText(item.assignedRouteId, 'CONTENT_ITEM_ROUTE_REQUIRED');
  requireText(item.channel, 'CONTENT_ITEM_CHANNEL_REQUIRED');
  requireText(item.language, 'CONTENT_ITEM_LANGUAGE_REQUIRED');
  requireText(item.currentVersionId, 'CONTENT_ITEM_CURRENT_VERSION_REQUIRED');
  if (!(CONTENT_ITEM_FORMATS as readonly string[]).includes(item.format)) {
    throw new Error('CONTENT_ITEM_FORMAT_INVALID');
  }
  if (!(CONTENT_ITEM_STATES as readonly string[]).includes(item.state)) {
    throw new Error('CONTENT_ITEM_STATE_INVALID');
  }
  assertPositiveInteger(item.currentContentVersion, 'CONTENT_ITEM_CONTENT_VERSION_INVALID');
  assertPositiveInteger(item.recordVersion, 'CONTENT_ITEM_RECORD_VERSION_INVALID');
  if (item.productRef !== null) requireText(item.productRef, 'CONTENT_ITEM_PRODUCT_REF_INVALID');
  if (item.slotRef !== null) requireText(item.slotRef, 'CONTENT_ITEM_SLOT_REF_INVALID');
  if (item.eventId !== null) requireText(item.eventId, 'CONTENT_ITEM_EVENT_ID_INVALID');
  if (item.experimentId !== null)
    requireText(item.experimentId, 'CONTENT_ITEM_EXPERIMENT_ID_INVALID');
  assertTimestamp(item.createdAt, 'CONTENT_ITEM_CREATED_AT_INVALID');
  assertTimestamp(item.updatedAt, 'CONTENT_ITEM_UPDATED_AT_INVALID');
}

export function validateContentItemVersion(version: ContentItemVersion): void {
  requireText(version.versionId, 'CONTENT_VERSION_ID_REQUIRED');
  requireText(version.contentItemId, 'CONTENT_VERSION_ITEM_ID_REQUIRED');
  assertPositiveInteger(version.versionNumber, 'CONTENT_VERSION_NUMBER_INVALID');
  requireText(version.idempotencyKey, 'CONTENT_VERSION_IDEMPOTENCY_KEY_REQUIRED');
  if (!(CONTENT_DERIVATION_TYPES as readonly string[]).includes(version.derivationType)) {
    throw new Error('CONTENT_VERSION_DERIVATION_INVALID');
  }
  if (version.parentVersionId !== null)
    requireText(version.parentVersionId, 'CONTENT_VERSION_PARENT_INVALID');
  if (version.sourceVersionId !== null)
    requireText(version.sourceVersionId, 'CONTENT_VERSION_SOURCE_INVALID');
  requireText(version.lineageRootVersionId, 'CONTENT_VERSION_LINEAGE_ROOT_REQUIRED');
  if (version.variantKey !== null)
    requireText(version.variantKey, 'CONTENT_VERSION_VARIANT_KEY_INVALID');
  requireText(version.channel, 'CONTENT_VERSION_CHANNEL_REQUIRED');
  requireText(version.language, 'CONTENT_VERSION_LANGUAGE_REQUIRED');
  normalizeStringSet(version.sourceAssetIds, 'CONTENT_VERSION_SOURCE_ASSET_INVALID');
  normalizeStringSet(version.derivedAssetIds, 'CONTENT_VERSION_DERIVED_ASSET_INVALID');
  normalizeStringSet(version.sourceRefs, 'CONTENT_VERSION_SOURCE_REF_INVALID');
  requireEvidence(version.evidence);
  assertJsonSerializable(version.payload, 'CONTENT_VERSION_PAYLOAD_INVALID');
  assertTimestamp(version.createdAt, 'CONTENT_VERSION_CREATED_AT_INVALID');

  if (version.derivationType === 'ORIGINAL') {
    if (version.versionNumber !== 1 || version.parentVersionId !== null || version.sourceVersionId !== null) {
      throw new Error('CONTENT_VERSION_ORIGINAL_LINEAGE_INVALID');
    }
    if (version.lineageRootVersionId !== version.versionId) {
      throw new Error('CONTENT_VERSION_ORIGINAL_ROOT_INVALID');
    }
  } else if (version.sourceVersionId === null) {
    throw new Error('CONTENT_VERSION_DERIVATION_SOURCE_REQUIRED');
  }
}

export function requireEvidence(evidence: readonly string[]): readonly string[] {
  const normalized = normalizeStringSet(evidence, 'CONTENT_EVIDENCE_INVALID');
  if (normalized.length === 0) throw new Error('CONTENT_EVIDENCE_REQUIRED');
  return normalized;
}

export interface FactClaimCheck {
  readonly claimId: string;
  readonly expected: JsonPrimitive;
  readonly observed: JsonPrimitive;
  readonly sourceRefs: readonly string[];
}

export function validateFactClaims(checks: readonly FactClaimCheck[]): ContentValidationStatus {
  if (checks.length === 0) return 'REVIEW_REQUIRED';
  let failed = false;
  for (const check of checks) {
    requireText(check.claimId, 'CONTENT_FACT_CLAIM_ID_REQUIRED');
    if (normalizeStringSet(check.sourceRefs, 'CONTENT_FACT_SOURCE_REF_INVALID').length === 0) {
      throw new Error('CONTENT_FACT_SOURCE_REF_REQUIRED');
    }
    if (!Object.is(check.expected, check.observed)) failed = true;
  }
  return failed ? 'FAIL' : 'PASS';
}

export interface RightsCheck {
  readonly assetId: string;
  readonly status: ContentRightsStatus;
  readonly evidence: readonly string[];
  readonly validUntil?: string | null;
}

export function validateRights(checks: readonly RightsCheck[], now = new Date().toISOString()): ContentValidationStatus {
  if (checks.length === 0) return 'REVIEW_REQUIRED';
  const current = Date.parse(now);
  if (!Number.isFinite(current)) throw new Error('CONTENT_RIGHTS_NOW_INVALID');
  let review = false;
  for (const check of checks) {
    requireText(check.assetId, 'CONTENT_RIGHTS_ASSET_ID_REQUIRED');
    requireEvidence(check.evidence);
    if (check.status === 'UNKNOWN') review = true;
    if (check.status === 'RESTRICTED' || check.status === 'EXPIRED') return 'FAIL';
    if (check.validUntil !== undefined && check.validUntil !== null) {
      const expiry = Date.parse(check.validUntil);
      if (!Number.isFinite(expiry)) throw new Error('CONTENT_RIGHTS_EXPIRY_INVALID');
      if (expiry < current) return 'FAIL';
    }
  }
  return review ? 'REVIEW_REQUIRED' : 'PASS';
}

export interface AccessibilityCheck {
  readonly hasSpeech: boolean;
  readonly captionsPresent: boolean;
  readonly captionsReadable: boolean;
  readonly meaningfulAudioDescribedOrNonEssential: boolean;
  readonly textContrastPass: boolean;
}

export function validateAccessibility(check: AccessibilityCheck): ContentValidationStatus {
  if (check.hasSpeech && (!check.captionsPresent || !check.captionsReadable)) return 'FAIL';
  if (!check.meaningfulAudioDescribedOrNonEssential || !check.textContrastPass) return 'FAIL';
  return 'PASS';
}

export interface RepurposeDestination {
  readonly variantKey: string;
  readonly channel: string;
  readonly format: ContentItemFormat;
  readonly language: string;
}

export interface RepurposePlanItem extends RepurposeDestination {
  readonly derivationType: 'REPURPOSE';
  readonly sourceVersionId: string;
  readonly lineageRootVersionId: string;
  readonly sourceAssetIds: readonly string[];
}

export function planContentRepurpose(
  source: ContentItemVersion,
  destinations: readonly RepurposeDestination[],
): readonly RepurposePlanItem[] {
  validateContentItemVersion(source);
  const seen = new Set<string>();
  return destinations.map((destination) => {
    const variantKey = requireText(destination.variantKey, 'CONTENT_REPURPOSE_VARIANT_KEY_REQUIRED');
    const channel = requireText(destination.channel, 'CONTENT_REPURPOSE_CHANNEL_REQUIRED');
    const language = requireText(destination.language, 'CONTENT_REPURPOSE_LANGUAGE_REQUIRED');
    const uniqueness = [variantKey, channel, destination.format, language].join('|');
    if (seen.has(uniqueness)) throw new Error('CONTENT_REPURPOSE_DUPLICATE_DESTINATION');
    seen.add(uniqueness);
    return {
      derivationType: 'REPURPOSE',
      sourceVersionId: source.versionId,
      lineageRootVersionId: source.lineageRootVersionId,
      sourceAssetIds: source.sourceAssetIds,
      variantKey,
      channel,
      format: destination.format,
      language,
    };
  });
}

export function normalizeStringSet(values: readonly string[], errorCode: string): readonly string[] {
  const normalized = [...new Set(values.map((value) => requireText(value, errorCode)))].sort();
  return normalized;
}

export function assertPositiveInteger(value: number, errorCode: string): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(errorCode);
}

export function assertTimestamp(value: string, errorCode: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(errorCode);
}

export function assertJsonSerializable(value: JsonValue, errorCode: string): void {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('undefined');
  } catch {
    throw new Error(errorCode);
  }
}

export function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}
