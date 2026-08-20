import { isDeepStrictEqual } from 'node:util';
import type pg from 'pg';
import { createDomainEvent } from '../events/domain-events.js';
import { PostgresTransactionalOutbox } from '../events/postgres-transactional-outbox.js';
import type { TransactionalOutboxWriter } from '../events/transactional-outbox.js';
import type {
  AppendLearningRecordInput,
  LearningRecord,
  LearningRecordStore,
  LearningRecordType,
} from '../learning/store.js';
import { appendInternalAuditLedgerEvent } from './postgres-internal-audit-ledger.js';

interface LearningRecordRow {
  readonly record_id: string;
  readonly record_type: LearningRecordType;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly experiment_id: string | null;
  readonly idempotency_key: string;
  readonly payload: unknown;
  readonly created_at: Date | string;
}

export interface PostgresR31LearningStoreOptions {
  readonly outbox?: TransactionalOutboxWriter;
}

export class PostgresR31LearningStore implements LearningRecordStore {
  readonly #outbox: TransactionalOutboxWriter;

  constructor(
    private readonly pool: pg.Pool,
    options: PostgresR31LearningStoreOptions = {},
  ) {
    this.#outbox = options.outbox ?? new PostgresTransactionalOutbox(pool);
  }

  async append(input: AppendLearningRecordInput): Promise<LearningRecord> {
    validateInput(input);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const inserted = await client.query<LearningRecordRow>(
        `insert into r31_learning_records (
           record_id, record_type, tenant_id, workspace_id, organization_id,
           experiment_id, idempotency_key, payload, created_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::timestamptz)
         on conflict (workspace_id, record_type, idempotency_key) do nothing
         returning *`,
        [
          input.recordId,
          input.recordType,
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          input.experimentId,
          input.idempotencyKey,
          JSON.stringify(input.payload),
          input.createdAt,
        ],
      );

      const insertedRow = inserted.rows[0];
      if (!insertedRow) {
        const existingResult = await client.query<LearningRecordRow>(
          `select * from r31_learning_records
           where workspace_id = $1 and record_type = $2 and idempotency_key = $3`,
          [input.workspaceId, input.recordType, input.idempotencyKey],
        );
        const existingRow = existingResult.rows[0];
        if (!existingRow) throw new Error('R31_IDEMPOTENCY_LOOKUP_FAILED');
        const existing = fromRow(existingRow);
        if (!sameIntent(existing, input)) throw new Error('R31_IDEMPOTENCY_CONFLICT');
        await client.query('commit');
        return existing;
      }

      const record = fromRow(insertedRow);
      const event = createDomainEvent({
        eventKey: `r31:${record.recordType.toLowerCase()}:${record.idempotencyKey}`,
        eventType: `r31.${record.recordType.toLowerCase()}.recorded`,
        aggregateType: `R31_${record.recordType}`,
        aggregateId: record.recordId,
        aggregateVersion: 1,
        tenantId: record.tenantId,
        workspaceId: record.workspaceId,
        organizationId: record.organizationId,
        correlationId: input.correlationId,
        causationId: input.executionId,
        occurredAt: record.createdAt,
        payload: record.payload,
        evidence: input.evidence,
      });
      await this.#outbox.enqueue(client, event);
      await appendInternalAuditLedgerEvent(client, {
        namespace: 'learning',
        operation: `record_${record.recordType.toLowerCase()}`,
        recordType: record.recordType,
        recordId: record.recordId,
        tenantId: record.tenantId,
        workspaceId: record.workspaceId,
        organizationId: record.organizationId,
        executionId: input.executionId,
        correlationId: input.correlationId,
        actorPrincipalId: input.actorPrincipalId,
        evidence: input.evidence,
        createdAt: record.createdAt,
      });
      await client.query('commit');
      return record;
    } catch (error) {
      await client.query('rollback');
      if (isUniqueViolation(error)) throw new Error('R31_RECORD_ID_CONFLICT');
      throw error;
    } finally {
      client.release();
    }
  }

  async get(recordId: string): Promise<LearningRecord | undefined> {
    requireText(recordId, 'R31_RECORD_ID_REQUIRED');
    const result = await this.pool.query<LearningRecordRow>(
      'select * from r31_learning_records where record_id = $1',
      [recordId],
    );
    const row = result.rows[0];
    return row ? fromRow(row) : undefined;
  }

  async listByExperiment(input: {
    readonly workspaceId: string;
    readonly experimentId: string;
  }): Promise<readonly LearningRecord[]> {
    requireText(input.workspaceId, 'R31_WORKSPACE_ID_REQUIRED');
    requireText(input.experimentId, 'R31_EXPERIMENT_ID_REQUIRED');
    const result = await this.pool.query<LearningRecordRow>(
      `select * from r31_learning_records
       where workspace_id = $1 and experiment_id = $2
       order by created_at asc, record_id asc`,
      [input.workspaceId, input.experimentId],
    );
    return result.rows.map(fromRow);
  }
}

function validateInput(input: AppendLearningRecordInput): void {
  requireText(input.recordId, 'R31_RECORD_ID_REQUIRED');
  requireText(input.tenantId, 'R31_TENANT_ID_REQUIRED');
  requireText(input.workspaceId, 'R31_WORKSPACE_ID_REQUIRED');
  requireText(input.organizationId, 'R31_ORGANIZATION_ID_REQUIRED');
  requireText(input.idempotencyKey, 'R31_IDEMPOTENCY_KEY_REQUIRED');
  requireText(input.executionId, 'R31_EXECUTION_ID_REQUIRED');
  requireText(input.correlationId, 'R31_CORRELATION_ID_REQUIRED');
  requireText(input.actorPrincipalId, 'R31_ACTOR_PRINCIPAL_ID_REQUIRED');
  if (input.evidence.every((item) => !item.trim())) throw new Error('R31_EVIDENCE_REQUIRED');
  if (!Number.isFinite(Date.parse(input.createdAt))) throw new Error('R31_CREATED_AT_INVALID');
  try {
    if (JSON.stringify(input.payload) === undefined) throw new Error('invalid');
  } catch {
    throw new Error('R31_PAYLOAD_NOT_JSON_SERIALIZABLE');
  }
}

function sameIntent(existing: LearningRecord, input: AppendLearningRecordInput): boolean {
  return (
    existing.recordId === input.recordId &&
    existing.tenantId === input.tenantId &&
    existing.workspaceId === input.workspaceId &&
    existing.organizationId === input.organizationId &&
    existing.experimentId === input.experimentId &&
    isDeepStrictEqual(existing.payload, input.payload)
  );
}

function fromRow(row: LearningRecordRow): LearningRecord {
  return {
    recordId: row.record_id,
    recordType: row.record_type,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    experimentId: row.experiment_id,
    idempotencyKey: row.idempotency_key,
    payload: row.payload,
    createdAt: toIso(row.created_at),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function requireText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
