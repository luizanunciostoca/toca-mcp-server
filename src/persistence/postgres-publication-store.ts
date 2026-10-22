import type pg from 'pg';
import {
  assertInstagramOneOffWindow,
  type InstagramPublishRequest,
} from '../providers/instagram/instagram-contracts.js';
import type {
  OneOffPublicationReservation,
  PublicationExecutionStore,
} from '../providers/instagram/instagram-publication-executor.js';
import {
  transitionPublication,
  type PublicationRecord,
  type PublicationState,
} from '../providers/instagram/publication-state.js';
import { hashInstagramPublicationApprovalPayload } from '../worker/instagram-publication-boundary.js';
import { parseInstagramPublishRequest } from '../worker/instagram-publication-job.js';

type PublicationEvidencePayload = {
  readonly permalink?: string;
  readonly providerPublishedAt?: string;
  readonly reconciliationSource?: 'WRITE_RESPONSE' | 'PROVIDER_LOOKUP';
};

type PublicationRow = {
  correlation_id: string;
  provider: string;
  account_id: string;
  external_resource_id: string | null;
  state: PublicationState;
  idempotency_key: string;
  payload: unknown;
  last_error: string | null;
  updated_at: Date;
};

const columns = `correlation_id, provider, account_id, external_resource_id, state,
                 idempotency_key, payload, last_error, updated_at`;

export class PostgresPublicationExecutionStore implements PublicationExecutionStore {
  constructor(private readonly pool: pg.Pool) {}

  async reserve(request: InstagramPublishRequest, nowIso: string): Promise<PublicationRecord> {
    if (request.oneOff) throw new Error('INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMPTION_REQUIRED');
    await this.pool.query(
      `insert into provider_publications
         (correlation_id, provider, account_id, state, idempotency_key, payload, updated_at)
       values ($1, 'meta/instagram', $2, 'DRAFT', $3, $4::jsonb, $5::timestamptz)
       on conflict (idempotency_key) do nothing`,
      requestValues(request, nowIso),
    );

    const row = await this.find(request.idempotencyKey);
    assertSameRequest(row, request);
    return mapRow(row);
  }

  /** The existing unique publication row is the durable consumption record. No lease,
   * retry token or caller-supplied metadata can restore a consumed invocation.
   */
  async consumeOneOff(
    input: InstagramPublishRequest,
    nowIso: string,
  ): Promise<OneOffPublicationReservation> {
    // Take a private, canonical copy so caller mutations across awaits cannot rebind it.
    const request = parseInstagramPublishRequest(input);
    if (!request.oneOff) throw new Error('INSTAGRAM_PUBLICATION_ONE_OFF_DESCRIPTOR_REQUIRED');
    assertInstagramOneOffWindow(request.oneOff, nowIso);

    let inserted: pg.QueryResult<PublicationRow>;
    try {
      // Pool.query is a single autocommit statement. Only its acknowledged, committed
      // RETURNING row grants this invocation the closure below.
      inserted = await this.pool.query<PublicationRow>(
        `insert into provider_publications
           (correlation_id, provider, account_id, state, idempotency_key, payload, updated_at)
         values ($1, 'meta/instagram', $2, 'CREATING_CONTAINER', $3, $4::jsonb, $5::timestamptz)
         on conflict (idempotency_key) do nothing
         returning ${columns}`,
        requestValues(request, nowIso),
      );
    } catch {
      // A lost commit acknowledgement is UNKNOWN, never a license to call the provider.
      throw new Error('INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMPTION_UNKNOWN');
    }
    const winner = inserted.rows[0];
    if (!winner) {
      const existing = await this.find(request.idempotencyKey);
      assertSameRequest(existing, request);
      return { publication: mapRow(existing) };
    }
    assertSameRequest(winner, request);
    if (winner.state !== 'CREATING_CONTAINER') {
      throw new Error('INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMPTION_UNKNOWN');
    }
    let previous = mapRow(winner);
    let externalResourceId = winner.external_resource_id;
    let active = true;
    return {
      publication: previous,
      // This function cannot survive JSON serialization or process restart. It is
      // internal to the winning execute call, not a reusable authorization credential.
      advance: async (next: PublicationRecord): Promise<void> => {
        if (
          !active ||
          next.correlationId !== previous.correlationId ||
          next.publicationId !== previous.publicationId ||
          next.idempotencyKey !== previous.idempotencyKey
        ) {
          throw new Error('INSTAGRAM_PUBLICATION_UPDATE_CONFLICT');
        }
        transitionPublication(previous, next.state, next.updatedAt);
        // Invalidate before awaiting: concurrency, a failed CAS or an uncertain DB
        // result permanently stops this invocation from attempting further mutations.
        active = false;
        const result = await this.pool.query(
          `update provider_publications
           set state = $2,
               external_resource_id = coalesce($3, external_resource_id),
               last_error = $4,
               updated_at = $5::timestamptz,
               payload = payload || $7::jsonb
           where correlation_id = $1 and idempotency_key = $6
             and provider = 'meta/instagram' and account_id = $8
             and payload - '_providerEvidence' = $9::jsonb
             and state = $10 and updated_at = $11::timestamptz
             and external_resource_id is not distinct from $12::text
             and last_error is not distinct from $13::text`,
          [
            ...saveValues(next),
            request.account.instagramAccountId,
            JSON.stringify(request),
            previous.state,
            previous.updatedAt,
            externalResourceId,
            previous.lastError ?? null,
          ],
        );
        if (result.rowCount !== 1) throw new Error('INSTAGRAM_PUBLICATION_UPDATE_CONFLICT');
        previous = { ...next };
        externalResourceId = next.externalMediaId ?? next.externalContainerId ?? externalResourceId;
        active = next.state === 'PROCESSING' || next.state === 'PUBLISHING';
      },
    };
  }

  async save(record: PublicationRecord): Promise<void> {
    const result = await this.pool.query(
      `update provider_publications
       set state = $2,
           external_resource_id = coalesce($3, external_resource_id),
           last_error = $4,
           updated_at = $5::timestamptz,
           payload = payload || $7::jsonb
       where correlation_id = $1 and idempotency_key = $6
         and not (payload ? 'oneOff')`,
      saveValues(record),
    );
    if (result.rowCount !== 1) throw new Error('INSTAGRAM_PUBLICATION_UPDATE_CONFLICT');
  }

  private async find(idempotencyKey: string): Promise<PublicationRow> {
    const result = await this.pool.query<PublicationRow>(
      `select ${columns} from provider_publications where idempotency_key = $1`,
      [idempotencyKey],
    );
    const row = result.rows[0];
    if (!row) throw new Error('INSTAGRAM_PUBLICATION_RESERVATION_MISSING');
    return row;
  }
}

function requestValues(request: InstagramPublishRequest, nowIso: string): unknown[] {
  return [
    request.correlationId,
    request.account.instagramAccountId,
    request.idempotencyKey,
    JSON.stringify(request),
    nowIso,
  ];
}

function saveValues(record: PublicationRecord): unknown[] {
  const evidence: PublicationEvidencePayload = {
    ...(record.permalink ? { permalink: record.permalink } : {}),
    ...(record.providerPublishedAt ? { providerPublishedAt: record.providerPublishedAt } : {}),
    ...(record.reconciliationSource ? { reconciliationSource: record.reconciliationSource } : {}),
  };
  return [
    record.correlationId,
    record.state,
    record.externalMediaId ?? record.externalContainerId ?? null,
    record.lastError ?? null,
    record.updatedAt,
    record.idempotencyKey,
    JSON.stringify({ _providerEvidence: evidence }),
  ];
}

function assertSameRequest(row: PublicationRow, request: InstagramPublishRequest): void {
  const payload = row.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('INSTAGRAM_PUBLICATION_IDEMPOTENCY_CONFLICT');
  }
  const canonical = { ...payload } as Record<string, unknown>;
  // This is the sole established store augmentation. No other field is ignored.
  delete canonical._providerEvidence;
  if (
    row.provider !== 'meta/instagram' ||
    row.correlation_id !== request.correlationId ||
    row.account_id !== request.account.instagramAccountId ||
    row.idempotency_key !== request.idempotencyKey ||
    hashInstagramPublicationApprovalPayload(canonical) !==
      hashInstagramPublicationApprovalPayload(request)
  ) {
    throw new Error('INSTAGRAM_PUBLICATION_IDEMPOTENCY_CONFLICT');
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
    ...(evidence?.providerPublishedAt ? { providerPublishedAt: evidence.providerPublishedAt } : {}),
    ...(evidence?.reconciliationSource
      ? { reconciliationSource: evidence.reconciliationSource }
      : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    updatedAt: row.updated_at.toISOString(),
  };
}
