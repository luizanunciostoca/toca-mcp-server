import { randomUUID } from 'node:crypto';
import { createPostgresPool } from './persistence/postgres.js';
import { PostgresScheduler } from './scheduler/postgres-scheduler.js';
import {
  TocaManagedInstagramScheduler,
  hashTocaManagedInstagramApprovalDescriptor,
  type TocaManagedInstagramApprovalDescriptor,
  type TocaManagedInstagramSchedulePayload,
} from './scheduler/toca-managed-instagram-scheduler.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED');

const pool = createPostgresPool({ connectionString: databaseUrl });
const scheduler = new TocaManagedInstagramScheduler(new PostgresScheduler(pool));
const smokeId = randomUUID();

function descriptor(scheduledFor: string, suffix: string): TocaManagedInstagramApprovalDescriptor {
  return {
    schemaVersion: 1,
    contentItemId: `SMOKE-TOCA-SCHEDULER-${smokeId}-${suffix}`,
    scheduledFor,
    timezone: 'America/Bahia',
    account: {
      pageId: 'SMOKE_PAGE_NO_PROVIDER_CALL',
      instagramAccountId: 'SMOKE_INSTAGRAM_NO_PROVIDER_CALL',
    },
    mediaType: 'IMAGE',
    asset: {
      assetId: `SMOKE-ASSET-${smokeId}`,
      objectName: `smoke/${smokeId}.jpg`,
      sha256: '0'.repeat(64),
      contentType: 'image/jpeg',
    },
    caption: 'TOCA managed scheduler persistence smoke — no provider call',
    correlationId: `CORR-SMOKE-${smokeId}`,
    publicationIdempotencyKey: `PUB-SMOKE-${smokeId}-${suffix}`,
  };
}

function approved(value: TocaManagedInstagramApprovalDescriptor): TocaManagedInstagramSchedulePayload {
  return {
    ...value,
    approval: {
      mode: 'EXPLICIT_APPROVAL',
      status: 'APPROVED',
      approvedDescriptorSha256: hashTocaManagedInstagramApprovalDescriptor(value),
    },
  };
}

try {
  const firstDescriptor = descriptor('2099-01-01T12:00:00-03:00', 'V1');
  const first = await scheduler.schedule(approved(firstDescriptor));
  if (first.status !== 'SCHEDULED') throw new Error('SMOKE_CREATE_NOT_SCHEDULED');

  const read = await scheduler.status(first.id);
  if (!read || read.id !== first.id || read.status !== 'SCHEDULED') {
    throw new Error('SMOKE_STATUS_MISMATCH');
  }

  const replacementDescriptor = descriptor('2099-01-01T13:00:00-03:00', 'V2');
  const replacement = await scheduler.reschedule(first.id, approved(replacementDescriptor));
  if (replacement.status !== 'SCHEDULED') throw new Error('SMOKE_RESCHEDULE_NOT_SCHEDULED');

  const old = await scheduler.status(first.id);
  if (!old || old.status !== 'CANCELED') throw new Error('SMOKE_OLD_JOB_NOT_CANCELED');

  const canceled = await scheduler.cancel(replacement.id);
  if (!canceled || canceled.status !== 'CANCELED') throw new Error('SMOKE_CANCEL_FAILED');

  console.info('TOCA_MANAGED_SCHEDULER_PERSISTENCE_SMOKE_OK', {
    smokeId,
    firstJobId: first.id,
    replacementJobId: replacement.id,
  });
} finally {
  await pool.end();
}
