import type pg from 'pg';

export const EVENT_RECORD_STATUSES = [
  'DRAFT',
  'PLANNED',
  'CONFIRMED',
  'ON_SALE',
  'SOLD_OUT',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELED',
  'ARCHIVED',
] as const;
export type EventRecordStatus = (typeof EVENT_RECORD_STATUSES)[number];

export interface EventRecord {
  readonly eventId: string;
  readonly eventKey: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly seriesKey: string | null;
  readonly name: string;
  readonly eventType: string;
  readonly status: EventRecordStatus;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timezone: string;
  readonly venueName: string | null;
  readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EventRecordRevision {
  readonly eventId: string;
  readonly revision: number;
  readonly changeType: 'CREATED' | 'DETAILS_UPDATED' | 'STATUS_CHANGED';
  readonly snapshot: EventRecord;
  readonly evidence: readonly string[];
  readonly correlationId: string;
  readonly createdAt: string;
}

export interface EventRecordExternalRef {
  readonly refId: string;
  readonly eventId: string;
  readonly provider: string;
  readonly referenceType: string;
  readonly externalId: string;
  readonly canonicalUrl: string | null;
  readonly evidence: readonly string[];
  readonly createdAt: string;
}

export interface CreateEventRecordInput {
  readonly eventId: string;
  readonly eventKey: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly seriesKey?: string | null;
  readonly name: string;
  readonly eventType: string;
  readonly status?: EventRecordStatus;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timezone: string;
  readonly venueName?: string | null;
  readonly attributes?: Readonly<Record<string, string | number | boolean | null>>;
  readonly correlationId: string;
  readonly evidence: readonly string[];
  readonly now?: string;
}

export interface UpdateEventRecordDetailsInput {
  readonly eventId: string;
  readonly expectedVersion: number;
  readonly name?: string;
  readonly eventType?: string;
  readonly seriesKey?: string | null;
  readonly startsAt?: string;
  readonly endsAt?: string;
  readonly timezone?: string;
  readonly venueName?: string | null;
  readonly attributes?: Readonly<Record<string, string | number | boolean | null>>;
  readonly correlationId: string;
  readonly evidence: readonly string[];
  readonly now?: string;
}

export interface TransitionEventRecordStatusInput {
  readonly eventId: string;
  readonly expectedVersion: number;
  readonly status: EventRecordStatus;
  readonly correlationId: string;
  readonly evidence: readonly string[];
  readonly now?: string;
}

export interface AttachEventRecordExternalRefInput {
  readonly refId: string;
  readonly eventId: string;
  readonly provider: string;
  readonly referenceType: string;
  readonly externalId: string;
  readonly canonicalUrl?: string | null;
  readonly correlationId: string;
  readonly evidence: readonly string[];
  readonly now?: string;
}

export interface EventRecordStore {
  create(input: CreateEventRecordInput): Promise<EventRecord>;
  get(eventId: string): Promise<EventRecord | undefined>;
  updateDetails(input: UpdateEventRecordDetailsInput): Promise<EventRecord>;
  transitionStatus(input: TransitionEventRecordStatusInput): Promise<EventRecord>;
  attachExternalRef(input: AttachEventRecordExternalRefInput): Promise<EventRecordExternalRef>;
  listBySeries(tenantId: string, seriesKey: string, limit?: number): Promise<readonly EventRecord[]>;
  listByTimeRange(input: {
    readonly tenantId: string;
    readonly from: string;
    readonly to: string;
    readonly limit?: number;
  }): Promise<readonly EventRecord[]>;
  listRevisions(eventId: string): Promise<readonly EventRecordRevision[]>;
  listExternalRefs(eventId: string): Promise<readonly EventRecordExternalRef[]>;
}

export interface TransactionalEventRecordWriter {
  writeRevision(
    client: pg.PoolClient,
    revision: EventRecordRevision,
  ): Promise<void>;
}

const STATUS_TRANSITIONS: Readonly<Record<EventRecordStatus, readonly EventRecordStatus[]>> = {
  DRAFT: ['PLANNED', 'CANCELED'],
  PLANNED: ['CONFIRMED', 'CANCELED'],
  CONFIRMED: ['ON_SALE', 'IN_PROGRESS', 'CANCELED'],
  ON_SALE: ['SOLD_OUT', 'IN_PROGRESS', 'CANCELED'],
  SOLD_OUT: ['IN_PROGRESS', 'CANCELED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELED'],
  COMPLETED: ['ARCHIVED'],
  CANCELED: ['ARCHIVED'],
  ARCHIVED: [],
};

export function assertEventRecordStatusTransition(
  current: EventRecordStatus,
  next: EventRecordStatus,
): void {
  if (current === next) return;
  if (!STATUS_TRANSITIONS[current].includes(next)) {
    throw new Error(`EVENT_RECORD_STATUS_TRANSITION_INVALID:${current}:${next}`);
  }
}

export function validateEventRecord(record: EventRecord): void {
  requireText(record.eventId, 'EVENT_RECORD_ID_REQUIRED');
  requireText(record.eventKey, 'EVENT_RECORD_KEY_REQUIRED');
  requireText(record.tenantId, 'EVENT_RECORD_TENANT_ID_REQUIRED');
  requireText(record.workspaceId, 'EVENT_RECORD_WORKSPACE_ID_REQUIRED');
  requireText(record.organizationId, 'EVENT_RECORD_ORGANIZATION_ID_REQUIRED');
  if (record.seriesKey !== null) requireText(record.seriesKey, 'EVENT_RECORD_SERIES_KEY_INVALID');
  requireText(record.name, 'EVENT_RECORD_NAME_REQUIRED');
  requireText(record.eventType, 'EVENT_RECORD_TYPE_REQUIRED');
  if (!EVENT_RECORD_STATUSES.includes(record.status)) throw new Error('EVENT_RECORD_STATUS_INVALID');
  validateSchedule(record.startsAt, record.endsAt, record.timezone);
  if (record.venueName !== null) requireText(record.venueName, 'EVENT_RECORD_VENUE_INVALID');
  validateAttributes(record.attributes);
  if (!Number.isInteger(record.version) || record.version < 1)
    throw new Error('EVENT_RECORD_VERSION_INVALID');
  assertTimestamp(record.createdAt, 'EVENT_RECORD_CREATED_AT_INVALID');
  assertTimestamp(record.updatedAt, 'EVENT_RECORD_UPDATED_AT_INVALID');
}

export function validateSchedule(startsAt: string, endsAt: string, timezone: string): void {
  const start = assertTimestamp(startsAt, 'EVENT_RECORD_START_INVALID');
  const end = assertTimestamp(endsAt, 'EVENT_RECORD_END_INVALID');
  if (end <= start) throw new Error('EVENT_RECORD_TIME_RANGE_INVALID');
  requireText(timezone, 'EVENT_RECORD_TIMEZONE_REQUIRED');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(startsAt));
  } catch {
    throw new Error('EVENT_RECORD_TIMEZONE_INVALID');
  }
}

export function requireEventRecordEvidence(evidence: readonly string[]): readonly string[] {
  const normalized = [...new Set(evidence.map((item) => item.trim()).filter(Boolean))].sort();
  if (normalized.length === 0) throw new Error('EVENT_RECORD_EVIDENCE_REQUIRED');
  return normalized;
}

export function validateAttributes(
  attributes: Readonly<Record<string, string | number | boolean | null>>,
): void {
  for (const [key, value] of Object.entries(attributes)) {
    requireText(key, 'EVENT_RECORD_ATTRIBUTE_KEY_REQUIRED');
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new Error('EVENT_RECORD_ATTRIBUTE_VALUE_INVALID');
  }
}

export function assertEventRecordLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new Error('EVENT_RECORD_LIMIT_INVALID');
}

function assertTimestamp(value: string, errorCode: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(errorCode);
  return parsed;
}

function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}
