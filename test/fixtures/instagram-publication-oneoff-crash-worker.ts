import { closeSync, fsyncSync, openSync, writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgresPublicationExecutionStore } from '../../src/persistence/postgres-publication-store.js';
import { createPostgresPool } from '../../src/persistence/postgres.js';
import type { InstagramPublishRequest } from '../../src/providers/instagram/instagram-contracts.js';
import {
  InstagramPublicationExecutor,
  type InstagramPublicationTransport,
} from '../../src/providers/instagram/instagram-publication-executor.js';

export const SYNTHETIC_PREFIX = 'instagram-oneoff-e2e-';
export const NOW = '2026-10-21T12:00:00.000Z';

export type CrashPoint =
  | 'after_consumption'
  | 'before_create'
  | 'after_create'
  | 'processing'
  | 'before_publish'
  | 'after_publish';

/** No DATABASE_URL fallback: this fixture must never discover an application database. */
export function disposableDatabaseUrl(
  value: string | undefined,
  disposable: string | undefined,
  required = false,
): string | undefined {
  if (!value) {
    if (required) throw new Error('INSTAGRAM_ONEOFF_E2E_DATABASE_URL_REQUIRED');
    return undefined;
  }
  if (disposable !== 'true') {
    throw new Error('INSTAGRAM_ONEOFF_E2E_EXPLICIT_DISPOSABLE_DATABASE_REQUIRED');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('INSTAGRAM_ONEOFF_E2E_INVALID_DATABASE_URL');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname ||
    url.pathname === '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('INSTAGRAM_ONEOFF_E2E_DISPOSABLE_LOOPBACK_DATABASE_REQUIRED');
  }
  return value;
}

export class SyntheticInstagramTransport implements InstagramPublicationTransport {
  readonly calls = { create: 0, status: 0, publish: 0 };
  statuses: Array<'IN_PROGRESS' | 'FINISHED' | 'ERROR'> = ['FINISHED'];
  beforeCreate?: () => Promise<void>;
  afterCreate?: () => Promise<void>;
  onStatus?: () => Promise<void>;
  beforePublish?: () => Promise<void>;
  afterPublish?: () => Promise<void>;

  constructor(private readonly receiptFile?: string) {}

  private record(event: keyof SyntheticInstagramTransport['calls']): void {
    this.calls[event] += 1;
    if (!this.receiptFile) return;
    // Fsync the fake provider's receipt before SIGKILL, independent of application state.
    const descriptor = openSync(this.receiptFile, 'a', 0o600);
    try {
      writeSync(descriptor, `${JSON.stringify({ event })}\n`);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }

  async createContainer(): Promise<{ readonly containerId: string }> {
    await this.beforeCreate?.();
    this.record('create');
    await this.afterCreate?.();
    return { containerId: 'synthetic-container' };
  }

  async getContainerStatus(): Promise<'IN_PROGRESS' | 'FINISHED' | 'ERROR'> {
    this.record('status');
    await this.onStatus?.();
    return this.statuses.shift() ?? 'IN_PROGRESS';
  }

  async publishContainer(): Promise<{ readonly mediaId: string }> {
    await this.beforePublish?.();
    this.record('publish');
    await this.afterPublish?.();
    return { mediaId: 'synthetic-media' };
  }
}

export interface WorkerReport {
  readonly ok: boolean;
  readonly error?: string;
  readonly state?: string;
  readonly completed?: boolean;
  readonly calls: SyntheticInstagramTransport['calls'];
}

function hardCrash(): never {
  process.kill(process.pid, 'SIGKILL');
  throw new Error('INSTAGRAM_ONEOFF_E2E_SIGKILL_DID_NOT_TERMINATE');
}

async function main(): Promise<void> {
  const connectionString = disposableDatabaseUrl(
    process.env.INSTAGRAM_ONEOFF_E2E_DATABASE_URL,
    process.env.INSTAGRAM_ONEOFF_E2E_DISPOSABLE_DATABASE,
    true,
  );
  if (!connectionString) throw new Error('INSTAGRAM_ONEOFF_E2E_DATABASE_URL_REQUIRED');
  const request = JSON.parse(
    process.env.INSTAGRAM_ONEOFF_E2E_REQUEST ?? 'null',
  ) as InstagramPublishRequest | null;
  if (
    !request ||
    !request.correlationId.startsWith(SYNTHETIC_PREFIX) ||
    !request.account.instagramAccountId.startsWith('synthetic-') ||
    !request.oneOff?.authorizationRef.startsWith(SYNTHETIC_PREFIX)
  ) {
    throw new Error('INSTAGRAM_ONEOFF_E2E_SYNTHETIC_REQUEST_REQUIRED');
  }
  const action = process.argv[2];
  const point = process.argv[3];
  if (action !== 'execute' && action !== 'crash') {
    throw new Error('INSTAGRAM_ONEOFF_E2E_UNKNOWN_WORKER_ACTION');
  }
  const crashPoints: readonly string[] = [
    'after_consumption',
    'before_create',
    'after_create',
    'processing',
    'before_publish',
    'after_publish',
  ];
  if (action === 'crash' && (!point || !crashPoints.includes(point))) {
    throw new Error('INSTAGRAM_ONEOFF_E2E_UNKNOWN_CRASH_POINT');
  }
  const pool = createPostgresPool({ connectionString, max: 1, ssl: false });
  const store = new PostgresPublicationExecutionStore(pool);
  const transport = new SyntheticInstagramTransport(process.env.INSTAGRAM_ONEOFF_E2E_RECEIPT_FILE);
  if (action === 'crash') {
    const crash = (): Promise<void> => hardCrash();
    if (point === 'before_create') transport.beforeCreate = crash;
    if (point === 'after_create') transport.afterCreate = crash;
    if (point === 'processing') transport.onStatus = crash;
    if (point === 'before_publish') transport.beforePublish = crash;
    if (point === 'after_publish') transport.afterPublish = crash;
  }
  try {
    if (action === 'crash' && point === 'after_consumption') {
      const consumed = await store.consumeOneOff(request, NOW);
      if (!consumed.advance) throw new Error('INSTAGRAM_ONEOFF_E2E_EXPECTED_INSERT_WINNER');
      hardCrash();
    }
    const executor = new InstagramPublicationExecutor(store, transport, () => NOW, false, {
      maxAttempts: 3,
      pollIntervalMs: 0,
      sleep: () => Promise.resolve(),
    });
    let report: WorkerReport;
    try {
      const result = await executor.execute(request);
      report = {
        ok: true,
        state: result.publication.state,
        completed: result.completed,
        calls: transport.calls,
      };
    } catch (error) {
      report = {
        ok: false,
        error: error instanceof Error ? error.message : 'UNKNOWN_WORKER_ERROR',
        calls: transport.calls,
      };
    }
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    await pool.end();
  }
}

// Importable test helpers do not start a database connection or a worker.
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'WORKER_FAILED'}\n`);
    process.exitCode = 1;
  });
}
