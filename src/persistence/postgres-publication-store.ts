import type pg from 'pg';
import type { InstagramPublishRequest } from '../providers/instagram/instagram-contracts.js';
import type { PublicationExecutionStore } from '../providers/instagram/instagram-publication-executor.js';
import type {
  PublicationRecord,
  PublicationState,
} from '../providers/instagram/publication-state.js';

type PublicationEvidencePayload = {
  readonly permalink?: string;
  readonly providerPublishedAt?: string;
  readonly reconciliationSource?: 'WRITE_RESPONSE' | 'PROVIDER_LOOKUP';
};

type PublicationRow = {
  correlation_id: string;
  account_id: string;
  external_resource_id: string | null;
  state: PublicationState;
  idempotency_key: string;
  payload: unknown;
  last_error: string | null;
  updated_at: Date;
};

export class PostgresPublicationExecutionStore implements PublicationExecutionStore {
  constructor(private readonly pool: pg.Pool) {}

  async reserve(request: InstagramPublishRequest, nowIso: string): Promise<PublicationRecord> {
    await this.pool.query(
      `insert into provider_publications
         (correlation_id, provider, account_id, state, idempotency_key, payload, updated_at)
       values ($1, 'meta/instagram', $2, 'DRAFT', $3, $4::jsonb, $5::timestamptz)
       on conflict (idempotency_key) do nothing`,
      [
        request.correlationId,
        request.account.instagramAccountId,
        request.idempotencyKey,
        JSON.stringify(request),
        nowIso,
      ],
    );

    const result = await this.pool.query<PublicationRow>(
      `select correlation_id, account_id, external_resource_id, state, idempotency_key,
              payload, last_error, updated_at
       from provider_publications where idempotency_key = $1`,
      [request.idempotencyKey],
    );
    const row = result.rows[0];
    if (!row) throw new Error('INSTAGRAM_PUBLICATION_RESERVATION_MISSING');
    if (
      row.correlation_id !== request.correlationId ||
      row.account_id !== request.account.instagramAccountId
    ) {
      throw new Error('INSTAGRAM_PUBLICATION_IDEMPOTENCY_CONFLICT');
    }
    return mapRow(row);
  }

  async save(record: PublicationRecord): Promise<void> {
    const evidence: PublicationEvidencePayload = {
      ...(record.permalink ? { permalink: record.permalink } : {}),
      ...(record.providerPublishedAt ? { providerPublishedAt: record.providerPublishedAt } : {}),
      ...(record.reconciliationSource
        ? { reconciliationSource: record.reconciliationSource }
        : {}),
    };
    const result = await this.pool.query(
      `update provider_publications
       set state = $2,
           external_resource_id = coalesce($3, external_resource_id),
           last_error = $4,
           updated_at = $5::timestamptz,
           payload = payload || $7::jsonb
       where correlation_id = $1 and idempotency_key = $6`,
      [
        record.correlationId,
        record.state,
        record.externalMediaId ?? record.externalContainerId ?? null,
        record.lastError ?? null,
        record.updatedAt,
        record.idempotencyKey,
        JSON.stringify({ _providerEvidence: evidence }),
      ],
    );
    if (result.rowCount !== 1) throw new Error('INSTAGRAM_PUBLICATION_UPDATE_CONFLICT');
  }
}

function mapRow(row: PublicationRow): PublicationRecord {
  const payload = row.payload as Partial<InstagramPublishRequest> & {
    externalContainerId?: string;
    externalMediaId?: string;
    _providerEvidence?: PublicationEvidencePayload;
  };
  const evidence = payload._providerEvidence;
  return {
    publicationId: row.correlation_id,
    correlationId: row.correlation_id,
    idempotencyKey: row.idempotency_key,
    state: row.state,
    ...(payload.externalContainerId ? { externalContainerId: payload.externalContainerId } : {}),
    ...(row.external_resource_id && row.state === 'PUBLISHED'
      ? { externalMediaId: row.external_resource_id }
      : row.external_resource_id
        ? { externalContainerId: row.external_resource_id }
        : {}),
    ...(evidence?.permalink ? { permalink: evidence.permalink } : {}),
    ...(evidence?.providerPublishedAt
      ? { providerPublishedAt: evidence.providerPublishedAt }
      : {}),
    ...(evidence?.reconciliationSource
      ? { reconciliationSource: evidence.reconciliationSource }
      : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    updatedAt: row.updated_at.toISOString(),
  };
}
