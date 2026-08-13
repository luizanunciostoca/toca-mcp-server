import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { createPostgresPool } from './persistence/postgres.js';
import { PostgresScheduler } from './scheduler/postgres-scheduler.js';
import {
  TocaManagedInstagramScheduler,
  hashTocaManagedInstagramApprovalDescriptor,
  type TocaManagedInstagramApprovalDescriptor,
  type TocaManagedInstagramSchedulePayload,
} from './scheduler/toca-managed-instagram-scheduler.js';
import { runTocaManagedInstagramWorkerBatch } from './worker/toca-managed-instagram-worker-runtime.js';

const config = loadConfig(process.env);
const port = Number.parseInt(process.env.PORT ?? '8080', 10);
const pollIntervalMs = Number.parseInt(
  process.env.TOCA_MANAGED_INSTAGRAM_DAEMON_POLL_INTERVAL_MS ?? '60000',
  10,
);

if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) {
  throw new Error('TOCA_MANAGED_INSTAGRAM_DAEMON_INVALID_PORT');
}
if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 10000) {
  throw new Error('TOCA_MANAGED_INSTAGRAM_DAEMON_INVALID_POLL_INTERVAL');
}
if (!config.TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED) {
  throw new Error('TOCA_MANAGED_INSTAGRAM_DAEMON_REQUIRES_SCHEDULER');
}
if (!config.TOCA_MANAGED_INSTAGRAM_EXECUTOR_ENABLED) {
  throw new Error('TOCA_MANAGED_INSTAGRAM_DAEMON_REQUIRES_EXECUTOR');
}
if (!config.DATABASE_URL) {
  throw new Error('DATABASE_URL_REQUIRED');
}

const pool = createPostgresPool({ connectionString: config.DATABASE_URL });
let running = false;
let stopping = false;
let lastRunStartedAt: string | null = null;
let lastRunFinishedAt: string | null = null;
let lastClaimed = 0;
let lastError: string | null = null;

async function verifySchedulerPersistence(): Promise<void> {
  const scheduler = new TocaManagedInstagramScheduler(new PostgresScheduler(pool));
  const smokeId = randomUUID();
  const jobIds: string[] = [];

  const descriptor = (
    scheduledFor: string,
    suffix: string,
  ): TocaManagedInstagramApprovalDescriptor => ({
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
    caption: 'TOCA scheduler persistence self-test; provider call prohibited',
    correlationId: `CORR-SMOKE-${smokeId}`,
    publicationIdempotencyKey: `PUB-SMOKE-${smokeId}-${suffix}`,
  });

  const approved = (
    value: TocaManagedInstagramApprovalDescriptor,
  ): TocaManagedInstagramSchedulePayload => ({
    ...value,
    approval: {
      mode: 'EXPLICIT_APPROVAL',
      status: 'APPROVED',
      approvedDescriptorSha256: hashTocaManagedInstagramApprovalDescriptor(value),
    },
  });

  try {
    const first = await scheduler.schedule(approved(descriptor('2099-01-01T12:00:00-03:00', 'V1')));
    jobIds.push(first.id);
    if (first.status !== 'SCHEDULED') throw new Error('SCHEDULER_SELF_TEST_CREATE_FAILED');

    const read = await scheduler.status(first.id);
    if (!read || read.status !== 'SCHEDULED') throw new Error('SCHEDULER_SELF_TEST_READ_FAILED');

    const replacement = await scheduler.reschedule(
      first.id,
      approved(descriptor('2099-01-01T13:00:00-03:00', 'V2')),
    );
    jobIds.push(replacement.id);
    if (replacement.status !== 'SCHEDULED') {
      throw new Error('SCHEDULER_SELF_TEST_RESCHEDULE_FAILED');
    }

    const old = await scheduler.status(first.id);
    if (!old || old.status !== 'CANCELED') throw new Error('SCHEDULER_SELF_TEST_OLD_JOB_ACTIVE');

    const canceled = await scheduler.cancel(replacement.id);
    if (!canceled || canceled.status !== 'CANCELED') {
      throw new Error('SCHEDULER_SELF_TEST_CANCEL_FAILED');
    }

    console.info('toca.managed.instagram.daemon.scheduler_self_test.passed', { smokeId });
  } finally {
    if (jobIds.length > 0) {
      await pool.query('delete from scheduled_jobs where id = any($1::text[])', [jobIds]);
    }
  }
}

async function tick(): Promise<void> {
  if (running || stopping) return;
  running = true;
  lastRunStartedAt = new Date().toISOString();
  try {
    lastClaimed = await runTocaManagedInstagramWorkerBatch({ config, pool });
    lastError = null;
    console.info('toca.managed.instagram.daemon.tick.completed', { claimed: lastClaimed });
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.error('toca.managed.instagram.daemon.tick.failed', { error: lastError });
  } finally {
    lastRunFinishedAt = new Date().toISOString();
    running = false;
  }
}

await verifySchedulerPersistence();

const server = createServer((request, response) => {
  if (request.url !== '/healthz') {
    response.statusCode = 404;
    response.end('not found');
    return;
  }

  response.setHeader('content-type', 'application/json');
  response.end(
    JSON.stringify({
      ok: !stopping,
      schedulerPersistenceVerified: true,
      running,
      pollIntervalMs,
      lastRunStartedAt,
      lastRunFinishedAt,
      lastClaimed,
      lastError,
    }),
  );
});

server.listen(port, '0.0.0.0', () => {
  console.info('toca.managed.instagram.daemon.started', { port, pollIntervalMs });
});

const timer = setInterval(() => {
  void tick();
}, pollIntervalMs);
timer.unref();
void tick();

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  console.info('toca.managed.instagram.daemon.stopping', { signal });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  while (running) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await pool.end();
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}
