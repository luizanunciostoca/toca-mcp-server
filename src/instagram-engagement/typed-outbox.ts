import { randomUUID } from 'node:crypto';
import type pg from 'pg';

export interface ClaimedInstagramEngagementEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly payload: unknown;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly correlationId: string;
  readonly executionId: string;
  readonly attemptNumber: number;
  readonly maxAttempts: number;
}

interface OutboxRow {
  readonly event_id: string;
  readonly event_type: string;
  readonly payload: unknown;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly correlation_id: string;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly version: number;
}

export async function claimInstagramEngagementEvents(input: {
  readonly pool: pg.Pool;
  readonly workerId: string;
  readonly eventTypes: readonly string[];
  readonly now: string;
  readonly limit: number;
}): Promise<readonly ClaimedInstagramEngagementEvent[]> {
  if (!input.workerId.trim()) throw new Error('INSTAGRAM_ENGAGEMENT_WORKER_ID_REQUIRED');
  if (input.eventTypes.length === 0) throw new Error('INSTAGRAM_ENGAGEMENT_EVENT_TYPES_REQUIRED');
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new Error('INSTAGRAM_ENGAGEMENT_CLAIM_LIMIT_INVALID');
  }
  if (!Number.isFinite(Date.parse(input.now))) throw new Error('INSTAGRAM_ENGAGEMENT_NOW_INVALID');

  const client = await input.pool.connect();
  try {
    await client.query('begin');
    const candidates = await client.query<OutboxRow>(
      `select event_id, event_type, payload, tenant_id, workspace_id, organization_id,
              correlation_id, attempts, max_attempts, version
       from event_outbox
       where status in ('PENDING','FAILED_RETRYABLE')
         and available_at <= $1::timestamptz
         and attempts < max_attempts
         and event_type = any($2::text[])
       order by available_at asc, occurred_at asc, event_id asc
       for update skip locked
       limit $3`,
      [input.now, [...new Set(input.eventTypes)], input.limit],
    );

    const claimed: ClaimedInstagramEngagementEvent[] = [];
    for (const row of candidates.rows) {
      const executionId = randomUUID();
      const attemptNumber = row.attempts + 1;
      const updated = await client.query(
        `update event_outbox set
           status = 'CLAIMED', attempts = $2, claimed_by = $3,
           claim_execution_id = $4, claimed_at = $5::timestamptz,
           delivered_at = null, last_error_code = null, version = version + 1
         where event_id = $1 and version = $6`,
        [row.event_id, attemptNumber, input.workerId, executionId, input.now, row.version],
      );
      if (updated.rowCount !== 1) throw new Error('INSTAGRAM_ENGAGEMENT_OUTBOX_CLAIM_CONFLICT');
      await client.query(
        `insert into event_outbox_delivery_attempts (
           execution_id, event_id, worker_id, attempt_number, status,
           claimed_at, completed_at, error_code, evidence
         ) values ($1,$2,$3,$4,'CLAIMED',$5::timestamptz,null,null,'[]'::jsonb)`,
        [executionId, row.event_id, input.workerId, attemptNumber, input.now],
      );
      claimed.push({
        eventId: row.event_id,
        eventType: row.event_type,
        payload: row.payload,
        tenantId: row.tenant_id,
        workspaceId: row.workspace_id,
        organizationId: row.organization_id,
        correlationId: row.correlation_id,
        executionId,
        attemptNumber,
        maxAttempts: row.max_attempts,
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
