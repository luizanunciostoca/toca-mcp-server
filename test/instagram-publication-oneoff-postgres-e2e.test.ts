import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PostgresPublicationExecutionStore } from '../src/persistence/postgres-publication-store.js';
import { createPostgresPool } from '../src/persistence/postgres.js';
import {
  deriveInstagramOneOffIdempotencyKey,
  type InstagramPublishRequest,
} from '../src/providers/instagram/instagram-contracts.js';
import { InstagramPublicationExecutor } from '../src/providers/instagram/instagram-publication-executor.js';
import type { PublicationState } from '../src/providers/instagram/publication-state.js';
import {
  disposableDatabaseUrl,
  NOW,
  SYNTHETIC_PREFIX,
  SyntheticInstagramTransport,
  type CrashPoint,
  type WorkerReport,
} from './fixtures/instagram-publication-oneoff-crash-worker.js';

// Only an explicitly opted-in, disposable loopback database is allowed. In CI,
// REQUIRED=true turns missing configuration into failure rather than a green skip.
const DATABASE_URL = disposableDatabaseUrl(
  process.env.INSTAGRAM_ONEOFF_E2E_DATABASE_URL,
  process.env.INSTAGRAM_ONEOFF_E2E_DISPOSABLE_DATABASE,
  process.env.INSTAGRAM_ONEOFF_E2E_REQUIRED === 'true',
);
const postgresDescribe = DATABASE_URL ? describe : describe.skip;
const CONSUMED = 'INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMED_RECONCILIATION_REQUIRED';
const CONFLICT = 'INSTAGRAM_PUBLICATION_IDEMPOTENCY_CONFLICT';
const ownedIds = new Set<string>();
const openPools = new Set<pg.Pool>();
const receiptDirectories = new Set<string>();

function databaseUrl(): string {
  if (!DATABASE_URL) throw new Error('INSTAGRAM_ONEOFF_E2E_DATABASE_URL_REQUIRED');
  return DATABASE_URL;
}

function newPool(): pg.Pool {
  const pool = createPostgresPool({ connectionString: databaseUrl(), max: 1, ssl: false });
  openPools.add(pool);
  return pool;
}

async function closePool(pool: pg.Pool): Promise<void> {
  await pool.end();
  openPools.delete(pool);
}

function request(): InstagramPublishRequest {
  const suffix = randomUUID();
  const correlationId = `${SYNTHETIC_PREFIX}${suffix}`;
  ownedIds.add(correlationId);
  const oneOff = {
    mode: 'ONE_OFF' as const,
    authorizationRef: `${SYNTHETIC_PREFIX}authorization/${suffix}`,
    authorizationId: `synthetic-authorization-${suffix}`,
    commandEnvelopeSha256: 'a'.repeat(64),
    validFrom: '2026-10-21T11:00:00.000Z',
    validUntil: '2026-10-21T13:00:00.000Z',
    maxPublications: 1 as const,
  };
  return {
    account: { pageId: 'synthetic-page', instagramAccountId: 'synthetic-instagram-account' },
    mediaType: 'IMAGE',
    mediaUrls: ['https://example.invalid/synthetic-image.jpg'],
    caption: 'Synthetic one-off durability test. Never sent to a provider.',
    correlationId,
    idempotencyKey: deriveInstagramOneOffIdempotencyKey(oneOff),
    oneOff,
  };
}

function executor(pool: pg.Pool, transport: SyntheticInstagramTransport, maxAttempts = 3) {
  return new InstagramPublicationExecutor(
    new PostgresPublicationExecutionStore(pool),
    transport,
    () => NOW,
    false,
    { maxAttempts, pollIntervalMs: 0, sleep: () => Promise.resolve() },
  );
}

async function storedState(pool: pg.Pool, input: InstagramPublishRequest): Promise<string> {
  const result = await pool.query<{ state: string }>(
    'select state from provider_publications where correlation_id = $1',
    [input.correlationId],
  );
  expect(result.rowCount).toBe(1);
  return result.rows[0]!.state;
}

async function receiptFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), SYNTHETIC_PREFIX));
  receiptDirectories.add(directory);
  return join(directory, 'fake-provider-receipts.jsonl');
}

async function receipts(file: string): Promise<string[]> {
  let value: string;
  try {
    value = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return value
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { event: string }).event);
}

interface WorkerExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runWorker(
  input: InstagramPublishRequest,
  file: string,
  point?: CrashPoint,
): Promise<WorkerExit> {
  const fixture = fileURLToPath(
    new URL('./fixtures/instagram-publication-oneoff-crash-worker.ts', import.meta.url),
  );
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', fixture, point ? 'crash' : 'execute', ...(point ? [point] : [])],
      {
        env: {
          ...process.env,
          INSTAGRAM_ONEOFF_E2E_DATABASE_URL: databaseUrl(),
          INSTAGRAM_ONEOFF_E2E_DISPOSABLE_DATABASE: 'true',
          INSTAGRAM_ONEOFF_E2E_REQUEST: JSON.stringify(input),
          INSTAGRAM_ONEOFF_E2E_RECEIPT_FILE: file,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('INSTAGRAM_ONEOFF_E2E_WORKER_TIMEOUT'));
    }, 20_000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function workerReport(exit: WorkerExit): WorkerReport {
  expect(exit.signal).toBeNull();
  expect(exit.code, exit.stderr).toBe(0);
  return JSON.parse(exit.stdout.trim()) as WorkerReport;
}

describe('Instagram one-off PostgreSQL E2E database guard', () => {
  it('permits an ordinary unit-test skip but rejects missing database in required mode', () => {
    expect(disposableDatabaseUrl(undefined, undefined)).toBeUndefined();
    expect(() => disposableDatabaseUrl(undefined, 'true', true)).toThrow(
      'INSTAGRAM_ONEOFF_E2E_DATABASE_URL_REQUIRED',
    );
  });

  it('requires both the dedicated URL and explicit disposable opt-in', () => {
    expect(() => disposableDatabaseUrl('postgres://test@127.0.0.1/disposable', undefined)).toThrow(
      'INSTAGRAM_ONEOFF_E2E_EXPLICIT_DISPOSABLE_DATABASE_REQUIRED',
    );
    expect(disposableDatabaseUrl('postgres://test@127.0.0.1/disposable', 'true', true)).toBe(
      'postgres://test@127.0.0.1/disposable',
    );
  });

  it.each([
    'postgres://test@database.example.invalid/production',
    'postgres://test@127.0.0.1/disposable?host=database.example.invalid',
    'postgres://test@127.0.0.1/disposable?options=-csearch_path%3Dproduction',
    'postgres://test@127.0.0.1/',
    'https://127.0.0.1/disposable',
  ])('rejects non-loopback and connection-override URLs: %s', (url) => {
    expect(() => disposableDatabaseUrl(url, 'true', true)).toThrow(
      'INSTAGRAM_ONEOFF_E2E_DISPOSABLE_LOOPBACK_DATABASE_REQUIRED',
    );
  });
});

postgresDescribe('Instagram one-off real PostgreSQL consumption and process durability', () => {
  beforeAll(async () => {
    const pool = newPool();
    try {
      const result = await pool.query<{ table: string | null }>(
        "select to_regclass('provider_publications')::text as table",
      );
      expect(result.rows[0]?.table, 'Run the real repository migrations before this suite').toBe(
        'provider_publications',
      );
    } finally {
      await closePool(pool);
    }
  });

  afterEach(async () => {
    try {
      if (ownedIds.size > 0) {
        const cleanup = newPool();
        // Exact per-run synthetic IDs only. No TRUNCATE, broad DELETE, or provider-table reset.
        await cleanup.query(
          'delete from provider_publications where correlation_id = any($1::text[]) and correlation_id like $2',
          [[...ownedIds], `${SYNTHETIC_PREFIX}%`],
        );
        ownedIds.clear();
      }
    } finally {
      await Promise.all([...openPools].map((pool) => closePool(pool)));
      await Promise.all(
        [...receiptDirectories].map((directory) => rm(directory, { recursive: true })),
      );
      receiptDirectories.clear();
    }
  });

  it('grants exactly one committed INSERT winner across independent concurrent connections', async () => {
    const input = request();
    const first = newPool();
    const second = newPool();
    const pids = await Promise.all(
      [first, second].map((pool) => pool.query<{ pid: number }>('select pg_backend_pid() as pid')),
    );
    expect(pids[0]!.rows[0]!.pid).not.toBe(pids[1]!.rows[0]!.pid);
    const results = await Promise.all(
      [first, second].map((pool) =>
        new PostgresPublicationExecutionStore(pool).consumeOneOff(input, NOW),
      ),
    );
    expect(results.filter((result) => result.advance)).toHaveLength(1);
    expect(results.map((result) => result.publication.state)).toEqual([
      'CREATING_CONTAINER',
      'CREATING_CONTAINER',
    ]);
    const rows = await first.query<{ count: string }>(
      'select count(*)::text as count from provider_publications where idempotency_key = $1',
      [input.idempotencyKey],
    );
    expect(rows.rows[0]?.count).toBe('1');
  });

  it('allows only the live winner to create and publish while another executor races it', async () => {
    const input = request();
    const first = newPool();
    const second = newPool();
    const winnerTransport = new SyntheticInstagramTransport();
    const loserTransport = new SyntheticInstagramTransport();
    let entered!: () => void;
    let release!: () => void;
    const creationEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const creationReleased = new Promise<void>((resolve) => {
      release = resolve;
    });
    winnerTransport.afterCreate = () => {
      entered();
      return creationReleased;
    };
    const firstRun = executor(first, winnerTransport).execute(input);
    await Promise.race([creationEntered, firstRun]);
    try {
      await expect(executor(second, loserTransport).execute(input)).rejects.toThrow(CONSUMED);
    } finally {
      release();
    }
    expect((await firstRun).completed).toBe(true);
    expect(winnerTransport.calls).toEqual({ create: 1, status: 1, publish: 1 });
    expect(loserTransport.calls).toEqual({ create: 0, status: 0, publish: 0 });
  });

  it('does not recreate a winner capability on a fresh connection after consumption', async () => {
    const input = request();
    const first = newPool();
    const consumed = await new PostgresPublicationExecutionStore(first).consumeOneOff(input, NOW);
    expect(consumed.advance).toBeTypeOf('function');
    await closePool(first);
    const restarted = newPool();
    const recovered = await new PostgresPublicationExecutionStore(restarted).consumeOneOff(
      input,
      NOW,
    );
    expect(recovered.advance).toBeUndefined();
    expect(recovered.publication).toEqual(consumed.publication);
    const transport = new SyntheticInstagramTransport();
    await expect(executor(restarted, transport).execute(input)).rejects.toThrow(CONSUMED);
    expect(transport.calls).toEqual({ create: 0, status: 0, publish: 0 });
  });

  const mutations: ReadonlyArray<{
    name: string;
    change: (input: InstagramPublishRequest) => InstagramPublishRequest;
  }> = [
    { name: 'caption', change: (input) => ({ ...input, caption: 'Changed command' }) },
    {
      name: 'media URL',
      change: (input) => ({ ...input, mediaUrls: ['https://example.invalid/other.jpg'] }),
    },
    { name: 'media type', change: (input) => ({ ...input, mediaType: 'STORY' }) },
    {
      name: 'correlation',
      change: (input) => ({ ...input, correlationId: `${input.correlationId}-changed` }),
    },
    {
      name: 'Instagram account',
      change: (input) => ({
        ...input,
        account: { ...input.account, instagramAccountId: 'synthetic-other' },
      }),
    },
    {
      name: 'page account',
      change: (input) => ({
        ...input,
        account: { ...input.account, pageId: 'synthetic-other-page' },
      }),
    },
    {
      name: 'asset digest',
      change: (input) => ({ ...input, publicationAssetSha256: 'b'.repeat(64) }),
    },
    {
      name: 'creative truth binding',
      change: (input) => ({
        ...input,
        creativeTruthBinding: {
          policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
          standardId: 'synthetic-standard',
          creativeId: 'synthetic-creative',
          outputSha256: 'b'.repeat(64),
          brandIntegrityStatus: 'PASSED',
          venueFidelityStatus: 'PASSED',
          qualityGateStatus: 'PASSED',
          exactAssetBinding: true,
        },
      }),
    },
    {
      name: 'descriptor command digest',
      change: (input) => ({
        ...input,
        oneOff: { ...input.oneOff!, commandEnvelopeSha256: 'b'.repeat(64) },
      }),
    },
    {
      name: 'descriptor valid-from',
      change: (input) => ({
        ...input,
        oneOff: { ...input.oneOff!, validFrom: '2026-10-21T11:30:00.000Z' },
      }),
    },
    {
      name: 'descriptor valid-until',
      change: (input) => ({
        ...input,
        oneOff: { ...input.oneOff!, validUntil: '2026-10-21T12:30:00.000Z' },
      }),
    },
  ];

  it.each(mutations)(
    'rejects changed canonical $name without any provider call',
    async ({ change }) => {
      const input = request();
      const pool = newPool();
      const store = new PostgresPublicationExecutionStore(pool);
      await store.consumeOneOff(input, NOW);
      const altered = change(input);
      ownedIds.add(altered.correlationId);
      expect(altered.idempotencyKey).toBe(input.idempotencyKey);
      const transport = new SyntheticInstagramTransport();
      await expect(executor(pool, transport).execute(altered)).rejects.toThrow(CONFLICT);
      expect(transport.calls).toEqual({ create: 0, status: 0, publish: 0 });
      expect(await storedState(pool, input)).toBe('CREATING_CONTAINER');
    },
  );

  it.each(['provider', 'account_id'] as const)(
    'rejects a changed persisted %s binding',
    async (column) => {
      const input = request();
      const pool = newPool();
      await new PostgresPublicationExecutionStore(pool).consumeOneOff(input, NOW);
      const statement =
        column === 'provider'
          ? 'update provider_publications set provider = $2 where correlation_id = $1'
          : 'update provider_publications set account_id = $2 where correlation_id = $1';
      await pool.query(statement, [input.correlationId, 'synthetic-conflicting-binding']);
      const transport = new SyntheticInstagramTransport();
      await expect(executor(pool, transport).execute(input)).rejects.toThrow(CONFLICT);
      expect(transport.calls).toEqual({ create: 0, status: 0, publish: 0 });
    },
  );

  const storedStates: ReadonlyArray<{ state: PublicationState; lastError: string | null }> = [
    { state: 'DRAFT', lastError: null },
    { state: 'SCHEDULED', lastError: null },
    { state: 'CREATING_CONTAINER', lastError: null },
    { state: 'PROCESSING', lastError: null },
    { state: 'PUBLISHING', lastError: null },
    { state: 'FAILED', lastError: 'ORDINARY_DETERMINISTIC_FAILURE' },
    { state: 'FAILED', lastError: 'PUBLISH_UNCERTAIN:synthetic-lost-response' },
    { state: 'CANCELED', lastError: null },
    { state: 'PUBLISHED', lastError: null },
  ];

  it.each(storedStates)(
    'treats persisted $state ($lastError) as consumed, never as a lease',
    async ({ state, lastError }) => {
      const input = request();
      const pool = newPool();
      const store = new PostgresPublicationExecutionStore(pool);
      await store.consumeOneOff(input, NOW);
      await pool.query(
        'update provider_publications set state = $2, last_error = $3, external_resource_id = $4 where correlation_id = $1',
        [
          input.correlationId,
          state,
          lastError,
          state === 'PUBLISHED' ? 'synthetic-media' : 'synthetic-container',
        ],
      );
      expect((await store.consumeOneOff(input, NOW)).advance).toBeUndefined();
      const transport = new SyntheticInstagramTransport();
      if (state === 'PUBLISHED') {
        const result = await executor(pool, transport).execute(input);
        expect(result).toMatchObject({
          completed: true,
          publication: { state: 'PUBLISHED', externalMediaId: 'synthetic-media' },
        });
      } else {
        await expect(executor(pool, transport).execute(input)).rejects.toThrow(CONSUMED);
      }
      expect(transport.calls).toEqual({ create: 0, status: 0, publish: 0 });
      expect(await storedState(pool, input)).toBe(state);
    },
  );

  it('performs bounded processing GET polls in the winning invocation only', async () => {
    const input = request();
    const pool = newPool();
    const transport = new SyntheticInstagramTransport();
    transport.statuses = ['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED'];
    expect((await executor(pool, transport, 3).execute(input)).completed).toBe(true);
    expect(transport.calls).toEqual({ create: 1, status: 3, publish: 1 });
    expect((await executor(pool, transport).execute(input)).completed).toBe(true);
    expect(transport.calls).toEqual({ create: 1, status: 3, publish: 1 });
  });

  it('does not resume polling or create again after the winning invocation exhausts its bound', async () => {
    const input = request();
    const pool = newPool();
    const transport = new SyntheticInstagramTransport();
    transport.statuses = ['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED'];
    await expect(executor(pool, transport, 2).execute(input)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_ONE_OFF_PROCESSING_TIMEOUT_RECONCILIATION_REQUIRED',
    );
    expect(await storedState(pool, input)).toBe('FAILED');
    await expect(executor(newPool(), transport).execute(input)).rejects.toThrow(CONSUMED);
    expect(transport.calls).toEqual({ create: 1, status: 2, publish: 0 });
  });

  it.each([
    {
      field: 'state',
      sql: "update provider_publications set state = 'CANCELED' where correlation_id = $1 and state = 'PROCESSING'",
      state: 'CANCELED',
      replayError: CONSUMED,
    },
    {
      field: 'provider',
      sql: "update provider_publications set provider = 'synthetic-other-provider' where correlation_id = $1 and state = 'PROCESSING'",
      state: 'PROCESSING',
      replayError: CONFLICT,
    },
    {
      field: 'account',
      sql: "update provider_publications set account_id = 'synthetic-other-account' where correlation_id = $1 and state = 'PROCESSING'",
      state: 'PROCESSING',
      replayError: CONFLICT,
    },
    {
      field: 'canonical request',
      sql: `update provider_publications set payload = jsonb_set(payload, '{caption}', '"synthetic-changed-command"'::jsonb) where correlation_id = $1 and state = 'PROCESSING'`,
      state: 'PROCESSING',
      replayError: CONFLICT,
    },
  ])(
    'does not publish when a real concurrent $field change makes the owner CAS affect zero rows',
    async ({ sql, state, replayError }) => {
      const input = request();
      const pool = newPool();
      const rival = newPool();
      const transport = new SyntheticInstagramTransport();
      const attemptedStates: unknown[] = [];
      // Observe statements without changing SQL, results, transaction behavior,
      // or row counts. Every owner mutation still reaches the real server.
      const observedPool = {
        query: (statement: string, values?: unknown[]) => {
          if (/^\s*update\s+provider_publications\b/i.test(statement)) {
            attemptedStates.push(values?.[1]);
          }
          return pool.query(statement, values);
        },
      } as unknown as pg.Pool;
      transport.onStatus = async () => {
        const changed = await rival.query(sql, [input.correlationId]);
        expect(changed.rowCount).toBe(1);
      };
      await expect(executor(observedPool, transport).execute(input)).rejects.toThrow(
        'INSTAGRAM_PUBLICATION_UPDATE_CONFLICT',
      );
      expect(attemptedStates).toEqual(['PROCESSING', 'PUBLISHING']);
      expect(transport.calls).toEqual({ create: 1, status: 1, publish: 0 });
      expect(await storedState(rival, input)).toBe(state);
      await expect(executor(newPool(), transport).execute(input)).rejects.toThrow(replayError);
      expect(transport.calls.publish).toBe(0);
    },
  );

  it('fails closed on a lost ACK after a real committed INSERT and remains consumed after process restart', async () => {
    const input = request();
    const pool = newPool();
    let suppressedCommittedInsert = false;
    // This is a delivery-fault adapter, not a PostgreSQL mock: all SQL goes to
    // the real server. A single-statement pool.query INSERT is committed before
    // its result is deliberately discarded, modeling a lost commit response.
    const loseAcknowledgment = {
      query: async (sql: string, values?: unknown[]) => {
        const result = await pool.query(sql, values);
        if (
          !suppressedCommittedInsert &&
          /^\s*insert\s+into\s+provider_publications\b/i.test(sql)
        ) {
          expect(result.rowCount).toBe(1);
          suppressedCommittedInsert = true;
          throw new Error('SYNTHETIC_COMMITTED_INSERT_ACK_LOST');
        }
        return result;
      },
    } as unknown as pg.Pool;
    const transport = new SyntheticInstagramTransport();
    await expect(executor(loseAcknowledgment, transport).execute(input)).rejects.toThrow(
      'INSTAGRAM_PUBLICATION_ONE_OFF_CONSUMPTION_UNKNOWN',
    );
    expect(suppressedCommittedInsert).toBe(true);
    expect(transport.calls).toEqual({ create: 0, status: 0, publish: 0 });
    expect(await storedState(newPool(), input)).toBe('CREATING_CONTAINER');
    await closePool(pool);
    const file = await receiptFile();
    const restarted = workerReport(await runWorker(input, file));
    expect(restarted).toMatchObject({
      ok: false,
      error: CONSUMED,
      calls: { create: 0, status: 0, publish: 0 },
    });
    expect(await receipts(file)).toEqual([]);
  }, 30_000);

  const crashes: ReadonlyArray<{
    point: CrashPoint;
    state: PublicationState;
    events: readonly string[];
  }> = [
    { point: 'after_consumption', state: 'CREATING_CONTAINER', events: [] },
    { point: 'before_create', state: 'CREATING_CONTAINER', events: [] },
    { point: 'after_create', state: 'CREATING_CONTAINER', events: ['create'] },
    { point: 'processing', state: 'PROCESSING', events: ['create', 'status'] },
    { point: 'before_publish', state: 'PUBLISHING', events: ['create', 'status'] },
    { point: 'after_publish', state: 'PUBLISHING', events: ['create', 'status', 'publish'] },
  ];

  it.each(crashes)(
    'survives hard SIGKILL at $point without recreating or republishing on process restart',
    async ({ point, state, events }) => {
      const input = request();
      const file = await receiptFile();
      const crashed = await runWorker(input, file, point);
      expect(crashed.signal, crashed.stderr).toBe('SIGKILL');
      expect(crashed.code).toBeNull();
      expect(await receipts(file)).toEqual(events);
      expect(await storedState(newPool(), input)).toBe(state);
      const restarted = workerReport(await runWorker(input, file));
      expect(restarted).toMatchObject({
        ok: false,
        error: CONSUMED,
        calls: { create: 0, status: 0, publish: 0 },
      });
      expect(await receipts(file)).toEqual(events);
      expect(await storedState(newPool(), input)).toBe(state);
    },
    45_000,
  );

  it('returns durable PUBLISHED after a successful worker exits without any restarted provider calls', async () => {
    const input = request();
    const file = await receiptFile();
    const first = workerReport(await runWorker(input, file));
    expect(first).toMatchObject({
      ok: true,
      completed: true,
      state: 'PUBLISHED',
      calls: { create: 1, status: 1, publish: 1 },
    });
    const restarted = workerReport(await runWorker(input, file));
    expect(restarted).toMatchObject({
      ok: true,
      completed: true,
      state: 'PUBLISHED',
      calls: { create: 0, status: 0, publish: 0 },
    });
    expect(await receipts(file)).toEqual(['create', 'status', 'publish']);
    expect(await storedState(newPool(), input)).toBe('PUBLISHED');
  }, 45_000);
});
