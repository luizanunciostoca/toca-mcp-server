import { Buffer } from 'node:buffer';
import { loadConfig } from './config.js';
import { createPostgresPool } from './persistence/postgres.js';
import { PostgresScheduler } from './scheduler/postgres-scheduler.js';
import {
  TocaManagedInstagramScheduler,
  parseTocaManagedInstagramSchedulePayload,
} from './scheduler/toca-managed-instagram-scheduler.js';

interface ScheduleCommandEnvelope {
  readonly schemaVersion: 1;
  readonly action: 'CREATE';
  readonly commandId: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly payload: unknown;
}

const encoded = process.env.TOCA_SCHEDULE_COMMAND_B64;
if (!encoded) throw new Error('TOCA_SCHEDULE_COMMAND_B64_REQUIRED');

const raw = Buffer.from(encoded, 'base64').toString('utf8');
const parsed = JSON.parse(raw) as Partial<ScheduleCommandEnvelope>;
if (parsed.schemaVersion !== 1) throw new Error('TOCA_SCHEDULE_COMMAND_SCHEMA_UNSUPPORTED');
if (parsed.action !== 'CREATE') throw new Error('TOCA_SCHEDULE_COMMAND_ACTION_UNSUPPORTED');
if (!parsed.commandId?.trim()) throw new Error('TOCA_SCHEDULE_COMMAND_ID_REQUIRED');
if (!parsed.requestedBy?.trim()) throw new Error('TOCA_SCHEDULE_COMMAND_REQUESTED_BY_REQUIRED');
if (!parsed.requestedAt?.trim()) throw new Error('TOCA_SCHEDULE_COMMAND_REQUESTED_AT_REQUIRED');

const payload = parseTocaManagedInstagramSchedulePayload(parsed.payload);
const config = loadConfig(process.env);
if (!config.TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED) {
  throw new Error('TOCA_MANAGED_INSTAGRAM_SCHEDULER_REQUIRED');
}
if (!config.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
const tenantId = process.env.TOCA_DEFAULT_TENANT_ID?.trim();
if (!tenantId) throw new Error('TOCA_DEFAULT_TENANT_ID_REQUIRED');

const pool = createPostgresPool({ connectionString: config.DATABASE_URL });
try {
  const scheduler = new TocaManagedInstagramScheduler(new PostgresScheduler(pool, tenantId));
  const job = await scheduler.schedule(payload);
  const confirmed = await scheduler.status(job.id);
  if (!confirmed || confirmed.status !== 'SCHEDULED') {
    throw new Error('TOCA_SCHEDULE_COMMAND_PERSISTENCE_VERIFICATION_FAILED');
  }
  console.log(
    JSON.stringify({
      commandId: parsed.commandId,
      requestedBy: parsed.requestedBy,
      requestedAt: parsed.requestedAt,
      jobId: confirmed.id,
      status: confirmed.status,
      runAt: confirmed.runAt,
      timezone: confirmed.timezone,
      idempotencyKey: confirmed.idempotencyKey,
      contentItemId: payload.contentItemId,
    }),
  );
} finally {
  await pool.end();
}
