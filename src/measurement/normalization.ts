import { createHash } from 'node:crypto';
import {
  ATTRIBUTION_MODELS,
  MEASUREMENT_SOURCE_SYSTEMS,
  type AttributionModel,
  type DataQualityIssue,
  type DataQualityReport,
  type MeasurementProperties,
  type MeasurementSourceSystem,
  type NormalizedMeasurementEvent,
  type UtmDimensions,
} from './contracts.js';

const MAX_DIMENSION_LENGTH = 512;
const MAX_PROPERTY_KEYS = 100;

export interface NormalizeMeasurementEventInput {
  readonly measurementEventId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly eventId?: string | null;
  readonly sourceSystem: MeasurementSourceSystem;
  readonly sourceEventId: string;
  readonly eventName: string;
  readonly occurredAt: string;
  readonly ingestedAt?: string;
  readonly sessionId?: string | null;
  readonly anonymousId?: string | null;
  readonly subjectId?: string | null;
  readonly source?: string | null;
  readonly medium?: string | null;
  readonly campaign?: string | null;
  readonly content?: string | null;
  readonly term?: string | null;
  readonly campaignId?: string | null;
  readonly contentId?: string | null;
  readonly isConversion?: boolean;
  readonly valueMinor?: number | null;
  readonly currency?: string | null;
  readonly properties?: MeasurementProperties;
  readonly requesterPrincipalId: string;
  readonly correlationId: string;
  readonly workflowInstanceId?: string | null;
  readonly evidence: readonly string[];
}

export function normalizeUtm(input: {
  readonly source?: string | null;
  readonly medium?: string | null;
  readonly campaign?: string | null;
  readonly content?: string | null;
  readonly term?: string | null;
}): UtmDimensions {
  return {
    source: dimension(input.source, true),
    medium: dimension(input.medium, true),
    campaign: dimension(input.campaign, false),
    content: dimension(input.content, false),
    term: dimension(input.term, false),
  };
}

export function normalizeMeasurementEvent(
  input: NormalizeMeasurementEventInput,
): NormalizedMeasurementEvent {
  requireText(input.measurementEventId, 'MEASUREMENT_EVENT_ID_REQUIRED');
  requireText(input.tenantId, 'MEASUREMENT_TENANT_ID_REQUIRED');
  requireText(input.workspaceId, 'MEASUREMENT_WORKSPACE_ID_REQUIRED');
  requireText(input.organizationId, 'MEASUREMENT_ORGANIZATION_ID_REQUIRED');
  requireText(input.sourceEventId, 'MEASUREMENT_SOURCE_EVENT_ID_REQUIRED');
  requireText(input.eventName, 'MEASUREMENT_EVENT_NAME_REQUIRED');
  requireText(input.requesterPrincipalId, 'MEASUREMENT_REQUESTER_REQUIRED');
  requireText(input.correlationId, 'MEASUREMENT_CORRELATION_ID_REQUIRED');
  if (!MEASUREMENT_SOURCE_SYSTEMS.includes(input.sourceSystem)) {
    throw new Error('MEASUREMENT_SOURCE_SYSTEM_INVALID');
  }

  const occurredAt = timestamp(input.occurredAt, 'MEASUREMENT_OCCURRED_AT_INVALID');
  const ingestedAt = timestamp(
    input.ingestedAt ?? new Date().toISOString(),
    'MEASUREMENT_INGESTED_AT_INVALID',
  );
  const evidence = normalizeEvidence(input.evidence);
  const eventId = nullableText(input.eventId);
  const valueMinor = nullableMinor(input.valueMinor);
  const currency = normalizeCurrency(input.currency, valueMinor !== null);
  const properties = normalizeProperties(input.properties ?? {});
  const utm = normalizeUtm(input);
  const dataQuality = validateMeasurementDataQuality({
    sourceSystem: input.sourceSystem,
    eventId,
    occurredAt,
    ingestedAt,
    sourceEventId: input.sourceEventId,
    utm,
    isConversion: input.isConversion ?? false,
    valueMinor,
    currency,
    evidence,
  });

  return {
    measurementEventId: input.measurementEventId.trim(),
    tenantId: input.tenantId.trim(),
    workspaceId: input.workspaceId.trim(),
    organizationId: input.organizationId.trim(),
    eventId,
    sourceSystem: input.sourceSystem,
    sourceEventId: input.sourceEventId.trim(),
    eventName: input.eventName.trim(),
    occurredAt,
    ingestedAt,
    sessionId: nullableText(input.sessionId),
    anonymousId: nullableText(input.anonymousId),
    subjectId: nullableText(input.subjectId),
    utm,
    campaignId: dimension(input.campaignId, false),
    contentId: dimension(input.contentId, false),
    isConversion: input.isConversion ?? false,
    valueMinor,
    currency,
    properties,
    dataQuality,
    requesterPrincipalId: input.requesterPrincipalId.trim(),
    correlationId: input.correlationId.trim(),
    workflowInstanceId: nullableText(input.workflowInstanceId),
    evidence,
  };
}

export function validateMeasurementDataQuality(input: {
  readonly sourceSystem: MeasurementSourceSystem;
  readonly eventId: string | null;
  readonly occurredAt: string;
  readonly ingestedAt: string;
  readonly sourceEventId: string;
  readonly utm: UtmDimensions;
  readonly isConversion: boolean;
  readonly valueMinor: number | null;
  readonly currency: string | null;
  readonly evidence: readonly string[];
}): DataQualityReport {
  const issues: DataQualityIssue[] = [];
  if (!input.sourceEventId.trim()) {
    issues.push(
      issue(
        'SOURCE_EVENT_ID_MISSING',
        'ERROR',
        'sourceEventId',
        'Provider/source event identity is required.',
      ),
    );
  }
  if (Date.parse(input.occurredAt) > Date.parse(input.ingestedAt) + 5 * 60_000) {
    issues.push(
      issue(
        'EVENT_TIMESTAMP_AFTER_INGESTION',
        'ERROR',
        'occurredAt',
        'Event occurrence cannot materially postdate ingestion.',
      ),
    );
  }
  if (input.sourceSystem === 'TICKETING' && !input.eventId) {
    issues.push(
      issue(
        'EVENT_RECORD_LINK_REQUIRED',
        'ERROR',
        'eventId',
        'Ticketing data must link to EventRecord.',
      ),
    );
  }
  if (input.isConversion && input.sourceSystem === 'TICKETING' && !input.eventId) {
    issues.push(
      issue(
        'CONVERSION_EVENT_RECORD_LINK_REQUIRED',
        'ERROR',
        'eventId',
        'Ticket conversion must link to EventRecord.',
      ),
    );
  }
  if (input.valueMinor !== null && !input.currency) {
    issues.push(
      issue(
        'CURRENCY_REQUIRED_FOR_VALUE',
        'ERROR',
        'currency',
        'Currency is required when a monetary value exists.',
      ),
    );
  }
  if (!input.utm.source) {
    issues.push(
      issue('ATTRIBUTION_SOURCE_MISSING', 'WARNING', 'source', 'Attribution source is missing.'),
    );
  }
  if (!input.utm.medium) {
    issues.push(
      issue('ATTRIBUTION_MEDIUM_MISSING', 'WARNING', 'medium', 'Attribution medium is missing.'),
    );
  }
  if (input.evidence.length === 0) {
    issues.push(
      issue(
        'MEASUREMENT_EVIDENCE_MISSING',
        'ERROR',
        'evidence',
        'At least one lineage/evidence reference is required.',
      ),
    );
  }

  const errorCount = issues.filter((candidate) => candidate.severity === 'ERROR').length;
  const warningCount = issues.length - errorCount;
  const score = clamp01(1 - errorCount * 0.35 - warningCount * 0.1);
  return { valid: errorCount === 0, score, issues };
}

export function assertDataQuality(report: DataQualityReport): void {
  if (!report.valid) {
    const codes = report.issues
      .filter((item) => item.severity === 'ERROR')
      .map((item) => item.code);
    throw new Error(`MEASUREMENT_DATA_QUALITY_FAILED:${codes.join(',')}`);
  }
}

export function normalizeAttributionModel(value: string): AttributionModel {
  if (!ATTRIBUTION_MODELS.includes(value as AttributionModel)) {
    throw new Error('ATTRIBUTION_MODEL_INVALID');
  }
  return value as AttributionModel;
}

export function payloadSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export function normalizeEvidence(evidence: readonly string[]): readonly string[] {
  const normalized = [...new Set(evidence.map((item) => item.trim()).filter(Boolean))].sort();
  if (normalized.length === 0) throw new Error('MEASUREMENT_EVIDENCE_REQUIRED');
  return normalized;
}

export function normalizeCurrency(
  value: string | null | undefined,
  required: boolean,
): string | null {
  const normalized = value?.trim().toUpperCase() ?? '';
  if (!normalized) {
    if (required) throw new Error('MEASUREMENT_CURRENCY_REQUIRED');
    return null;
  }
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error('MEASUREMENT_CURRENCY_INVALID');
  return normalized;
}

export function nonNegativeInteger(value: number, errorCode: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(errorCode);
  return value;
}

export function nullableNonNegativeInteger(
  value: number | null | undefined,
  errorCode: string,
): number | null {
  if (value === null || value === undefined) return null;
  return nonNegativeInteger(value, errorCode);
}

export function timestamp(value: string, errorCode: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(errorCode);
  return new Date(parsed).toISOString();
}

export function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

export function nullableText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function dimension(value: string | null | undefined, lowerCase: boolean): string | null {
  const normalized = nullableText(value);
  if (!normalized) return null;
  if (normalized.length > MAX_DIMENSION_LENGTH) throw new Error('MEASUREMENT_DIMENSION_TOO_LONG');
  return lowerCase ? normalized.toLowerCase() : normalized;
}

function nullableMinor(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('MEASUREMENT_VALUE_MINOR_INVALID');
  return value;
}

function normalizeProperties(properties: MeasurementProperties): MeasurementProperties {
  const entries = Object.entries(properties);
  if (entries.length > MAX_PROPERTY_KEYS) throw new Error('MEASUREMENT_PROPERTIES_TOO_LARGE');
  const normalized: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of entries) {
    const normalizedKey = requireText(key, 'MEASUREMENT_PROPERTY_KEY_REQUIRED');
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('MEASUREMENT_PROPERTY_VALUE_INVALID');
    }
    normalized[normalizedKey] = value;
  }
  return normalized;
}

function issue(
  code: string,
  severity: DataQualityIssue['severity'],
  field: string | null,
  message: string,
): DataQualityIssue {
  return { code, severity, field, message };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
