import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  assertOutboxLimit,
  assertTimestamp,
  mergeEventEvidence,
  requireEventEvidence,
  validateDomainEvent,
  type ClaimedOutboxEvent,
  type DomainEventEnvelope,
  type EventOutboxStore,
  type OutboxDeliveryAttempt,
  type OutboxRecord,
} from './transactional-outbox.js';

interface OutboxRow {
  readonly event_id: string;
  readonly event_key: string;
  readonly event_type: string;
  readonly schema_version: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly aggregate_version: number;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly occurred_at: Date | string;
  readonly payload: unknown;
  readonly evidence: unknown;
  readonly status: OutboxRecord['status'];
  readonly available_at: Date | string;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly claimed_by: string | null;
  readonly claim_execution_id: string | null;
  readonly claimed_at: Date | string | null;
  readonly delivered_at: Date | string | null;
  readonly last_error_code: string | null;
  readonly version: number;
}

interface DeliveryAttemptRow {
  readonly execution_id: string;
  readonly event_id: string;
  readonly worker_id: string;
  readonly attempt_number: number;
  readonly status: OutboxDeliveryAttempt['status'];
  readonly claimed_at: Date | string;
  readonly completed_at: Date | string | null;
  readonly error_code: string | null;
  readonly evidence: unknown;
}

export interface PostgresEventOutboxOptions {
  readonly createId?: () => string;
}

export class PostgresEventOutboxStore implements EventOutboxStore {
  readonly #createId: () => string;

  constructor(
    private readonly pool: pg.Pool,
    options: PostgresEventOutboxOptions = {},
  ) {
    this.#createId = options.createId ?? randomUUID;
  }

  async enqueue(
    client: pg.PoolClient,
    event: DomainEventEnvelope,
    options: { readonly availableAt?: string; readonly maxAttempts?: number } = {},
  ): Promise<void> {
    validateDomainEvent(event);
    const availableAt = options.availableAt ?? event.occurredAt;
    assertTimestamp(availableAt, 'OUTBOX_AVAILABLE_AT_INVALID');
    const maxAttempts = options.maxAttempts ?? 5;
    assertMaxAttempts(maxAttempts);

    try {
      const inserted = await client.query(
        `insert into event_outbox (
           event_id, event_key, event_type, schema_version, aggregate_type, aggregate_id,
           aggregate_version, tenant_id, workspace_id, organization_id, correlation_id,
           causation_id, occurred_at, payload, evidence, status, available_at, attempts,
           max_attempts, claimed_by, claim_execution_id, claimed_at, delivered_at,
           last_error_code, version
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
           $13::timestamptz, $14::jsonb, $15::jsonb, 'PENDING', $16::timestamptz,
           0, $17, null, null, null, null, null, 1
         )
         on conflict (event_id) do nothing`,
        [
          event.eventId,
          event.eventKey,
          event.eventType,
          event.schemaVersion,
          event.aggregateType,
          event.aggregateId,
          event.aggregateVersion,
          event.tenantId,
          event.workspaceId,
          event.organizationId,
          event.correlationId,
          event.causationId,
          event.occurredAt,
          json(event.payload),
          json(requireEventEvidence(event.evidence)),
          availableAt,
          maxAttempts,
        ],
      );
      if (inserted.rowCount === 1) return;

      const existing = await client.query<OutboxRow>(
        'select * from event_outbox where event_id = $1',
        [event.eventId],
      );
      const row = existing.rows[0];
      if (!row || !sameEventIdentity(row, event)) throw new Error('OUTBOX_EVENT_ID_CONFLICT');
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error('OUTBOX_EVENT_KEY_CONFLICT');
      throw error;
    }
  }

  async get(eventId: string): Promise<OutboxRecord | undefined> {
    requireText(eventId, 'OUTBOX_EVENT_ID_REQUIRED');
    const result = await this.pool.query<OutboxRow>(
      'select * from event_outbox where event_id = $1',
      [eventId],
    );
    const row = result.rows[0];
    return row ? outboxFromRow(row) : undefined;
  }

  async claimAvailable(input: {
    readonly workerId: string;
    readonly now: string;
    readonly limit: number;
  }): Promise<readonly ClaimedOutboxEvent[]> {
    requireText(input.workerId, 'OUTBOX_WORKER_ID_REQUIRED');
    assertTimestamp(input.now, 'OUTBOX_NOW_INVALID');
    assertOutboxLimit(input.limit);

    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const selected = await client.query<OutboxRow>(
        `select * from event_outbox
         where status in ('PENDING', 'FAILED_RETRYABLE')
           and available_at <= $1::timestamptz
           and attempts < max_attempts
         order by available_at asc, occurred_at asc, event_id asc
         for update skip locked
         limit $2`,
        [input.now, input.limit],
      );

      const claimed: ClaimedOutboxEvent[] = [];
      for (const row of selected.rows) {
        const executionId = this.#createId();
        const attemptNumber = row.attempts + 1;
        await client.query(
          `insert into event_outbox_delivery_attempts (
             execution_id, event_id, worker_id, attempt_number, status,
             claimed_at, completed_at, error_code, evidence
           ) values ($1, $2, $3, $4, 'CLAIMED', $5::timestamptz, null, null, '[]'::jsonb)`,
          [executionId, row.event_id, input.workerId, attemptNumber, input.now],
        );
        const updated = await client.query<OutboxRow>(
          `update event_outbox set
             status = 'CLAIMED', attempts = $2, claimed_by = $3,
             claim_execution_id = $4, claimed_at = $5::timestamptz,
             last_error_code = null, version = version + 1
           where event_id = $1 and version = $6
           returning *`,
          [row.event_id, attemptNumber, input.workerId, executionId, input.now, row.version],
        );
        const claimedRow = updated.rows[0];
        if (!claimedRow) throw new Error('OUTBOX_CONCURRENT_UPDATE');
        claimed.push({
          record: outboxFromRow(claimedRow),
          delivery: {
            executionId,
            eventId: row.event_id,
            workerId: input.workerId,
            attemptNumber,
            status: 'CLAIMED',
            claimedAt: input.now,
            completedAt: null,
            errorCode: null,
            evidence: [],
          },
        });
      }
      await client.query('commit');
      return claimed;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async markDelivered(input: {
    readonly eventId: string;
    readonly executionId: string;
    readonly evidence: readonly string[];
    readonly now: string;
  }): Promise<OutboxRecord> {
    const evidence = requireEventEvidence(input.evidence);
    assertTimestamp(input.now, 'OUTBOX_NOW_INVALID');
    return this.#finishClaim({
      eventId: input.eventId,
      executionId: input.executionId,
      evidence,
      now: input.now,
      outcome: 'DELIVERED',
      errorCode: null,
      nextAttemptAt: input.now,
    });
  }

  async markFailed(input: {
    readonly eventId: string;
    readonly executionId: string;
    readonly errorCode: string;
    readonly evidence: readonly string[];
    readonly now: string;
    readonly nextAttemptAt?: string;
  }): Promise<OutboxRecord> {
    requireText(input.errorCode, 'OUTBOX_ERROR_CODE_REQUIRED');
    const evidence = requireEventEvidence(input.evidence);
    assertTimestamp(input.now, 'OUTBOX_NOW_INVALID');
    const nextAttemptAt = input.nextAttemptAt ?? input.now;
    assertTimestamp(nextAttemptAt, 'OUTBOX_NEXT_ATTEMPT_AT_INVALID');
    return this.#finishClaim({
      eventId: input.eventId,
      executionId: input.executionId,
      evidence,
      now: input.now,
      outcome: 'FAILED',
      errorCode: input.errorCode,
      nextAttemptAt,
    });
  }

  async recoverStaleClaims(input: {
    readonly staleBefore: string;
    readonly now: string;
    readonly limit: number;
    readonly evidence: readonly string[];
    readonly nextAttemptAt?: string;
  }): Promise<readonly string[]> {
    assertTimestamp(input.staleBefore, 'OUTBOX_STALE_BEFORE_INVALID');
    assertTimestamp(input.now, 'OUTBOX_NOW_INVALID');
    assertOutboxLimit(input.limit);
    const evidence = requireEventEvidence(input.evidence);
    const nextAttemptAt = input.nextAttemptAt ?? input.now;
    assertTimestamp(nextAttemptAt, 'OUTBOX_NEXT_ATTEMPT_AT_INVALID');

    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const selected = await client.query<OutboxRow>(
        `select * from event_outbox
         where status = 'CLAIMED' and claimed_at < $1::timestamptz
         order by claimed_at asc, event_id asc
         for update skip locked
         limit $2`,
        [input.staleBefore, input.limit],
      );
      const recovered: string[] = [];
      for (const row of selected.rows) {
        if (!row.claim_execution_id) throw new Error('OUTBOX_CLAIM_EXECUTION_ID_MISSING');
        const deadLetter = row.attempts >= row.max_attempts;
        const status = deadLetter ? 'DEAD_LETTER' : 'FAILED_RETRYABLE';
        const attemptUpdated = await client.query(
          `update event_outbox_delivery_attempts set
             status = $3, completed_at = $4::timestamptz,
             error_code = 'OUTBOX_STALE_CLAIM', evidence = $5::jsonb
           where execution_id = $1 and event_id = $2 and status = 'CLAIMED'`,
          [row.claim_execution_id, row.event_id, status, input.now, json(evidence)],
        );
        if (attemptUpdated.rowCount !== 1) throw new Error('OUTBOX_STALE_ATTEMPT_NOT_CLAIMED');
        const eventUpdated = await client.query(
          `update event_outbox set
             status = $2, available_at = $3::timestamptz,
             claimed_by = null, claim_execution_id = null, claimed_at = null,
             last_error_code = 'OUTBOX_STALE_CLAIM', version = version + 1
           where event_id = $1 and version = $4`,
          [row.event_id, status, nextAttemptAt, row.version],
        );
        if (eventUpdated.rowCount !== 1) throw new Error('OUTBOX_CONCURRENT_UPDATE');
        recovered.push(row.event_id);
      }
      await client.query('commit');
      return recovered;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async beginConsumerReceipt(
    client: pg.PoolClient,
    input: {
      readonly consumerId: string;
      readonly eventId: string;
      readonly executionId: string;
      readonly evidence: readonly string[];
      readonly now: string;
    },
  ): Promise<'CLAIMED' | 'ALREADY_PROCESSED' | 'IN_PROGRESS'> {
    requireText(input.consumerId, 'OUTBOX_CONSUMER_ID_REQUIRED');
    requireText(input.eventId, 'OUTBOX_EVENT_ID_REQUIRED');
    requireText(input.executionId, 'OUTBOX_EXECUTION_ID_REQUIRED');
    const evidence = requireEventEvidence(input.evidence);
    assertTimestamp(input.now, 'OUTBOX_NOW_INVALID');

    const inserted = await client.query(
      `insert into event_consumer_receipts (
         consumer_id, event_id, execution_id, status, claimed_at,
         processed_at, evidence, version
       ) values ($1, $2, $3, 'PROCESSING', $4::timestamptz, null, $5::jsonb, 1)
       on conflict (consumer_id, event_id) do nothing`,
      [input.consumerId, input.eventId, input.executionId, input.now, json(evidence)],
    );
    if (inserted.rowCount === 1) return 'CLAIMED';

    const existing = await client.query<{
      status: 'PROCESSING' | 'PROCESSED';
      execution_id: string;
    }>(
      `select status, execution_id from event_consumer_receipts
       where consumer_id = $1 and event_id = $2 for update`,
      [input.consumerId, input.eventId],
    );
    const row = existing.rows[0];
    if (!row) throw new Error('OUTBOX_CONSUMER_RECEIPT_NOT_FOUND');
    if (row.status === 'PROCESSED') return 'ALREADY_PROCESSED';
    return 'IN_PROGRESS';
  }

  async completeConsumerReceipt(
    client: pg.PoolClient,
    input: {
      readonly consumerId: string;
      readonly eventId: string;
      readonly executionId: string;
      readonly evidence: readonly string[];
      readonly now: string;
    },
  ): Promise<void> {
    requireText(input.consumerId, 'OUTBOX_CONSUMER_ID_REQUIRED');
    requireText(input.eventId, 'OUTBOX_EVENT_ID_REQUIRED');
    requireText(input.executionId, 'OUTBOX_EXECUTION_ID_REQUIRED');
    const evidence = requireEventEvidence(input.evidence);
    assertTimestamp(input.now, 'OUTBOX_NOW_INVALID');

    const existing = await client.query<{
      status: 'PROCESSING' | 'PROCESSED';
      execution_id: string;
      evidence: unknown;
      version: number;
    }>(
      `select status, execution_id, evidence, version from event_consumer_receipts
       where consumer_id = $1 and event_id = $2 for update`,
      [input.consumerId, input.eventId],
    );
    const row = existing.rows[0];
    if (!row) throw new Error('OUTBOX_CONSUMER_RECEIPT_NOT_FOUND');
    if (row.status === 'PROCESSED') {
      if (row.execution_id !== input.executionId)
        throw new Error('OUTBOX_CONSUMER_RECEIPT_ALREADY_PROCESSED');
      return;
    }
    if (row.execution_id !== input.executionId) throw new Error('OUTBOX_CONSUMER_RECEIPT_STALE');

    const updated = await client.query(
      `update event_consumer_receipts set
         status = 'PROCESSED', processed_at = $4::timestamptz,
         evidence = $5::jsonb, version = version + 1
       where consumer_id = $1 and event_id = $2 and execution_id = $3 and version = $6`,
      [
        input.consumerId,
        input.eventId,
        input.executionId,
        input.now,
        json(mergeEventEvidence(asStringArray(row.evidence), evidence)),
        row.version,
      ],
    );
    if (updated.rowCount !== 1) throw new Error('OUTBOX_CONSUMER_RECEIPT_CONCURRENT_UPDATE');
  }

  async #finishClaim(input: {
    readonly eventId: string;
    readonly executionId: string;
    readonly evidence: readonly string[];
    readonly now: string;
    readonly outcome: 'DELIVERED' | 'FAILED';
    readonly errorCode: string | null;
    readonly nextAttemptAt: string;
  }): Promise<OutboxRecord> {
    requireText(input.eventId, 'OUTBOX_EVENT_ID_REQUIRED');
    requireText(input.executionId, 'OUTBOX_EXECUTION_ID_REQUIRED');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const selected = await client.query<OutboxRow>(
        'select * from event_outbox where event_id = $1 for update',
        [input.eventId],
      );
      const row = selected.rows[0];
      if (!row) throw new Error('OUTBOX_EVENT_NOT_FOUND');
      if (row.status !== 'CLAIMED' || row.claim_execution_id !== input.executionId)
        throw new Error('OUTBOX_STALE_CLAIM');

      const deadLetter = input.outcome === 'FAILED' && row.attempts >= row.max_attempts;
      const status =
        input.outcome === 'DELIVERED'
          ? 'DELIVERED'
          : deadLetter
            ? 'DEAD_LETTER'
            : 'FAILED_RETRYABLE';
      const attemptUpdated = await client.query(
        `update event_outbox_delivery_attempts set
           status = $3, completed_at = $4::timestamptz,
           error_code = $5, evidence = $6::jsonb
         where execution_id = $1 and event_id = $2 and status = 'CLAIMED'`,
        [input.executionId, input.eventId, status, input.now, input.errorCode, json(input.evidence)],
      );
      if (attemptUpdated.rowCount !== 1) throw new Error('OUTBOX_DELIVERY_ATTEMPT_STALE');

      const updated = await client.query<OutboxRow>(
        `update event_outbox set
           status = $2, available_at = $3::timestamptz,
           claimed_by = null, claim_execution_id = null, claimed_at = null,
           delivered_at = case when $2 = 'DELIVERED' then $4::timestamptz else delivered_at end,
           last_error_code = $5, version = version + 1
         where event_id = $1 and version = $6
         returning *`,
        [input.eventId, status, input.nextAttemptAt, input.now, input.errorCode, row.version],
      );
      const updatedRow = updated.rows[0];
      if (!updatedRow) throw new Error('OUTBOX_CONCURRENT_UPDATE');
      await client.query('commit');
      return outboxFromRow(updatedRow);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}

function outboxFromRow(row: OutboxRow): OutboxRecord {
  return {
    eventId: row.event_id,
    eventKey: row.event_key,
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    aggregateVersion: row.aggregate_version,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    occurredAt: iso(row.occurred_at),
    payload: row.payload,
    evidence: asStringArray(row.evidence),
    status: row.status,
    availableAt: iso(row.available_at),
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    claimedBy: row.claimed_by,
    claimExecutionId: row.claim_execution_id,
    claimedAt: row.claimed_at ? iso(row.claimed_at) : null,
    deliveredAt: row.delivered_at ? iso(row.delivered_at) : null,
    lastErrorCode: row.last_error_code,
    version: row.version,
  };
}

function sameEventIdentity(row: OutboxRow, event: DomainEventEnvelope): boolean {
  return (
    row.event_key === event.eventKey &&
    row.event_type === event.eventType &&
    row.schema_version === event.schemaVersion &&
    row.aggregate_type === event.aggregateType &&
    row.aggregate_id === event.aggregateId &&
    row.aggregate_version === event.aggregateVersion &&
    row.tenant_id === event.tenantId &&
    row.workspace_id === event.workspaceId &&
    row.organization_id === event.organizationId &&
    row.correlation_id === event.correlationId &&
    row.causation_id === event.causationId
  );
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function assertMaxAttempts(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 100)
    throw new Error('OUTBOX_MAX_ATTEMPTS_INVALID');
}

function requireText(value: string, errorCode: string): void {
  if (!value.trim()) throw new Error(errorCode);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === '23505'
  );
}
