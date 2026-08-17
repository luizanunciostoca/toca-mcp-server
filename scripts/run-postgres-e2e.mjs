import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  assertCiRuntime,
  captureCommand,
  dockerCommand,
  pnpmCommand,
  runCommand,
} from './ci-helpers.mjs';

const POSTGRES_IMAGE = 'postgres:18';
const POSTGRES_USER = 'toca';
const POSTGRES_PASSWORD = 'toca-local-e2e-only';
const POSTGRES_DATABASE = 'toca_e2e';
const E2E_TESTS = [
  'test/m-found-12-postgres-e2e.test.ts',
  'test/r29-video-postgres-e2e.test.ts',
];

function isSafeE2eDatabase(connectionString) {
  const url = new URL(connectionString);
  const allowedHosts = new Set(['127.0.0.1', 'localhost', 'postgres']);
  return allowedHosts.has(url.hostname);
}

function waitForPostgres(containerName) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const result = spawnSync(
      dockerCommand(),
      ['exec', containerName, 'pg_isready', '-U', POSTGRES_USER, '-d', POSTGRES_DATABASE],
      { encoding: 'utf8' },
    );
    if (result.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error('POSTGRES_E2E_DATABASE_NOT_READY');
}

function startIsolatedPostgres() {
  captureCommand(dockerCommand(), ['version', '--format', '{{.Server.Version}}']);
  const containerName = `toca-postgres-e2e-${randomUUID().slice(0, 8)}`;

  try {
    runCommand(
      dockerCommand(),
      [
        'run',
        '--detach',
        '--rm',
        '--name',
        containerName,
        '-e',
        `POSTGRES_USER=${POSTGRES_USER}`,
        '-e',
        `POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`,
        '-e',
        `POSTGRES_DB=${POSTGRES_DATABASE}`,
        '-p',
        '127.0.0.1::5432',
        POSTGRES_IMAGE,
      ],
      { name: 'POSTGRES_START' },
    );

    waitForPostgres(containerName);
    const portOutput = captureCommand(dockerCommand(), ['port', containerName, '5432/tcp']);
    const match = portOutput.match(/127\.0\.0\.1:(\d+)/);
    if (!match) throw new Error(`POSTGRES_E2E_PORT_UNRESOLVED output=${portOutput}`);

    return {
      containerName,
      connectionString: `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${match[1]}/${POSTGRES_DATABASE}`,
    };
  } catch (error) {
    spawnSync(dockerCommand(), ['rm', '--force', containerName], { encoding: 'utf8' });
    throw error;
  }
}

assertCiRuntime();
let managedContainer = null;
const env = { ...process.env };

try {
  if (!env.DATABASE_URL) {
    const isolated = startIsolatedPostgres();
    managedContainer = isolated.containerName;
    env.DATABASE_URL = isolated.connectionString;
    env.DATABASE_SSL = 'false';
  } else if (!isSafeE2eDatabase(env.DATABASE_URL) && env.TOCA_POSTGRES_E2E_ALLOW_EXTERNAL !== '1') {
    throw new Error(
      'POSTGRES_E2E_UNSAFE_DATABASE_HOST: use an isolated localhost/postgres host or set TOCA_POSTGRES_E2E_ALLOW_EXTERNAL=1 explicitly',
    );
  }

  runCommand(pnpmCommand(), ['migrate'], { name: 'POSTGRES_MIGRATE_INITIAL', env });
  runCommand(pnpmCommand(), ['migration:verify'], {
    name: 'POSTGRES_MIGRATION_STATE_INITIAL',
    env,
  });
  runCommand(pnpmCommand(), ['exec', 'vitest', 'run', ...E2E_TESTS], {
    name: 'POSTGRES_E2E_TESTS',
    env,
  });
  runCommand(pnpmCommand(), ['migrate'], { name: 'POSTGRES_MIGRATE_REPEAT', env });
  runCommand(pnpmCommand(), ['migration:verify'], {
    name: 'POSTGRES_MIGRATION_STATE_FINAL',
    env,
  });
  console.log('POSTGRES_E2E_RESULT=PASS');
} catch (error) {
  console.error(`POSTGRES_E2E_RESULT=FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (managedContainer) {
    const cleanup = spawnSync(dockerCommand(), ['rm', '--force', managedContainer], {
      encoding: 'utf8',
    });
    if (cleanup.status !== 0 && process.exitCode !== 1) {
      console.error(`POSTGRES_E2E_CLEANUP_FAILED=${managedContainer}`);
      process.exitCode = 1;
    }
  }
}
