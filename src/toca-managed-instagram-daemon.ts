import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { RuntimeTelemetry } from './core/observability.js';
import { JsonConsoleLogger } from './core/structured-logger.js';
import { runFoundationDailyControl } from './operations/foundation-daily-control.js';
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

if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) {
  throw new Error('TOCA_MANAGED_INSTAGRAM_DAEMON_INVALID_PORT');
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
const logger = new JsonConsoleLogger();
const telemetry = new RuntimeTelemetry(logger);
let running = false;
let stopping = false;
let lastRunStartedAt: string | null = null;
let lastRunFinishedAt: string | null = null;
let lastClaimed = 0;
let lastError: string | null = null;
let lastDailyControlDay: string | null = null;

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

  const started = Date.now();
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

    telemetry.increment('daemon.scheduler_self_test.succeeded');
    logger.info('toca.managed.instagram.daemon.scheduler_self_test.passed', { smokeId });
  } catch (error) {
    telemetry.increment('daemon.scheduler_self_test.failed');
    throw error;
  } finally {
    telemetry.record('daemon.scheduler_self_test.duration_ms', Date.now() - started);
    if (jobIds.length > 0) {
      await pool.query('delete from scheduled_jobs where id = any($1::text[])', [jobIds]);
    }
  }
}

type TickResult = {
  claimed: number;
  error: string | null;
  skipped: boolean;
};

async function runDailyControlWithoutBlockingWorker(): Promise<void> {
  try {
    const result = await runFoundationDailyControl({ pool, telemetry, logger });
    if (result.ran || result.reason === 'ALREADY_COMPLETED') {
      lastDailyControlDay = result.dayKey;
    }
  } catch {
    // The daily sweep already emits a structured failure and telemetry. A control-plane
    // read failure must not rewrite the already-completed worker result into an ambiguous
    // provider mutation outcome. Alerts/operators decide any subsequent write shutdown.
  }
}

async function tick(): Promise<TickResult> {
  if (running || stopping) {
    telemetry.increment('daemon.tick.skipped');
    return { claimed: 0, error: null, skipped: true };
  }

  running = true;
  lastRunStartedAt = new Date().toISOString();
  const started = Date.now();
  telemetry.increment('daemon.tick.started');
  try {
    lastClaimed = await runTocaManagedInstagramWorkerBatch({ config, pool, telemetry, logger });
    await runDailyControlWithoutBlockingWorker();
    lastError = null;
    telemetry.increment('daemon.tick.succeeded');
    telemetry.record('daemon.tick.claimed_jobs', lastClaimed);
    logger.info('toca.managed.instagram.daemon.tick.completed', { claimed: lastClaimed });
    return { claimed: lastClaimed, error: null, skipped: false };
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    telemetry.increment('daemon.tick.failed');
    logger.error('toca.managed.instagram.daemon.tick.failed', { error: lastError });
    return { claimed: 0, error: lastError, skipped: false };
  } finally {
    telemetry.record('daemon.tick.duration_ms', Date.now() - started);
    lastRunFinishedAt = new Date().toISOString();
    running = false;
  }
}

await verifySchedulerPersistence();

const server = createServer((request, response) => {
  if (request.url === '/metrics' && request.method === 'GET') {
    response.statusCode = 200;
    response.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    response.end(telemetry.renderPrometheus());
    return;
  }

  if (request.url === '/healthz' && request.method === 'GET') {
    response.statusCode = 200;
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        ok: !stopping,
        schedulerPersistenceVerified: true,
        schedulingTransport: 'protected-mcp',
        triggerMode: 'cloud-scheduler-http',
        running,
        lastRunStartedAt,
        lastRunFinishedAt,
        lastClaimed,
        lastError,
        lastDailyControlDay,
        telemetry: telemetry.snapshot(),
      }),
    );
    return;
  }

  if (request.url === '/tick') {
    if (request.method !== 'POST') {
      response.statusCode = 405;
      response.setHeader('allow', 'POST');
      response.end('method not allowed');
      return;
    }

    void tick()
      .then((result) => {
        response.statusCode = result.error ? 500 : 200;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ ok: !result.error, ...result }));
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('toca.managed.instagram.daemon.tick.request_failed', { error: message });
        response.statusCode = 500;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ ok: false, error: message }));
      });
    return;
  }

  response.statusCode = 404;
  response.end('not found');
});

server.listen(port, '0.0.0.0', () => {
  telemetry.increment('daemon.started');
  logger.info('toca.managed.instagram.daemon.started', {
    port,
    triggerMode: 'cloud-scheduler-http',
  });
});

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  telemetry.increment('daemon.stopping', { signal });
  logger.info('toca.managed.instagram.daemon.stopping', { signal });
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
