import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createRuntimeReadinessChecks } from '../src/health/runtime-readiness.js';
import { evaluateReadiness } from '../src/health/readiness.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('production runtime readiness', () => {
  it('reports ready when mandatory dependencies and disabled provider gates are healthy', async () => {
    const migrationsDirectory = await emptyMigrationsDirectory();
    const report = await evaluateReadiness(
      createRuntimeReadinessChecks({
        config: testConfig(),
        env: baseEnv(),
        pool: fakePool(),
        migrationsDirectory,
      }),
    );

    expect(report.status).toBe('ready');
    expect(report.checks).toHaveLength(14);
    expect(report.checks.every((check) => check.ok)).toBe(true);
  });

  it('fails the db check when PostgreSQL is unavailable', async () => {
    const migrationsDirectory = await emptyMigrationsDirectory();
    const report = await evaluateReadiness(
      createRuntimeReadinessChecks({
        config: testConfig(),
        env: baseEnv(),
        pool: fakePool({ databaseFailure: true }),
        migrationsDirectory,
      }),
    );

    expect(report.status).toBe('not_ready');
    expect(report.checks).toContainEqual({ name: 'db', ok: false });
  });

  it('fails closed when a provider is enabled without provider verification', async () => {
    const migrationsDirectory = await emptyMigrationsDirectory();
    const env = {
      ...baseEnv(),
      WHATSAPP_ENABLED: 'true',
      WHATSAPP_PROVIDER_VERIFIED: 'false',
      WHATSAPP_BINDING_STATE: 'PRODUCTION_VALIDATED',
      WHATSAPP_META_APP_ID: 'app',
      WHATSAPP_WABA_ID: 'waba',
      WHATSAPP_PHONE_NUMBER_ID: 'phone',
      WHATSAPP_BINDING_ID: 'binding',
      WHATSAPP_ACCESS_TOKEN_ENV_KEY: 'TOCA_SECRET_META_ACCESS_TOKEN',
      TOCA_SECRET_META_ACCESS_TOKEN: 'secret',
    } satisfies NodeJS.ProcessEnv;
    const report = await evaluateReadiness(
      createRuntimeReadinessChecks({
        config: testConfig(),
        env,
        pool: fakePool(),
        migrationsDirectory,
      }),
    );

    expect(report.status).toBe('not_ready');
    expect(report.checks).toContainEqual({ name: 'whatsapp', ok: false });
  });

  it('detects repository migrations missing from the database', async () => {
    const migrationsDirectory = await emptyMigrationsDirectory();
    await writeFile(
      join(migrationsDirectory, '999_readiness_fixture.sql'),
      'select 1;\n',
      'utf8',
    );
    const report = await evaluateReadiness(
      createRuntimeReadinessChecks({
        config: testConfig(),
        env: baseEnv(),
        pool: fakePool({ appliedMigrations: [] }),
        migrationsDirectory,
      }),
    );

    expect(report.status).toBe('not_ready');
    expect(report.checks).toContainEqual({ name: 'migrations', ok: false });
  });

  it('fails readiness when Outbox lag breaches the configured bound', async () => {
    const migrationsDirectory = await emptyMigrationsDirectory();
    const report = await evaluateReadiness(
      createRuntimeReadinessChecks({
        config: testConfig(),
        env: baseEnv(),
        pool: fakePool({ outboxLagSeconds: 301 }),
        migrationsDirectory,
      }),
    );

    expect(report.status).toBe('not_ready');
    expect(report.checks).toContainEqual({ name: 'outbox', ok: false });
  });

  it('fails readiness while the emergency platform kill switch is active', async () => {
    const migrationsDirectory = await emptyMigrationsDirectory();
    const report = await evaluateReadiness(
      createRuntimeReadinessChecks({
        config: testConfig(),
        env: { ...baseEnv(), TOCA_PLATFORM_KILL_SWITCH: 'true' },
        pool: fakePool(),
        migrationsDirectory,
      }),
    );

    expect(report.status).toBe('not_ready');
    expect(report.checks).toContainEqual({ name: 'critical_configuration', ok: false });
  });
});

function baseEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://readiness.invalid/toca',
    MCP_ENABLED: 'true',
  };
}

function testConfig() {
  return loadConfig(baseEnv());
}

async function emptyMigrationsDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'toca-readiness-'));
  temporaryDirectories.push(directory);
  return directory;
}

function fakePool(
  options: {
    readonly databaseFailure?: boolean;
    readonly appliedMigrations?: readonly string[];
    readonly outboxLagSeconds?: number;
    readonly deadLetterCount?: number;
  } = {},
): pg.Pool {
  const query = async (text: string, values?: readonly unknown[]) => {
    if (text === 'select 1') {
      if (options.databaseFailure) throw new Error('DATABASE_UNAVAILABLE');
      return { rows: [], rowCount: 1 };
    }

    if (text.includes('select version from schema_migrations')) {
      return {
        rows: (options.appliedMigrations ?? []).map((version) => ({ version })),
        rowCount: options.appliedMigrations?.length ?? 0,
      };
    }

    if (text.includes('to_regclass')) {
      const tableNames = Array.isArray(values?.[0])
        ? (values?.[0] as readonly string[])
        : [];
      return {
        rows: tableNames.map((tableName) => ({
          table_name: tableName,
          relation: tableName,
        })),
        rowCount: tableNames.length,
      };
    }

    if (text.includes('from audit_ledger_heads h')) return { rows: [], rowCount: 0 };

    if (text.includes('from event_outbox')) {
      return {
        rows: [
          {
            oldest_pending_age_seconds: options.outboxLagSeconds ?? 0,
            dead_letter_count: options.deadLetterCount ?? 0,
          },
        ],
        rowCount: 1,
      };
    }

    return { rows: [], rowCount: 0 };
  };

  return { query } as unknown as pg.Pool;
}
