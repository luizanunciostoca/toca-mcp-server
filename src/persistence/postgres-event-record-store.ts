import type pg from 'pg';
import { createDomainEvent } from '../events/domain-events.js';
import {
  assertEventRecordLimit,
  assertEventRecordStatusTransition,
  requireEventRecordEvidence,
  validateAttributes,
  validateEventRecord,
  validateSchedule,
  type AttachEventRecordExternalRefInput,
  type CreateEventRecordInput,
  type EventRecord,
  type EventRecordExternalRef,
  type EventRecordRevision,
  type EventRecordStore,
  type TransitionEventRecordStatusInput,
  type UpdateEventRecordDetailsInput,
} from '../events/event-record.js';
import { PostgresTransactionalOutbox } from '../events/postgres-transactional-outbox.js';
import type { TransactionalOutboxWriter } from '../events/transactional-outbox.js';

interface EventRecordRow {
  readonly event_id: string;
  readonly event_key: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly series_key: string | null;
  readonly name: string;
  readonly event_type: string;
  readonly status: EventRecord['status'];
  readonly starts_at: Date | string;
  readonly ends_at: Date | string;
  readonly timezone: string;
  readonly venue_name: string | null;
  readonly attributes: unknown;
  readonly version: number;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface EventRecordRevisionRow {
  readonly event_id: string;
  readonly revision: number;
  readonly change_type: EventRecordRevision['changeType'];
  readonly snapshot: unknown;
  readonly evidence: unknown;
  readonly correlation_id: string;
  readonly created_at: Date | string;
}

interface EventRecordExternalRefRow {
  readonly ref_id: string;
  readonly event_id: string;
  readonly provider: string;
  readonly reference_type: string;
  readonly external_id: string;
  readonly canonical_url: string | null;
  readonly evidence: unknown;
  readonly created_at: Date | string;
}

export interface PostgresEventRecordStoreOptions {
  readonly outbox?: TransactionalOutboxWriter;
}

export class PostgresEventRecordStore implements EventRecordStore {
  readonly #outbox: TransactionalOutboxWriter;

  constructor(
    private readonly pool: pg.Pool,
    options: PostgresEventRecordStoreOptions = {},
  ) {
    this.#outbox = options.outbox ?? new PostgresTransactionalOutbox(pool);
  }

  async create(input: CreateEventRecordInput): Promise<EventRecord> {
    const now = normalizeNow(input.now);
    const evidence = requireEventRecordEvidence(input.evidence);
    const record: EventRecord = {
      eventId: requireText(input.eventId, 'EVENT_RECORD_ID_REQUIRED'),
      eventKey: requireText(input.eventKey, 'EVENT_RECORD_KEY_REQUIRED'),
      tenantId: requireText(input.tenantId, 'EVENT_RECORD_TENANT_ID_REQUIRED'),
      workspaceId: requireText(input.workspaceId, 'EVENT_RECORD_WORKSPACE_ID_REQUIRED'),
      organizationId: requireText(input.organizationId, 'EVENT_RECORD_ORGANIZATION_ID_REQUIRED'),
      seriesKey: nullableText(input.seriesKey),
      name: requireText(input.name, 'EVENT_RECORD_NAME_REQUIRED'),
      eventType: requireText(input.eventType, 'EVENT_RECORD_TYPE_REQUIRED'),
      status: input.status ?? 'DRAFT',
      startsAt: normalizeTimestamp(input.startsAt, 'EVENT_RECORD_START_INVALID'),
      endsAt: normalizeTimestamp(input.endsAt, 'EVENT_RECORD_END_INVALID'),
      timezone: requireText(input.timezone, 'EVENT_RECORD_TIMEZONE_REQUIRED'),
      venueName: nullableText(input.venueName),
      attributes: input.attributes ?? {},
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    validateEventRecord(record);
    requireText(input.correlationId, 'EVENT_RECORD_CORRELATION_ID_REQUIRED');

    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const inserted = await client.query<EventRecordRow>(
        `insert into event_records (
           event_id, event_key, tenant_id, workspace_id, organization_id, series_key,
           name, event_type, status, starts_at, ends_at, timezone, venue_name,
           attributes, version, created_at, updated_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz,
           $11::timestamptz, $12, $13, $14::jsonb, 1, $15::timestamptz, $15::timestamptz
         )
         on conflict (tenant_id, event_key) do nothing
         returning *`,
        [
          record.eventId,
          record.eventKey,
          record.tenantId,
          record.workspaceId,
          record.organizationId,
          record.seriesKey,
          record.name,
          record.eventType,
          record.status,
          record.startsAt,
          record.endsAt,
          record.timezone,
          record.venueName,
          json(record.attributes),
          now,
        ],
      );
      const insertedRow = inserted.rows[0];
      if (!insertedRow) {
        const existingResult = await client.query<EventRecordRow>(
          `select * from event_records
           where tenant_id = $1 and event_key = $2`,
          [record.tenantId, record.eventKey],
        );
        const existingRow = existingResult.rows[0];
        if (!existingRow) throw new Error('EVENT_RECORD_IDEMPOTENCY_LOOKUP_FAILED');
        const existing = eventRecordFromRow(existingRow);
        if (!sameCreateIntent(existing, record)) throw new Error('EVENT_RECORD_IDEMPOTENCY_CONFLICT');
        await client.query('commit');
        return existing;
      }

      const created = eventRecordFromRow(insertedRow);
      await this.#appendRevisionAndOutbox(client, {
        record: created,
        changeType: 'CREATED',
        correlationId: input.correlationId,
        evidence,
        now,
      });
      await client.query('commit');
      return created;
    } catch (error) {
      await client.query('rollback');
      if (isPrimaryKeyViolation(error)) throw new Error('EVENT_RECORD_ID_CONFLICT');
      throw error;
    } finally {
      client.release();
    }
  }

  async get(eventId: string): Promise<EventRecord | undefined> {
    requireText(eventId, 'EVENT_RECORD_ID_REQUIRED');
    const result = await this.pool.query<EventRecordRow>(
      'select * from event_records where event_id = $1',
      [eventId],
    );
    const row = result.rows[0];
    return row ? eventRecordFromRow(row) : undefined;
  }

  async updateDetails(input: UpdateEventRecordDetailsInput): Promise<EventRecord> {
    const now = normalizeNow(input.now);
    const evidence = requireEventRecordEvidence(input.evidence);
    requireText(input.correlationId, 'EVENT_RECORD_CORRELATION_ID_REQUIRED');
    assertVersion(input.expectedVersion);

    return this.#withLockedEvent(input.eventId, async (client, current) => {
      assertExpectedVersion(current, input.expectedVersion);
      const next: EventRecord = {
        ...current,
        seriesKey: input.seriesKey === undefined ? current.seriesKey : nullableText(input.seriesKey),
        name: input.name === undefined ? current.name : requireText(input.name, 'EVENT_RECORD_NAME_REQUIRED'),
        eventType:
          input.eventType === undefined
            ? current.eventType
            : requireText(input.eventType, 'EVENT_RECORD_TYPE_REQUIRED'),
        startsAt:
          input.startsAt === undefined
            ? current.startsAt
            : normalizeTimestamp(input.startsAt, 'EVENT_RECORD_START_INVALID'),
        endsAt:
          input.endsAt === undefined
            ? current.endsAt
            : normalizeTimestamp(input.endsAt, 'EVENT_RECORD_END_INVALID'),
        timezone:
          input.timezone === undefined
            ? current.timezone
            : requireText(input.timezone, 'EVENT_RECORD_TIMEZONE_REQUIRED'),
        venueName:
          input.venueName === undefined ? current.venueName : nullableText(input.venueName),
        attributes: input.attributes === undefined ? current.attributes : input.attributes,
        version: current.version + 1,
        updatedAt: now,
      };
      validateEventRecord(next);
      const updated = await this.#updateRecord(client, current, next);
      await this.#appendRevisionAndOutbox(client, {
        record: updated,
        changeType: 'DETAILS_UPDATED',
        correlationId: input.correlationId,
        evidence,
        now,
      });
      return updated;
    });
  }

  async transitionStatus(input: TransitionEventRecordStatusInput): Promise<EventRecord> {
    const now = normalizeNow(input.now);
    const evidence = requireEventRecordEvidence(input.evidence);
    requireText(input.correlationId, 'EVENT_RECORD_CORRELATION_ID_REQUIRED');
    assertVersion(input.expectedVersion);

    return this.#withLockedEvent(input.eventId, async (client, current) => {
      assertExpectedVersion(current, input.expectedVersion);
      assertEventRecordStatusTransition(current.status, input.status);
      if (current.status === input.status) return current;
      const next: EventRecord = {
        ...current,
        status: input.status,
        version: current.version + 1,
        updatedAt: now,
      };
      const updated = await this.#updateRecord(client, current, next);
      await this.#appendRevisionAndOutbox(client, {
        record: updated,
        changeType: 'STATUS_CHANGED',
        correlationId: input.correlationId,
        evidence,
        now,
      });
      return updated;
    });
  }

  async attachExternalRef(
    input: AttachEventRecordExternalRefInput,
  ): Promise<EventRecordExternalRef> {
    const now = normalizeNow(input.now);
    const evidence = requireEventRecordEvidence(input.evidence);
    requireText(input.correlationId, 'EVENT_RECORD_CORRELATION_ID_REQUIRED');
    const ref: EventRecordExternalRef = {
      refId: requireText(input.refId, 'EVENT_RECORD_REF_ID_REQUIRED'),
      eventId: requireText(input.eventId, 'EVENT_RECORD_ID_REQUIRED'),
      provider: requireText(input.provider, 'EVENT_RECORD_PROVIDER_REQUIRED'),
      referenceType: requireText(input.referenceType, 'EVENT_RECORD_REFERENCE_TYPE_REQUIRED'),
      externalId: requireText(input.externalId, 'EVENT_RECORD_EXTERNAL_ID_REQUIRED'),
      canonicalUrl: normalizeUrl(input.canonicalUrl),
      evidence,
      createdAt: now,
    };

    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const event = await lockEvent(client, ref.eventId);
      const inserted = await client.query<EventRecordExternalRefRow>(
        `insert into event_record_external_refs (
           ref_id, event_id, provider, reference_type, external_id,
           canonical_url, evidence, created_at
         ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)
         on conflict (provider, reference_type, external_id) do nothing
         returning *`,
        [
          ref.refId,
          ref.eventId,
          ref.provider,
          ref.referenceType,
          ref.externalId,
          ref.canonicalUrl,
          json(ref.evidence),
          ref.createdAt,
        ],
      );
      const insertedRow = inserted.rows[0];
      if (!insertedRow) {
        const existingResult = await client.query<EventRecordExternalRefRow>(
          `select * from event_record_external_refs
           where provider = $1 and reference_type = $2 and external_id = $3`,
          [ref.provider, ref.referenceType, ref.externalId],
        );
        const existingRow = existingResult.rows[0];
        if (!existingRow) throw new Error('EVENT_RECORD_EXTERNAL_REF_LOOKUP_FAILED');
        const existing = externalRefFromRow(existingRow);
        if (existing.eventId !== ref.eventId || existing.refId !== ref.refId)
          throw new Error('EVENT_RECORD_EXTERNAL_REF_CONFLICT');
        await client.query('commit');
        return existing;
      }

      const created = externalRefFromRow(insertedRow);
      await this.#outbox.enqueue(
        client,
        createDomainEvent({
          eventKey: `external-ref:${created.refId}`,
          eventType: 'business_event.external_ref_attached',
          aggregateType: 'business_event',
          aggregateId: event.eventId,
          aggregateVersion: event.version,
          tenantId: event.tenantId,
          workspaceId: event.workspaceId,
          organizationId: event.organizationId,
          correlationId: input.correlationId,
          causationId: null,
          occurredAt: now,
          payload: {
            eventId: event.eventId,
            refId: created.refId,
            provider: created.provider,
            referenceType: created.referenceType,
            externalId: created.externalId,
            canonicalUrl: created.canonicalUrl,
          },
          evidence,
        }),
      );
      await client.query('commit');
      return created;
    } catch (error) {
      await client.query('rollback');
      if (isPrimaryKeyViolation(error)) throw new Error('EVENT_RECORD_REF_ID_CONFLICT');
      throw error;
    } finally {
      client.release();
    }
  }

  async listBySeries(
    tenantId: string,
    seriesKey: string,
    limit = 200,
  ): Promise<readonly EventRecord[]> {
    requireText(tenantId, 'EVENT_RECORD_TENANT_ID_REQUIRED');
    requireText(seriesKey, 'EVENT_RECORD_SERIES_KEY_REQUIRED');
    assertEventRecordLimit(limit);
    const result = await this.pool.query<EventRecordRow>(
      `select * from event_records
       where tenant_id = $1 and series_key = $2
       order by starts_at asc, event_id asc
       limit $3`,
      [tenantId, seriesKey, limit],
    );
    return result.rows.map(eventRecordFromRow);
  }

  async listByTimeRange(input: {
    readonly tenantId: string;
    readonly from: string;
    readonly to: string;
    readonly limit?: number;
  }): Promise<readonly EventRecord[]> {
    requireText(input.tenantId, 'EVENT_RECORD_TENANT_ID_REQUIRED');
    const from = normalizeTimestamp(input.from, 'EVENT_RECORD_RANGE_FROM_INVALID');
    const to = normalizeTimestamp(input.to, 'EVENT_RECORD_RANGE_TO_INVALID');
    if (Date.parse(to) <= Date.parse(from)) throw new Error('EVENT_RECORD_RANGE_INVALID');
    const limit = input.limit ?? 500;
    assertEventRecordLimit(limit);
    const result = await this.pool.query<EventRecordRow>(
      `select * from event_records
       where tenant_id = $1
         and starts_at < $3::timestamptz
         and ends_at > $2::timestamptz
       order by starts_at asc, event_id asc
       limit $4`,
      [input.tenantId, from, to, limit],
    );
    return result.rows.map(eventRecordFromRow);
  }

  async listRevisions(eventId: string): Promise<readonly EventRecordRevision[]> {
    requireText(eventId, 'EVENT_RECORD_ID_REQUIRED');
    const result = await this.pool.query<EventRecordRevisionRow>(
      `select * from event_record_revisions
       where event_id = $1 order by revision asc`,
      [eventId],
    );
    return result.rows.map(revisionFromRow);
  }

  async listExternalRefs(eventId: string): Promise<readonly EventRecordExternalRef[]> {
    requireText(eventId, 'EVENT_RECORD_ID_REQUIRED');
    const result = await this.pool.query<EventRecordExternalRefRow>(
      `select * from event_record_external_refs
       where event_id = $1 order by provider asc, reference_type asc, ref_id asc`,
      [eventId],
    );
    return result.rows.map(externalRefFromRow);
  }

  async #withLockedEvent<T>(
    eventId: string,
    action: (client: pg.PoolClient, current: EventRecord) => Promise<T>,
  ): Promise<T> {
    requireText(eventId, 'EVENT_RECORD_ID_REQUIRED');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const current = await lockEvent(client, eventId);
      const result = await action(client, current);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async #updateRecord(
    client: pg.PoolClient,
    current: EventRecord,
    next: EventRecord,
  ): Promise<EventRecord> {
    validateSchedule(next.startsAt, next.endsAt, next.timezone);
    validateAttributes(next.attributes);
    const updated = await client.query<EventRecordRow>(
      `update event_records set
         series_key = $3, name = $4, event_type = $5, status = $6,
         starts_at = $7::timestamptz, ends_at = $8::timestamptz,
         timezone = $9, venue_name = $10, attributes = $11::jsonb,
         version = $12, updated_at = $13::timestamptz
       where event_id = $1 and version = $2
       returning *`,
      [
        current.eventId,
        current.version,
        next.seriesKey,
        next.name,
        next.eventType,
        next.status,
        next.startsAt,
        next.endsAt,
        next.timezone,
        next.venueName,
        json(next.attributes),
        next.version,
        next.updatedAt,
      ],
    );
    const row = updated.rows[0];
    if (!row) throw new Error('EVENT_RECORD_CONCURRENT_UPDATE');
    return eventRecordFromRow(row);
  }

  async #appendRevisionAndOutbox(
    client: pg.PoolClient,
    input: {
      readonly record: EventRecord;
      readonly changeType: EventRecordRevision['changeType'];
      readonly correlationId: string;
      readonly evidence: readonly string[];
      readonly now: string;
    },
  ): Promise<void> {
    const revision: EventRecordRevision = {
      eventId: input.record.eventId,
      revision: input.record.version,
      changeType: input.changeType,
      snapshot: input.record,
      evidence: input.evidence,
      correlationId: input.correlationId,
      createdAt: input.now,
    };
    await client.query(
      `insert into event_record_revisions (
         event_id, revision, change_type, snapshot, evidence, correlation_id, created_at
       ) values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::timestamptz)`,
      [
        revision.eventId,
        revision.revision,
        revision.changeType,
        json(revision.snapshot),
        json(revision.evidence),
        revision.correlationId,
        revision.createdAt,
      ],
    );
    await this.#outbox.enqueue(
      client,
      createDomainEvent({
        eventKey: `revision:${revision.revision}:${revision.changeType.toLowerCase()}`,
        eventType: `business_event.${revision.changeType.toLowerCase()}`,
        aggregateType: 'business_event',
        aggregateId: input.record.eventId,
        aggregateVersion: input.record.version,
        tenantId: input.record.tenantId,
        workspaceId: input.record.workspaceId,
        organizationId: input.record.organizationId,
        correlationId: input.correlationId,
        causationId: null,
        occurredAt: input.now,
        payload: {
          eventId: input.record.eventId,
          eventKey: input.record.eventKey,
          seriesKey: input.record.seriesKey,
          status: input.record.status,
          revision: input.record.version,
          snapshot: input.record,
        },
        evidence: input.evidence,
      }),
    );
  }
}

async function lockEvent(client: pg.PoolClient, eventId: string): Promise<EventRecord> {
  const result = await client.query<EventRecordRow>(
    'select * from event_records where event_id = $1 for update',
    [eventId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('EVENT_RECORD_NOT_FOUND');
  return eventRecordFromRow(row);
}

function eventRecordFromRow(row: EventRecordRow): EventRecord {
  const record: EventRecord = {
    eventId: row.event_id,
    eventKey: row.event_key,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    seriesKey: row.series_key,
    name: row.name,
    eventType: row.event_type,
    status: row.status,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    timezone: row.timezone,
    venueName: row.venue_name,
    attributes: asAttributes(row.attributes),
    version: row.version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  validateEventRecord(record);
  return record;
}

function revisionFromRow(row: EventRecordRevisionRow): EventRecordRevision {
  const snapshot = asEventRecord(row.snapshot);
  return {
    eventId: row.event_id,
    revision: row.revision,
    changeType: row.change_type,
    snapshot,
    evidence: asStringArray(row.evidence),
    correlationId: row.correlation_id,
    createdAt: iso(row.created_at),
  };
}

function externalRefFromRow(row: EventRecordExternalRefRow): EventRecordExternalRef {
  return {
    refId: row.ref_id,
    eventId: row.event_id,
    provider: row.provider,
    referenceType: row.reference_type,
    externalId: row.external_id,
    canonicalUrl: row.canonical_url,
    evidence: asStringArray(row.evidence),
    createdAt: iso(row.created_at),
  };
}

function sameCreateIntent(left: EventRecord, right: EventRecord): boolean {
  return (
    left.eventId === right.eventId &&
    left.eventKey === right.eventKey &&
    left.tenantId === right.tenantId &&
    left.workspaceId === right.workspaceId &&
    left.organizationId === right.organizationId &&
    left.seriesKey === right.seriesKey &&
    left.name === right.name &&
    left.eventType === right.eventType &&
    left.status === right.status &&
    left.startsAt === right.startsAt &&
    left.endsAt === right.endsAt &&
    left.timezone === right.timezone &&
    left.venueName === right.venueName &&
    JSON.stringify(left.attributes) === JSON.stringify(right.attributes)
  );
}

function asEventRecord(value: unknown): EventRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('EVENT_RECORD_REVISION_SNAPSHOT_INVALID');
  const candidate = value as EventRecord;
  validateEventRecord(candidate);
  return candidate;
}

function asAttributes(
  value: unknown,
): Readonly<Record<string, string | number | boolean | null>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>);
  const normalized: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of entries) {
    if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) {
      normalized[key] = item as string | number | boolean | null;
    }
  }
  return normalized;
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function normalizeNow(value: string | undefined): string {
  return normalizeTimestamp(value ?? new Date().toISOString(), 'EVENT_RECORD_NOW_INVALID');
}

function normalizeTimestamp(value: string, errorCode: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(errorCode);
  return new Date(parsed).toISOString();
}

function normalizeUrl(value: string | null | undefined): string | null {
  const normalized = nullableText(value);
  if (normalized === null) return null;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error('EVENT_RECORD_CANONICAL_URL_INVALID');
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('EVENT_RECORD_CANONICAL_URL_INVALID');
  return url.toString();
}

function nullableText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

function assertVersion(value: number): void {
  if (!Number.isInteger(value) || value < 1) throw new Error('EVENT_RECORD_VERSION_INVALID');
}

function assertExpectedVersion(record: EventRecord, expected: number): void {
  if (record.version !== expected) throw new Error('EVENT_RECORD_VERSION_CONFLICT');
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function isPrimaryKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === '23505'
  );
}
