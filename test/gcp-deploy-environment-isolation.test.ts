import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const validator = 'scripts/validate-gcp-deploy-environment.mjs';
const exporter = 'scripts/export-staging-deploy-config.mjs';
const configPath = 'infra/environments/staging.json';
const productionKeys = [
  'PRODUCTION_GCP_PROJECT_ID',
  'PRODUCTION_GCP_PROJECT_NUMBER',
  'PRODUCTION_GCP_REGION',
  'PRODUCTION_GCP_CLOUD_SQL_INSTANCE',
  'PRODUCTION_GCP_CLOUD_RUN_MCP_SERVICE',
  'PRODUCTION_GCP_CLOUD_RUN_WEBHOOK_SERVICE',
  'PRODUCTION_GCP_DATABASE_URL_SECRET',
  'PRODUCTION_GCP_WORKLOAD_IDENTITY_PROVIDER',
  'PRODUCTION_GCP_DEPLOY_SERVICE_ACCOUNT',
  'PRODUCTION_GCP_MCP_RUNTIME_SERVICE_ACCOUNT',
  'PRODUCTION_GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT',
];

function exportedConfig(): Record<string, string> {
  const result = spawnSync(process.execPath, [exporter, configPath], { encoding: 'utf8' });
  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  return Object.fromEntries(
    result.stdout
      .trimEnd()
      .split('\n')
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

function stagingEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DEPLOY_ENVIRONMENT: 'staging',
    ...exportedConfig(),
  };
  for (const key of productionKeys) delete env[key];
  return env;
}

function run(env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [validator], {
    env,
    encoding: 'utf8',
  });
}

function output(result: ReturnType<typeof run>): string {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

describe('staging GCP deploy environment isolation', () => {
  it('accepts canonical staging coordinates without production coordinates', () => {
    const env = stagingEnv();
    for (const key of productionKeys) expect(env[key]).toBeUndefined();
    const result = run(env);
    expect(result.status, output(result)).toBe(0);
    expect(output(result)).toContain('GCP_DEPLOY_ENVIRONMENT_VALIDATED=staging');
  });

  it('rejects a staging environment contaminated with production coordinates', () => {
    const env = stagingEnv();
    env.PRODUCTION_GCP_PROJECT_ID = 'should-not-be-required-for-staging';
    const result = run(env);
    expect(result.status).toBe(1);
    expect(output(result)).toContain(
      'STAGING_PRODUCTION_COORDINATE_FORBIDDEN:PRODUCTION_GCP_PROJECT_ID',
    );
  });

  it('rejects drift between exported environment and the canonical file', () => {
    const env = stagingEnv();
    env.GCP_ARTIFACT_REPOSITORY = 'drifted-repository';
    const result = run(env);
    expect(result.status).toBe(1);
    expect(output(result)).toContain('STAGING_CONFIG_ENV_MISMATCH:GCP_ARTIFACT_REPOSITORY');
  });

  it('rejects provider activation in canonical staging', () => {
    const env = stagingEnv();
    env.EMAIL_SENDGRID_ENABLED = 'true';
    const result = run(env);
    expect(result.status).toBe(1);
    expect(output(result)).toContain('STAGING_PROVIDER_MODE_CONFLICT');
  });

  it('stores only Secret Manager references, never secret payloads', () => {
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      secretReferences: { databaseUrl: Record<string, unknown> };
    };
    expect(config.secretReferences.databaseUrl).toEqual({
      id: 'toca-next-staging-database-url',
      version: 'latest',
    });
    const serialized = JSON.stringify(config).toLowerCase();
    expect(serialized).not.toContain('postgresql://');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('api_key');
    expect(serialized).not.toContain('access_token');
  });
});
