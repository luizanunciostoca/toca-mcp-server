import { randomUUID } from 'node:crypto';
import { createPostgresPool } from '../src/persistence/postgres.js';

interface ValidationOutboxRow {
  readonly event_id: string;
  readonly event_type: string;
  readonly status: string;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly version: number;
  readonly tenant_id: string | null;
  readonly correlation_id: string | null;
}

const sourceSha = requiredEnv('SOURCE_SHA');
const validationRunId = requiredEnv('VALIDATION_RUN_ID');
const databaseUrl = requiredEnv('DATABASE_URL');
const sourceEvidence = `production:r29:${sourceSha}`;
const runEvidence = `validation-run:${validationRunId}`;
const allowedTypes = new Set([
  'content_item.created',
  'content_item.version_created',
  'content.video_artifact.created',
]);
const workerId = 'r29-production-verifier-validation-sink';
const pool = createPostgresPool({ connectionString: databaseUrl, max: 2 });
const client = await pool.connect();
const drainedAt = new Date().toISOString();
let drained = 0;

try {
  await client.query('begin');
  const result = await client.query<ValidationOutboxRow>(
    `select event_id,event_type,status,attempts,max_attempts,version,tenant_id,correlation_id
       from event_outbox
      where evidence @> $1::jsonb
        and evidence @> $2::jsonb
      order by occurred_at,event_id
      for update`,
    [JSON.stringify([sourceEvidence]), JSON.stringify([runEvidence])],
  );

  if (result.rows.length !== 3) {
    throw new Error(`R29_DRAIN_EVENT_COUNT_INVALID:${result.rows.length}`);
  }

  for (const row of result.rows) {
    assertValidationEvent(row);
    const executionId = `r29-validation-sink-${randomUUID()}`;
    const attemptNumber = row.attempts + 1;

    const claimed = await client.query(
      `update event_outbox set
         status='CLAIMED',attempts=$2,claimed_by=$3,claim_execution_id=$4,
         claimed_at=$5::timestamptz,delivered_at=null,last_error_code=null,version=version+1
       where event_id=$1 and version=$6 and status='PENDING'
       returning event_id`,
      [row.event_id, attemptNumber, workerId, executionId, drainedAt, row.version],
    );
    if (claimed.rows.length !== 1) throw new Error(`R29_DRAIN_CLAIM_CONFLICT:${row.event_id}`);

    await client.query(
      `insert into event_outbox_delivery_attempts (
         execution_id,event_id,worker_id,attempt_number,status,claimed_at,completed_at,error_code,evidence
       ) values ($1,$2,$3,$4,'CLAIMED',$5::timestamptz,null,null,'[]'::jsonb)`,
      [executionId, row.event_id, workerId, attemptNumber, drainedAt],
    );

    const deliveryEvidence = [
      `r29:validation-sink:${validationRunId}`,
      `r29:source-sha:${sourceSha}`,
      'r29:external-publication:false',
    ];
    const attempt = await client.query(
      `update event_outbox_delivery_attempts set
         status='DELIVERED',completed_at=$2::timestamptz,error_code=null,evidence=$3::jsonb
       where execution_id=$1 and status='CLAIMED'
       returning execution_id`,
      [executionId, drainedAt, JSON.stringify(deliveryEvidence)],
    );
    if (attempt.rows.length !== 1) throw new Error(`R29_DRAIN_ATTEMPT_CONFLICT:${row.event_id}`);

    const delivered = await client.query(
      `update event_outbox set
         status='DELIVERED',delivered_at=$2::timestamptz,claimed_by=null,
         claim_execution_id=null,claimed_at=null,last_error_code=null,version=version+1
       where event_id=$1 and claim_execution_id=$3 and status='CLAIMED'
       returning event_id`,
      [row.event_id, drainedAt, executionId],
    );
    if (delivered.rows.length !== 1) {
      throw new Error(`R29_DRAIN_DELIVER_CONFLICT:${row.event_id}`);
    }
    drained += 1;
  }

  await client.query('commit');
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  client.release();
}

try {
  const readback = await pool.query<{ readonly status: string; readonly count: number }>(
    `select status,count(*)::int as count
       from event_outbox
      where evidence @> $1::jsonb and evidence @> $2::jsonb
      group by status order by status`,
    [JSON.stringify([sourceEvidence]), JSON.stringify([runEvidence])],
  );
  const delivered = Number(readback.rows.find((row) => row.status === 'DELIVERED')?.count ?? 0);
  const pending = readback.rows
    .filter((row) => ['PENDING', 'CLAIMED', 'FAILED_RETRYABLE'].includes(row.status))
    .reduce((sum, row) => sum + Number(row.count), 0);

  if (drained !== 3 || delivered !== 3 || pending !== 0) {
    throw new Error(`R29_DRAIN_READBACK_INVALID:${drained}:${delivered}:${pending}`);
  }

  console.log(
    `R29_VALIDATION_OUTBOX_DRAIN=${JSON.stringify({
      schemaVersion: 1,
      sourceSha,
      validationRunId,
      matched: 3,
      drained,
      delivered,
      pending,
      transport: workerId,
      externalPublicationExecuted: false,
      drainedAt,
    })}`,
  );
} finally {
  await pool.end();
}

function assertValidationEvent(row: ValidationOutboxRow): void {
  if (!allowedTypes.has(row.event_type)) {
    throw new Error(`R29_DRAIN_EVENT_TYPE_UNEXPECTED:${row.event_type}`);
  }
  if (row.status !== 'PENDING' || row.attempts !== 0 || row.max_attempts < 1) {
    throw new Error(`R29_DRAIN_EVENT_STATE_INVALID:${row.event_id}:${row.status}:${row.attempts}`);
  }
  if (!row.tenant_id?.startsWith('r29-production-')) {
    throw new Error(`R29_DRAIN_TENANT_UNEXPECTED:${row.event_id}`);
  }
  if (!row.correlation_id?.startsWith('r29-production-runtime-')) {
    throw new Error(`R29_DRAIN_CORRELATION_UNEXPECTED:${row.event_id}`);
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}
