import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync } from 'node:fs';
import { URL } from 'node:url';
import {
  assertCiRuntime,
  captureCommand,
  dockerCommand,
  pnpmCommand,
  runCommand,
} from './ci-helpers.mjs';

const POSTGRES_IMAGE = 'postgres:18';
const POSTGRES_USER = 'toca';
const POSTGRES_PASSWORD = 'toca-postgres-e2e-only';
const POSTGRES_DB = 'toca_e2e';
const allowedLocalHosts = new Set(['127.0.0.1', 'localhost', '::1', 'postgres']);
const evidenceDir = process.env.TOCA_POSTGRES_E2E_EVIDENCE_DIR;
const E2E_TESTS = readdirSync('test', { withFileTypes: true })
  .filter((entry) => entry.isFile() && /-postgres-e2e\.test\.ts$/.test(entry.name))
  .map((entry) => `test/${entry.name}`)
  .sort();
if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });

function assertSafeDatabaseUrl(connectionString) {
  const parsed = new URL(connectionString);
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`POSTGRES_E2E_UNSUPPORTED_PROTOCOL=${parsed.protocol}`);
  }
  if (
    process.env.TOCA_POSTGRES_E2E_ALLOW_EXTERNAL !== '1' &&
    !allowedLocalHosts.has(parsed.hostname)
  ) {
    throw new Error(`POSTGRES_E2E_EXTERNAL_DATABASE_REJECTED host=${parsed.hostname}`);
  }
}

function logPath(name) {
  return evidenceDir ? `${evidenceDir}/${name}.log` : undefined;
}

function waitForPostgres(containerName) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      runCommand(
        dockerCommand(),
        ['exec', containerName, 'pg_isready', '-U', POSTGRES_USER, '-d', POSTGRES_DB],
        { name: `POSTGRES_READY_ATTEMPT_${attempt}`, echo: false },
      );
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
    }
  }
  throw new Error('POSTGRES_E2E_DATABASE_NOT_READY');
}

assertCiRuntime();
if (E2E_TESTS.length === 0) throw new Error('POSTGRES_E2E_TESTS_NOT_FOUND');
console.log(`POSTGRES_E2E_TESTS=${E2E_TESTS.join(',')}`);
let containerName;
let cleanupRequired = false;
let failure;

try {
  let connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    captureCommand(dockerCommand(), ['version', '--format', '{{.Server.Version}}']);
    containerName = `toca-postgres-e2e-${randomUUID().slice(0, 8)}`;
    runCommand(
      dockerCommand(),
      [
        'run',
        '--detach',
        '--rm',
        '--name',
        containerName,
        '--env',
        `POSTGRES_USER=${POSTGRES_USER}`,
        '--env',
        `POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`,
        '--env',
        `POSTGRES_DB=${POSTGRES_DB}`,
        '--publish',
        '127.0.0.1::5432',
        POSTGRES_IMAGE,
      ],
      { name: 'POSTGRES_E2E_START' },
    );
    cleanupRequired = true;
    waitForPostgres(containerName);
    const portOutput = captureCommand(dockerCommand(), ['port', containerName, '5432/tcp']);
    const match = portOutput.match(/:(\d+)$/m);
    if (!match) throw new Error(`POSTGRES_E2E_PORT_UNRESOLVED=${portOutput}`);
    connectionString = `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${match[1]}/${POSTGRES_DB}`;
  }

  assertSafeDatabaseUrl(connectionString);
  const env = {
    ...process.env,
    DATABASE_URL: connectionString,
    DATABASE_SSL: process.env.DATABASE_SSL ?? 'false',
  };

  runCommand(pnpmCommand(), ['migrate'], {
    name: 'POSTGRES_E2E_MIGRATE_FIRST',
    env,
    logPath: logPath('01-migrate-first'),
  });
  runCommand(pnpmCommand(), ['migration:verify'], {
    name: 'POSTGRES_E2E_MIGRATION_STATE_FIRST',
    env,
    logPath: logPath('02-migration-state-first'),
  });
  runCommand(pnpmCommand(), ['exec', 'vitest', 'run', ...E2E_TESTS], {
    name: 'POSTGRES_E2E_TESTS',
    env,
    logPath: logPath('03-postgres-e2e-tests'),
  });
  runCommand(pnpmCommand(), ['migrate'], {
    name: 'POSTGRES_E2E_MIGRATE_SECOND',
    env,
    logPath: logPath('04-migrate-second'),
  });
  runCommand(pnpmCommand(), ['migration:verify'], {
    name: 'POSTGRES_E2E_MIGRATION_STATE_SECOND',
    env,
    logPath: logPath('05-migration-state-second'),
  });
  console.log('POSTGRES_E2E_RESULT=PASS');
} catch (error) {
  failure = error;
  console.error(`POSTGRES_E2E_RESULT=FAIL ${error instanceof Error ? error.message : String(error)}`);
} finally {
  if (cleanupRequired && containerName) {
    try {
      runCommand(dockerCommand(), ['rm', '--force', containerName], {
        name: 'POSTGRES_E2E_CLEANUP',
      });
    } catch (cleanupError) {
      failure ??= cleanupError;
      console.error(
        `POSTGRES_E2E_CLEANUP=FAIL ${
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        }`,
      );
    }
  }
}

if (failure) process.exit(1);
