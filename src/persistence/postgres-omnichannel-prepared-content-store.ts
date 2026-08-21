import type pg from 'pg';
import {
  assertOmnichannelPreparedContentIntegrity,
  buildOmnichannelPreparedContentRecord,
  type GetOmnichannelPreparedContentInput,
  type OmnichannelPreparedContentRecord,
  type OmnichannelPreparedContentStore,
  type PutOmnichannelPreparedContentInput,
} from '../omnichannel/prepared-content.js';

interface PreparedContentRow {
  readonly prepared_content_ref: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly content_kind: OmnichannelPreparedContentRecord['contentKind'];
  readonly schema_version: number;
  readonly payload: unknown;
  readonly content_sha256: string;
  readonly evidence: unknown;
  readonly created_at: Date | string;
}

export class PostgresOmnichannelPreparedContentStore implements OmnichannelPreparedContentStore {
  constructor(private readonly pool: pg.Pool) {}

  async put(input: PutOmnichannelPreparedContentInput): Promise<OmnichannelPreparedContentRecord> {
    const record = buildOmnichannelPreparedContentRecord(input);
    const result = await this.pool.query<PreparedContentRow>(
      `insert into omnichannel_prepared_content (
         prepared_content_ref, tenant_id, workspace_id, organization_id,
         content_kind, schema_version, payload, content_sha256, evidence, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10::timestamptz)
       on conflict (prepared_content_ref) do nothing
       returning *`,
      [
        record.preparedContentRef,
        record.tenantId,
        record.workspaceId,
        record.organizationId,
        record.contentKind,
        record.schemaVersion,
        JSON.stringify(record.payload),
        record.contentSha256,
        JSON.stringify(record.evidence),
        record.createdAt,
      ],
    );
    const inserted = result.rows[0];
    if (inserted) return fromRow(inserted);

    const existing = await this.pool.query<PreparedContentRow>(
      `select * from omnichannel_prepared_content
       where prepared_content_ref = $1`,
      [record.preparedContentRef],
    );
    const row = existing.rows[0];
    if (!row) throw new Error('OMNICHANNEL_PREPARED_IDEMPOTENCY_LOOKUP_FAILED');
    const persisted = fromRow(row);
    if (
      persisted.tenantId !== record.tenantId ||
      persisted.workspaceId !== record.workspaceId ||
      persisted.organizationId !== record.organizationId ||
      persisted.contentKind !== record.contentKind ||
      persisted.schemaVersion !== record.schemaVersion ||
      persisted.contentSha256 !== record.contentSha256
    ) {
      throw new Error('OMNICHANNEL_PREPARED_REF_CONFLICT');
    }
    return persisted;
  }

  async get(
    input: GetOmnichannelPreparedContentInput,
  ): Promise<OmnichannelPreparedContentRecord | undefined> {
    const result = await this.pool.query<PreparedContentRow>(
      `select * from omnichannel_prepared_content
       where prepared_content_ref = $1
         and tenant_id = $2
         and workspace_id = $3
         and organization_id = $4
         and content_kind = $5`,
      [
        input.preparedContentRef,
        input.tenantId,
        input.workspaceId,
        input.organizationId,
        input.contentKind,
      ],
    );
    const row = result.rows[0];
    return row ? fromRow(row) : undefined;
  }
}

function fromRow(row: PreparedContentRow): OmnichannelPreparedContentRecord {
  const payload = requireObject(row.payload, 'OMNICHANNEL_PREPARED_DB_PAYLOAD_INVALID');
  const evidence = requireStringArray(row.evidence, 'OMNICHANNEL_PREPARED_DB_EVIDENCE_INVALID');
  const record: OmnichannelPreparedContentRecord = {
    preparedContentRef: row.prepared_content_ref,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    contentKind: row.content_kind,
    schemaVersion: row.schema_version,
    payload,
    contentSha256: row.content_sha256,
    evidence,
    createdAt: new Date(row.created_at).toISOString(),
  };
  assertOmnichannelPreparedContentIntegrity(record);
  return record;
}

function requireObject(value: unknown, code: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value as Readonly<Record<string, unknown>>;
}

function requireStringArray(value: unknown, code: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) throw new Error(code);
  return value as string[];
}
