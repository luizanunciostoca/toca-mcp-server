import type { AuditSink } from '../core/audit.js';
import { executeTool, type ProviderReadbackResult } from '../core/executor.js';
import type { PolicyContext } from '../core/policy.js';
import type { ToolDefinition } from '../core/tool-registry.js';
import type { EventRecord, EventRecordStore } from '../events/event-record.js';
import type { ApprovalStore } from '../governance/approval-governance.js';

export const GOOGLE_BUSINESS_PROVIDER = 'Google Business Profile';
export const GOOGLE_BUSINESS_OAUTH_SCOPE = 'https://www.googleapis.com/auth/business.manage';

export const GOOGLE_BUSINESS_SUBFLOWS = [
  'LOCAL_DISCOVERY',
  'GOOGLE_EVENT_POST',
  'REVIEW_RESPONSE',
  'PROFILE_FRESHNESS',
  'LOCAL_PERFORMANCE',
] as const;
export type GoogleBusinessSubflow = (typeof GOOGLE_BUSINESS_SUBFLOWS)[number];

export const GOOGLE_BUSINESS_CAPABILITY_IDS = [
  'google_business.location.read',
  'google_business.location.validate',
  'google_business.hours.reconcile',
  'google_business.post.prepare',
  'google_business.post.create',
  'google_business.post.readback',
  'google_business.review.ingest',
  'google_business.review.classify',
  'google_business.review.reply_draft',
  'google_business.review.reply',
  'google_business.review.verify',
  'google_business.notification.ingest',
  'google_business.performance.read',
  'google_business.profile.drift.detect',
] as const;
export type GoogleBusinessCapabilityId = (typeof GOOGLE_BUSINESS_CAPABILITY_IDS)[number];

export const GOOGLE_BUSINESS_PUBLIC_WRITE_TOOLS = {
  postCreate: {
    name: 'google_business.post.create',
    version: '1.1.0',
    provider: GOOGLE_BUSINESS_PROVIDER,
    riskClass: 'WRITE_EXTERNAL',
    requiredScopes: [GOOGLE_BUSINESS_OAUTH_SCOPE],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: true,
    idempotent: false,
  },
  reviewReply: {
    name: 'google_business.review.reply',
    version: '1.1.0',
    provider: GOOGLE_BUSINESS_PROVIDER,
    riskClass: 'WRITE_EXTERNAL',
    requiredScopes: [GOOGLE_BUSINESS_OAUTH_SCOPE],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: true,
    idempotent: false,
  },
} as const satisfies Readonly<Record<string, ToolDefinition>>;

export const GOOGLE_BUSINESS_DEFAULT_LOCATION_READ_MASK = [
  'name',
  'title',
  'storefrontAddress',
  'websiteUri',
  'phoneNumbers',
  'categories',
  'regularHours',
  'specialHours',
  'openInfo',
  'profile',
] as const;

export const GOOGLE_BUSINESS_REVIEW_CATEGORIES = [
  'ELOGIO',
  'DUVIDA',
  'HORARIO',
  'LOCALIZACAO',
  'EVENTO',
  'RECLAMACAO',
  'JURIDICO',
  'CRISE',
  'SPAM',
  'OUTRO',
] as const;
export type GoogleBusinessReviewCategory = (typeof GOOGLE_BUSINESS_REVIEW_CATEGORIES)[number];

export type GoogleBusinessReviewSentiment = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
export type GoogleBusinessReviewSensitivity = 'STANDARD' | 'HUMAN_REVIEW_REQUIRED';

export type GoogleBusinessWeekday =
  'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';

export interface GoogleBusinessHoursPeriod {
  readonly openDay: GoogleBusinessWeekday;
  readonly openTime: string;
  readonly closeDay: GoogleBusinessWeekday;
  readonly closeTime: string;
}

export interface GoogleBusinessHours {
  readonly periods: readonly GoogleBusinessHoursPeriod[];
}

export interface GoogleBusinessSpecialHours {
  readonly date: string;
  readonly closed: boolean;
  readonly openTime: string | null;
  readonly closeTime: string | null;
}

export interface GoogleBusinessLocationSnapshot {
  readonly name: string;
  readonly title: string;
  readonly storefrontAddress: string | null;
  readonly websiteUri: string | null;
  readonly primaryPhone: string | null;
  readonly additionalPhones: readonly string[];
  readonly primaryCategory: string | null;
  readonly additionalCategories: readonly string[];
  readonly regularHours: GoogleBusinessHours | null;
  readonly specialHours: readonly GoogleBusinessSpecialHours[];
  readonly openState: string | null;
  readonly profileDescription: string | null;
}

export interface GoogleBusinessLocationExpectation {
  readonly name?: string;
  readonly title?: string;
  readonly storefrontAddress?: string | null;
  readonly websiteUri?: string | null;
  readonly primaryPhone?: string | null;
  readonly primaryCategory?: string | null;
  readonly regularHours?: GoogleBusinessHours | null;
}

export interface GoogleBusinessLocationValidation {
  readonly valid: boolean;
  readonly issues: readonly string[];
}

export interface GoogleBusinessHoursReconciliation {
  readonly inSync: boolean;
  readonly missingFromProvider: readonly GoogleBusinessHoursPeriod[];
  readonly unexpectedAtProvider: readonly GoogleBusinessHoursPeriod[];
}

export interface GoogleBusinessCallToAction {
  readonly actionType: string;
  readonly url: string;
}

export interface GoogleBusinessPostEvent {
  readonly eventId: string;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timezone: string;
}

export interface GoogleBusinessLocalPostDraft {
  readonly locationName: string;
  readonly topicType: 'STANDARD' | 'EVENT';
  readonly summary: string;
  readonly callToAction: GoogleBusinessCallToAction | null;
  readonly event: GoogleBusinessPostEvent | null;
  readonly eventId: string | null;
}

export interface GoogleBusinessLocalPostSnapshot {
  readonly name: string;
  readonly locationName: string;
  readonly topicType: 'STANDARD' | 'EVENT';
  readonly summary: string;
  readonly callToAction: GoogleBusinessCallToAction | null;
  readonly event: GoogleBusinessPostEvent | null;
  readonly state: string | null;
  readonly createTime: string | null;
  readonly updateTime: string | null;
  readonly canonicalUrl: string | null;
}

export interface GoogleBusinessReviewReplySnapshot {
  readonly comment: string;
  readonly updateTime: string | null;
}

export interface GoogleBusinessReviewSnapshot {
  readonly name: string;
  readonly locationName: string;
  readonly reviewerDisplayName: string | null;
  readonly starRating: 1 | 2 | 3 | 4 | 5;
  readonly comment: string | null;
  readonly createTime: string;
  readonly updateTime: string;
  readonly reply: GoogleBusinessReviewReplySnapshot | null;
}

export interface GoogleBusinessReviewIngestion {
  readonly deduplicationKey: string;
  readonly review: GoogleBusinessReviewSnapshot;
}

export interface GoogleBusinessReviewClassification {
  readonly reviewName: string;
  readonly category: GoogleBusinessReviewCategory;
  readonly sentiment: GoogleBusinessReviewSentiment;
  readonly sensitivity: GoogleBusinessReviewSensitivity;
  readonly requiresHumanReview: boolean;
  readonly reasons: readonly string[];
  readonly crmHandoff: 'DEFERRED_UNTIL_CRM_CORE_AVAILABLE';
}

export interface GoogleBusinessReviewReplyDraft {
  readonly reviewName: string;
  readonly comment: string;
  readonly category: GoogleBusinessReviewCategory;
  readonly requiresHumanReview: boolean;
  readonly requiresR27Approval: true;
  readonly autoReplyEligible: false;
}

export interface GoogleBusinessHumanReviewEvidence {
  readonly reviewedBy: string;
  readonly evidence: readonly string[];
}

export interface GoogleBusinessNotificationEnvelope {
  readonly messageId: string;
  readonly publishedAt: string;
  readonly accountName: string;
  readonly locationName: string | null;
  readonly notificationType: string;
  readonly resourceName: string;
}

export interface GoogleBusinessNotificationIngestion {
  readonly deduplicationKey: string;
  readonly notification: GoogleBusinessNotificationEnvelope;
}

export interface GoogleBusinessPerformancePoint {
  readonly date: string;
  readonly metric: string;
  readonly value: number;
}

export interface GoogleBusinessPerformanceSnapshot {
  readonly locationName: string;
  readonly from: string;
  readonly to: string;
  readonly points: readonly GoogleBusinessPerformancePoint[];
}

export interface GoogleBusinessProfileDrift {
  readonly field: string;
  readonly expected: unknown;
  readonly actual: unknown;
  readonly source: 'CANONICAL_VS_PROVIDER' | 'GOOGLE_UPDATED_VS_PROVIDER';
}

export interface GoogleBusinessProfileDriftResult {
  readonly locationName: string;
  readonly driftDetected: boolean;
  readonly drifts: readonly GoogleBusinessProfileDrift[];
}

export interface GoogleBusinessProvider {
  getLocation(input: {
    readonly locationName: string;
    readonly readMask: readonly string[];
  }): Promise<GoogleBusinessLocationSnapshot>;
  getGoogleUpdatedLocation(input: {
    readonly locationName: string;
    readonly readMask: readonly string[];
  }): Promise<GoogleBusinessLocationSnapshot | null>;
  createLocalPost(input: {
    readonly parent: string;
    readonly post: GoogleBusinessLocalPostDraft;
  }): Promise<GoogleBusinessLocalPostSnapshot>;
  getLocalPost(name: string): Promise<GoogleBusinessLocalPostSnapshot>;
  listReviews(input: { readonly parent: string; readonly pageToken: string | null }): Promise<{
    readonly reviews: readonly GoogleBusinessReviewSnapshot[];
    readonly nextPageToken: string | null;
  }>;
  getReview(name: string): Promise<GoogleBusinessReviewSnapshot>;
  updateReviewReply(input: {
    readonly reviewName: string;
    readonly comment: string;
  }): Promise<GoogleBusinessReviewReplySnapshot>;
  fetchPerformance(input: {
    readonly locationName: string;
    readonly metricNames: readonly string[];
    readonly from: string;
    readonly to: string;
  }): Promise<GoogleBusinessPerformanceSnapshot>;
}

export interface GoogleBusinessGovernedWriteContext {
  readonly approvalId: string;
  readonly approvalStore: ApprovalStore;
  readonly policyContext: PolicyContext;
  readonly auditSink: AuditSink;
  readonly correlationId: string;
}

export async function readGoogleBusinessLocation(
  provider: GoogleBusinessProvider,
  locationName: string,
  readMask: readonly string[] = GOOGLE_BUSINESS_DEFAULT_LOCATION_READ_MASK,
): Promise<GoogleBusinessLocationSnapshot> {
  requireText(locationName, 'GOOGLE_BUSINESS_LOCATION_NAME_REQUIRED');
  requireNonEmptyList(readMask, 'GOOGLE_BUSINESS_LOCATION_READ_MASK_REQUIRED');
  return provider.getLocation({ locationName, readMask });
}

export function validateGoogleBusinessLocation(
  location: GoogleBusinessLocationSnapshot,
  expected: GoogleBusinessLocationExpectation = {},
): GoogleBusinessLocationValidation {
  const issues: string[] = [];
  if (!location.name.trim()) issues.push('LOCATION_NAME_MISSING');
  if (!location.title.trim()) issues.push('LOCATION_TITLE_MISSING');
  if (location.websiteUri !== null && !isHttpUrl(location.websiteUri)) {
    issues.push('LOCATION_WEBSITE_INVALID');
  }
  if (location.regularHours !== null) validateHours(location.regularHours);

  compareExpected('name', expected.name, location.name, issues);
  compareExpected('title', expected.title, location.title, issues);
  compareExpected(
    'storefrontAddress',
    expected.storefrontAddress,
    location.storefrontAddress,
    issues,
  );
  compareExpected('websiteUri', expected.websiteUri, location.websiteUri, issues);
  compareExpected('primaryPhone', expected.primaryPhone, location.primaryPhone, issues);
  compareExpected('primaryCategory', expected.primaryCategory, location.primaryCategory, issues);
  if (expected.regularHours !== undefined) {
    const reconciliation = reconcileGoogleBusinessHours(
      expected.regularHours,
      location.regularHours,
    );
    if (!reconciliation.inSync) issues.push('LOCATION_REGULAR_HOURS_MISMATCH');
  }

  return { valid: issues.length === 0, issues: [...new Set(issues)].sort() };
}

export function reconcileGoogleBusinessHours(
  expected: GoogleBusinessHours | null,
  actual: GoogleBusinessHours | null,
): GoogleBusinessHoursReconciliation {
  const expectedPeriods = normalizePeriods(expected?.periods ?? []);
  const actualPeriods = normalizePeriods(actual?.periods ?? []);
  const actualKeys = new Set(actualPeriods.map(periodKey));
  const expectedKeys = new Set(expectedPeriods.map(periodKey));
  const missingFromProvider = expectedPeriods.filter(
    (period) => !actualKeys.has(periodKey(period)),
  );
  const unexpectedAtProvider = actualPeriods.filter(
    (period) => !expectedKeys.has(periodKey(period)),
  );
  return {
    inSync: missingFromProvider.length === 0 && unexpectedAtProvider.length === 0,
    missingFromProvider,
    unexpectedAtProvider,
  };
}

export async function prepareGoogleBusinessPost(
  input: {
    readonly locationName: string;
    readonly summary: string;
    readonly eventId?: string;
    readonly eventTitle?: string;
    readonly callToAction?: GoogleBusinessCallToAction | null;
  },
  eventStore?: EventRecordStore,
): Promise<GoogleBusinessLocalPostDraft> {
  const locationName = requireText(input.locationName, 'GOOGLE_BUSINESS_LOCATION_NAME_REQUIRED');
  const summary = requireText(input.summary, 'GOOGLE_BUSINESS_POST_SUMMARY_REQUIRED');
  const callToAction = normalizeCallToAction(input.callToAction ?? null);

  if (input.eventId === undefined) {
    return {
      locationName,
      topicType: 'STANDARD',
      summary,
      callToAction,
      event: null,
      eventId: null,
    };
  }

  if (!eventStore) throw new Error('GOOGLE_BUSINESS_EVENT_RECORD_STORE_REQUIRED');
  const eventId = requireText(input.eventId, 'GOOGLE_BUSINESS_EVENT_ID_REQUIRED');
  const event = await eventStore.get(eventId);
  if (!event) throw new Error('GOOGLE_BUSINESS_EVENT_RECORD_NOT_FOUND');
  assertEventEligibleForGooglePost(event);

  return {
    locationName,
    topicType: 'EVENT',
    summary,
    callToAction,
    event: {
      eventId: event.eventId,
      title: input.eventTitle?.trim() || event.name,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timezone: event.timezone,
    },
    eventId: event.eventId,
  };
}

export async function executeGoogleBusinessPostCreate(input: {
  readonly provider: GoogleBusinessProvider;
  readonly parent: string;
  readonly draft: GoogleBusinessLocalPostDraft;
  readonly governance: GoogleBusinessGovernedWriteContext;
  readonly eventStore?: EventRecordStore;
}): Promise<GoogleBusinessLocalPostSnapshot> {
  requireText(input.parent, 'GOOGLE_BUSINESS_POST_PARENT_REQUIRED');
  validatePostDraft(input.draft);
  if (input.draft.eventId !== null && !input.eventStore) {
    throw new Error('GOOGLE_BUSINESS_EVENT_RECORD_STORE_REQUIRED');
  }

  let verifiedReadback: GoogleBusinessLocalPostSnapshot | undefined;
  const result = await executeTool({
    tool: GOOGLE_BUSINESS_PUBLIC_WRITE_TOOLS.postCreate,
    policyContext: input.governance.policyContext,
    auditSink: input.governance.auditSink,
    correlationId: input.governance.correlationId,
    action: () => input.provider.createLocalPost({ parent: input.parent, post: input.draft }),
    approvalExecution: {
      approvalId: input.governance.approvalId,
      store: input.governance.approvalStore,
      providerReadback: async (created) => {
        const actual = await input.provider.getLocalPost(created.name);
        const verification = verifyGoogleBusinessPostReadback(input.draft, actual);
        if (verification.verified) verifiedReadback = actual;
        return verification;
      },
    },
  });

  if (input.draft.eventId !== null && input.eventStore) {
    if (!verifiedReadback) throw new Error('GOOGLE_BUSINESS_POST_VERIFIED_READBACK_REQUIRED');
    await input.eventStore.attachExternalRef({
      refId: `google-business-local-post:${input.draft.eventId}:${verifiedReadback.name}`,
      eventId: input.draft.eventId,
      provider: GOOGLE_BUSINESS_PROVIDER,
      referenceType: 'LOCAL_POST',
      externalId: verifiedReadback.name,
      canonicalUrl: verifiedReadback.canonicalUrl,
      correlationId: input.governance.correlationId,
      evidence: [`google-business:local-post-readback:${verifiedReadback.name}`],
    });
  }

  return result;
}

export async function readbackGoogleBusinessPost(
  provider: GoogleBusinessProvider,
  postName: string,
  expected: GoogleBusinessLocalPostDraft,
): Promise<{
  readonly post: GoogleBusinessLocalPostSnapshot;
  readonly verification: ProviderReadbackResult;
}> {
  const post = await provider.getLocalPost(
    requireText(postName, 'GOOGLE_BUSINESS_POST_NAME_REQUIRED'),
  );
  return { post, verification: verifyGoogleBusinessPostReadback(expected, post) };
}

export function verifyGoogleBusinessPostReadback(
  expected: GoogleBusinessLocalPostDraft,
  actual: GoogleBusinessLocalPostSnapshot,
): ProviderReadbackResult {
  const reasons: string[] = [];
  if (actual.locationName !== expected.locationName) reasons.push('LOCATION_MISMATCH');
  if (actual.topicType !== expected.topicType) reasons.push('TOPIC_TYPE_MISMATCH');
  if (actual.summary !== expected.summary) reasons.push('SUMMARY_MISMATCH');
  if (stableValue(actual.callToAction) !== stableValue(expected.callToAction)) {
    reasons.push('CALL_TO_ACTION_MISMATCH');
  }
  if (stableValue(actual.event) !== stableValue(expected.event)) reasons.push('EVENT_MISMATCH');

  return {
    verified: reasons.length === 0,
    evidence: reasons.length === 0 ? [`google-business:local-post-readback:${actual.name}`] : [],
    ...(reasons.length > 0 ? { reason: reasons.join(',') } : {}),
    externalResourceId: actual.name,
  };
}

export function ingestGoogleBusinessReview(
  review: GoogleBusinessReviewSnapshot,
): GoogleBusinessReviewIngestion {
  validateReview(review);
  return {
    deduplicationKey: `google-business-review:${review.name}:${review.updateTime}`,
    review,
  };
}

export function classifyGoogleBusinessReview(
  review: GoogleBusinessReviewSnapshot,
): GoogleBusinessReviewClassification {
  validateReview(review);
  const text = normalizeSearchText(review.comment ?? '');
  const reasons: string[] = [];
  let category: GoogleBusinessReviewCategory = 'OUTRO';

  if (containsAny(text, CRISIS_TERMS)) {
    category = 'CRISE';
    reasons.push('CRISIS_TERM_DETECTED');
  } else if (containsAny(text, LEGAL_TERMS)) {
    category = 'JURIDICO';
    reasons.push('LEGAL_TERM_DETECTED');
  } else if (review.starRating <= 2 || containsAny(text, COMPLAINT_TERMS)) {
    category = 'RECLAMACAO';
    reasons.push(review.starRating <= 2 ? 'LOW_RATING' : 'COMPLAINT_TERM_DETECTED');
  } else if (containsAny(text, SPAM_TERMS)) {
    category = 'SPAM';
    reasons.push('SPAM_PATTERN_DETECTED');
  } else if (containsAny(text, HOURS_TERMS)) {
    category = 'HORARIO';
    reasons.push('HOURS_INTENT_DETECTED');
  } else if (containsAny(text, LOCATION_TERMS)) {
    category = 'LOCALIZACAO';
    reasons.push('LOCATION_INTENT_DETECTED');
  } else if (containsAny(text, EVENT_TERMS)) {
    category = 'EVENTO';
    reasons.push('EVENT_INTENT_DETECTED');
  } else if (text.includes('?') || containsAny(text, QUESTION_TERMS)) {
    category = 'DUVIDA';
    reasons.push('QUESTION_INTENT_DETECTED');
  } else if (review.starRating >= 4) {
    category = 'ELOGIO';
    reasons.push('HIGH_RATING');
  }

  const requiresHumanReview =
    category === 'RECLAMACAO' || category === 'JURIDICO' || category === 'CRISE';
  const sentiment: GoogleBusinessReviewSentiment =
    review.starRating >= 4 ? 'POSITIVE' : review.starRating <= 2 ? 'NEGATIVE' : 'NEUTRAL';

  return {
    reviewName: review.name,
    category,
    sentiment,
    sensitivity: requiresHumanReview ? 'HUMAN_REVIEW_REQUIRED' : 'STANDARD',
    requiresHumanReview,
    reasons,
    crmHandoff: 'DEFERRED_UNTIL_CRM_CORE_AVAILABLE',
  };
}

export function draftGoogleBusinessReviewReply(
  classification: GoogleBusinessReviewClassification,
  comment: string,
): GoogleBusinessReviewReplyDraft {
  const normalizedComment = requireText(comment, 'GOOGLE_BUSINESS_REVIEW_REPLY_REQUIRED');
  if (Buffer.byteLength(normalizedComment, 'utf8') > 4096) {
    throw new Error('GOOGLE_BUSINESS_REVIEW_REPLY_TOO_LARGE');
  }
  return {
    reviewName: classification.reviewName,
    comment: normalizedComment,
    category: classification.category,
    requiresHumanReview: classification.requiresHumanReview,
    requiresR27Approval: true,
    autoReplyEligible: false,
  };
}

export async function executeGoogleBusinessReviewReply(input: {
  readonly provider: GoogleBusinessProvider;
  readonly classification: GoogleBusinessReviewClassification;
  readonly draft: GoogleBusinessReviewReplyDraft;
  readonly governance: GoogleBusinessGovernedWriteContext;
  readonly humanReview?: GoogleBusinessHumanReviewEvidence;
}): Promise<GoogleBusinessReviewReplySnapshot> {
  assertReviewReplyPolicy(input.classification, input.draft, input.humanReview);
  return executeTool({
    tool: GOOGLE_BUSINESS_PUBLIC_WRITE_TOOLS.reviewReply,
    policyContext: input.governance.policyContext,
    auditSink: input.governance.auditSink,
    correlationId: input.governance.correlationId,
    action: () =>
      input.provider.updateReviewReply({
        reviewName: input.draft.reviewName,
        comment: input.draft.comment,
      }),
    approvalExecution: {
      approvalId: input.governance.approvalId,
      store: input.governance.approvalStore,
      providerReadback: async () => {
        const review = await input.provider.getReview(input.draft.reviewName);
        return verifyGoogleBusinessReviewReply(input.draft.comment, review);
      },
    },
  });
}

export async function verifyGoogleBusinessReview(
  provider: GoogleBusinessProvider,
  reviewName: string,
  expectedReply: string,
): Promise<{
  readonly review: GoogleBusinessReviewSnapshot;
  readonly verification: ProviderReadbackResult;
}> {
  const review = await provider.getReview(
    requireText(reviewName, 'GOOGLE_BUSINESS_REVIEW_NAME_REQUIRED'),
  );
  return {
    review,
    verification: verifyGoogleBusinessReviewReply(expectedReply, review),
  };
}

export function verifyGoogleBusinessReviewReply(
  expectedReply: string,
  review: GoogleBusinessReviewSnapshot,
): ProviderReadbackResult {
  const expected = requireText(expectedReply, 'GOOGLE_BUSINESS_REVIEW_REPLY_REQUIRED');
  const verified = review.reply?.comment === expected;
  return {
    verified,
    evidence: verified ? [`google-business:review-reply-readback:${review.name}`] : [],
    ...(!verified ? { reason: 'REVIEW_REPLY_MISMATCH_OR_MISSING' } : {}),
    externalResourceId: review.name,
  };
}

export function ingestGoogleBusinessNotification(
  notification: GoogleBusinessNotificationEnvelope,
): GoogleBusinessNotificationIngestion {
  requireText(notification.messageId, 'GOOGLE_BUSINESS_NOTIFICATION_MESSAGE_ID_REQUIRED');
  requireTimestamp(notification.publishedAt, 'GOOGLE_BUSINESS_NOTIFICATION_PUBLISHED_AT_INVALID');
  requireText(notification.accountName, 'GOOGLE_BUSINESS_NOTIFICATION_ACCOUNT_REQUIRED');
  if (notification.locationName !== null) {
    requireText(notification.locationName, 'GOOGLE_BUSINESS_NOTIFICATION_LOCATION_INVALID');
  }
  requireText(notification.notificationType, 'GOOGLE_BUSINESS_NOTIFICATION_TYPE_REQUIRED');
  requireText(notification.resourceName, 'GOOGLE_BUSINESS_NOTIFICATION_RESOURCE_REQUIRED');
  return {
    deduplicationKey: `google-business-notification:${notification.messageId}`,
    notification,
  };
}

export async function readGoogleBusinessPerformance(
  provider: GoogleBusinessProvider,
  input: {
    readonly locationName: string;
    readonly metricNames: readonly string[];
    readonly from: string;
    readonly to: string;
  },
): Promise<GoogleBusinessPerformanceSnapshot> {
  requireText(input.locationName, 'GOOGLE_BUSINESS_LOCATION_NAME_REQUIRED');
  requireNonEmptyList(input.metricNames, 'GOOGLE_BUSINESS_PERFORMANCE_METRICS_REQUIRED');
  const from = requireTimestamp(input.from, 'GOOGLE_BUSINESS_PERFORMANCE_FROM_INVALID');
  const to = requireTimestamp(input.to, 'GOOGLE_BUSINESS_PERFORMANCE_TO_INVALID');
  if (to <= from) throw new Error('GOOGLE_BUSINESS_PERFORMANCE_RANGE_INVALID');
  return provider.fetchPerformance(input);
}

export async function detectGoogleBusinessProfileDrift(
  provider: GoogleBusinessProvider,
  input: {
    readonly locationName: string;
    readonly canonical: GoogleBusinessLocationExpectation;
    readonly readMask?: readonly string[];
  },
): Promise<GoogleBusinessProfileDriftResult> {
  const locationName = requireText(input.locationName, 'GOOGLE_BUSINESS_LOCATION_NAME_REQUIRED');
  const readMask = input.readMask ?? GOOGLE_BUSINESS_DEFAULT_LOCATION_READ_MASK;
  requireNonEmptyList(readMask, 'GOOGLE_BUSINESS_LOCATION_READ_MASK_REQUIRED');
  const [current, googleUpdated] = await Promise.all([
    provider.getLocation({ locationName, readMask }),
    provider.getGoogleUpdatedLocation({ locationName, readMask }),
  ]);
  return detectGoogleBusinessProfileDriftFromSnapshots(input.canonical, current, googleUpdated);
}

export function detectGoogleBusinessProfileDriftFromSnapshots(
  canonical: GoogleBusinessLocationExpectation,
  current: GoogleBusinessLocationSnapshot,
  googleUpdated: GoogleBusinessLocationSnapshot | null,
): GoogleBusinessProfileDriftResult {
  const drifts: GoogleBusinessProfileDrift[] = [];
  const fields: readonly (keyof GoogleBusinessLocationExpectation)[] = [
    'name',
    'title',
    'storefrontAddress',
    'websiteUri',
    'primaryPhone',
    'primaryCategory',
    'regularHours',
  ];

  for (const field of fields) {
    const expected = canonical[field];
    if (expected === undefined) continue;
    const actual = current[field];
    if (stableValue(expected) !== stableValue(actual)) {
      drifts.push({ field, expected, actual, source: 'CANONICAL_VS_PROVIDER' });
    }
  }

  if (googleUpdated !== null) {
    for (const field of fields) {
      const proposed = googleUpdated[field];
      const actual = current[field];
      if (stableValue(proposed) !== stableValue(actual)) {
        drifts.push({
          field,
          expected: proposed,
          actual,
          source: 'GOOGLE_UPDATED_VS_PROVIDER',
        });
      }
    }
  }

  return {
    locationName: current.name,
    driftDetected: drifts.length > 0,
    drifts,
  };
}

function assertEventEligibleForGooglePost(event: EventRecord): void {
  if (!['PLANNED', 'CONFIRMED', 'ON_SALE', 'SOLD_OUT', 'IN_PROGRESS'].includes(event.status)) {
    throw new Error(`GOOGLE_BUSINESS_EVENT_STATUS_NOT_ELIGIBLE:${event.status}`);
  }
}

function assertReviewReplyPolicy(
  classification: GoogleBusinessReviewClassification,
  draft: GoogleBusinessReviewReplyDraft,
  humanReview: GoogleBusinessHumanReviewEvidence | undefined,
): void {
  if (classification.reviewName !== draft.reviewName) {
    throw new Error('GOOGLE_BUSINESS_REVIEW_REPLY_REVIEW_MISMATCH');
  }
  if (classification.category !== draft.category) {
    throw new Error('GOOGLE_BUSINESS_REVIEW_REPLY_CATEGORY_MISMATCH');
  }
  if (draft.autoReplyEligible !== false || draft.requiresR27Approval !== true) {
    throw new Error('GOOGLE_BUSINESS_UNRESTRICTED_AUTO_REPLY_FORBIDDEN');
  }
  requireText(draft.comment, 'GOOGLE_BUSINESS_REVIEW_REPLY_REQUIRED');
  if (Buffer.byteLength(draft.comment, 'utf8') > 4096) {
    throw new Error('GOOGLE_BUSINESS_REVIEW_REPLY_TOO_LARGE');
  }

  if (!classification.requiresHumanReview) return;
  if (!humanReview) throw new Error('GOOGLE_BUSINESS_SENSITIVE_REVIEW_HUMAN_REVIEW_REQUIRED');
  requireText(humanReview.reviewedBy, 'GOOGLE_BUSINESS_HUMAN_REVIEWER_REQUIRED');
  requireNonEmptyList(humanReview.evidence, 'GOOGLE_BUSINESS_HUMAN_REVIEW_EVIDENCE_REQUIRED');
}

function validatePostDraft(draft: GoogleBusinessLocalPostDraft): void {
  requireText(draft.locationName, 'GOOGLE_BUSINESS_LOCATION_NAME_REQUIRED');
  requireText(draft.summary, 'GOOGLE_BUSINESS_POST_SUMMARY_REQUIRED');
  if (draft.callToAction !== null) normalizeCallToAction(draft.callToAction);
  if (draft.topicType === 'EVENT') {
    if (draft.event === null || draft.eventId === null) {
      throw new Error('GOOGLE_BUSINESS_EVENT_POST_EVENT_REQUIRED');
    }
    requireText(draft.event.title, 'GOOGLE_BUSINESS_EVENT_TITLE_REQUIRED');
    const start = requireTimestamp(draft.event.startsAt, 'GOOGLE_BUSINESS_EVENT_START_INVALID');
    const end = requireTimestamp(draft.event.endsAt, 'GOOGLE_BUSINESS_EVENT_END_INVALID');
    if (end <= start) throw new Error('GOOGLE_BUSINESS_EVENT_RANGE_INVALID');
    requireText(draft.event.timezone, 'GOOGLE_BUSINESS_EVENT_TIMEZONE_REQUIRED');
  } else if (draft.event !== null || draft.eventId !== null) {
    throw new Error('GOOGLE_BUSINESS_STANDARD_POST_EVENT_FORBIDDEN');
  }
}

function validateReview(review: GoogleBusinessReviewSnapshot): void {
  requireText(review.name, 'GOOGLE_BUSINESS_REVIEW_NAME_REQUIRED');
  requireText(review.locationName, 'GOOGLE_BUSINESS_REVIEW_LOCATION_REQUIRED');
  if (![1, 2, 3, 4, 5].includes(review.starRating)) {
    throw new Error('GOOGLE_BUSINESS_REVIEW_RATING_INVALID');
  }
  requireTimestamp(review.createTime, 'GOOGLE_BUSINESS_REVIEW_CREATE_TIME_INVALID');
  requireTimestamp(review.updateTime, 'GOOGLE_BUSINESS_REVIEW_UPDATE_TIME_INVALID');
}

function normalizeCallToAction(
  callToAction: GoogleBusinessCallToAction | null,
): GoogleBusinessCallToAction | null {
  if (callToAction === null) return null;
  const actionType = requireText(
    callToAction.actionType,
    'GOOGLE_BUSINESS_POST_CALL_TO_ACTION_TYPE_REQUIRED',
  );
  const url = requireText(callToAction.url, 'GOOGLE_BUSINESS_POST_CALL_TO_ACTION_URL_REQUIRED');
  if (!isHttpUrl(url)) throw new Error('GOOGLE_BUSINESS_POST_CALL_TO_ACTION_URL_INVALID');
  return { actionType, url };
}

function validateHours(hours: GoogleBusinessHours): void {
  normalizePeriods(hours.periods);
}

function normalizePeriods(
  periods: readonly GoogleBusinessHoursPeriod[],
): readonly GoogleBusinessHoursPeriod[] {
  return periods
    .map((period) => {
      requireClockTime(period.openTime, 'GOOGLE_BUSINESS_HOURS_OPEN_TIME_INVALID');
      requireClockTime(period.closeTime, 'GOOGLE_BUSINESS_HOURS_CLOSE_TIME_INVALID');
      return { ...period };
    })
    .sort((left, right) => periodKey(left).localeCompare(periodKey(right)));
}

function periodKey(period: GoogleBusinessHoursPeriod): string {
  return `${period.openDay}:${period.openTime}-${period.closeDay}:${period.closeTime}`;
}

function compareExpected(
  field: string,
  expected: unknown,
  actual: unknown,
  issues: string[],
): void {
  if (expected === undefined) return;
  if (stableValue(expected) !== stableValue(actual)) {
    issues.push(
      `LOCATION_${field.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}_MISMATCH`,
    );
  }
}

function stableValue(value: unknown): string {
  return JSON.stringify(normalizeStableValue(value));
}

function normalizeStableValue(value: unknown): unknown {
  if (value === undefined) return '__undefined__';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => normalizeStableValue(item));
  const record = value as Readonly<Record<string, unknown>>;
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    normalized[key] = normalizeStableValue(record[key]);
  }
  return normalized;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function containsAny(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

function requireNonEmptyList(values: readonly string[], errorCode: string): void {
  if (values.length === 0 || values.some((value) => !value.trim())) throw new Error(errorCode);
}

function requireTimestamp(value: string, errorCode: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(errorCode);
  return parsed;
}

function requireClockTime(value: string, errorCode: string): void {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(errorCode);
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const CRISIS_TERMS = [
  'agressao',
  'violencia',
  'acidente',
  'hospital',
  'seguranca',
  'roubo',
  'assedio',
  'ameaca',
] as const;
const LEGAL_TERMS = ['advogado', 'processo', 'judicial', 'procon', 'denuncia', 'direito'] as const;
const COMPLAINT_TERMS = [
  'pessimo',
  'horrivel',
  'reclamacao',
  'decepcao',
  'cobranca',
  'reembolso',
  'estorno',
  'fraude',
] as const;
const SPAM_TERMS = ['http://', 'https://', 'whatsapp.me', 'telegram.me'] as const;
const HOURS_TERMS = ['horario', 'abre', 'fecha', 'funcionamento'] as const;
const LOCATION_TERMS = ['onde fica', 'localizacao', 'endereco', 'como chegar'] as const;
const EVENT_TERMS = ['evento', 'festa', 'sunset', 'party', 'dj'] as const;
const QUESTION_TERMS = ['quanto', 'quando', 'como', 'qual', 'posso', 'tem '] as const;
