import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const script = 'scripts/validate-gcp-deploy-environment.mjs';

function stagingEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DEPLOY_ENVIRONMENT: 'staging',
    GCP_PROJECT_ID: 'toca-staging',
    GCP_PROJECT_NUMBER: '123456789',
    GCP_REGION: 'southamerica-east1',
    GCP_ARTIFACT_REPOSITORY: 'toca-staging',
    GCP_CLOUD_SQL_INSTANCE: 'toca-db-staging',
    GCP_CLOUD_RUN_MCP_SERVICE: 'toca-mcp-staging',
    GCP_CLOUD_RUN_WEBHOOK_SERVICE: 'toca-webhook-staging',
    GCP_WORKLOAD_IDENTITY_PROVIDER:
      'projects/123456789/locations/global/workloadIdentityPools/github/providers/toca-staging',
    GCP_DEPLOY_SERVICE_ACCOUNT: 'deploy@toca-staging.iam.gserviceaccount.com',
    GCP_MCP_RUNTIME_SERVICE_ACCOUNT: 'mcp@toca-staging.iam.gserviceaccount.com',
    GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT: 'webhook@toca-staging.iam.gserviceaccount.com',
    GCP_DATABASE_URL_SECRET: 'database-url-staging',
    GCP_DATABASE_URL_SECRET_VERSION: '1',
    PRODUCTION_GCP_PROJECT_ID: 'toca-production',
    PRODUCTION_GCP_PROJECT_NUMBER: '987654321',
    PRODUCTION_GCP_REGION: 'southamerica-east1',
    PRODUCTION_GCP_CLOUD_SQL_INSTANCE: 'toca-db-production',
    PRODUCTION_GCP_CLOUD_RUN_MCP_SERVICE: 'toca-mcp-production',
    PRODUCTION_GCP_CLOUD_RUN_WEBHOOK_SERVICE: 'toca-webhook-production',
    PRODUCTION_GCP_DATABASE_URL_SECRET: 'database-url-production',
    PRODUCTION_GCP_WORKLOAD_IDENTITY_PROVIDER:
      'projects/987654321/locations/global/workloadIdentityPools/github/providers/toca-production',
    PRODUCTION_GCP_DEPLOY_SERVICE_ACCOUNT: 'deploy@toca-production.iam.gserviceaccount.com',
    PRODUCTION_GCP_MCP_RUNTIME_SERVICE_ACCOUNT: 'mcp@toca-production.iam.gserviceaccount.com',
    PRODUCTION_GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT:
      'webhook@toca-production.iam.gserviceaccount.com',
    STAGING_DATABASE_ISOLATION_MODE: 'DEDICATED_CLOUD_SQL',
    STAGING_PROVIDER_MODE: 'DISABLED',
    META_ENABLED: 'false',
    META_WEBHOOK_ENABLED: 'false',
    INSTAGRAM_READ_ENABLED: 'false',
    META_ADS_READ_ENABLED: 'false',
    META_ADS_WRITE_ENABLED: 'false',
    WHATSAPP_ENABLED: 'false',
    WHATSAPP_RUNTIME_ENABLED: 'false',
    EMAIL_SENDGRID_ENABLED: 'false',
    AG01_MODEL_ENABLED: 'false',
    GOOGLE_ADS_PHASE: 'OFF',
  };
}

function run(env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [script], {
    env,
    encoding: 'utf8',
  });
}

function output(result: ReturnType<typeof run>): string {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

describe('staging GCP deploy environment isolation', () => {
  it('accepts a fully distinct staging coordinate set', () => {
    const result = run(stagingEnv());
    expect(result.status, output(result)).toBe(0);
    expect(output(result)).toContain('GCP_DEPLOY_ENVIRONMENT_VALIDATED=staging');
  });

  it('rejects a Cloud SQL instance name reused from production', () => {
    const env = stagingEnv();
    env.GCP_CLOUD_SQL_INSTANCE = env.PRODUCTION_GCP_CLOUD_SQL_INSTANCE;
    const result = run(env);
    expect(result.status).toBe(1);
    expect(output(result)).toContain('STAGING_PRODUCTION_COLLISION:GCP_CLOUD_SQL_INSTANCE_NAME');
  });

  it('rejects a Cloud Run service name reused from either production service', () => {
    const env = stagingEnv();
    env.GCP_CLOUD_RUN_MCP_SERVICE = env.PRODUCTION_GCP_CLOUD_RUN_WEBHOOK_SERVICE;
    const result = run(env);
    expect(result.status).toBe(1);
    expect(output(result)).toContain(
      'STAGING_PRODUCTION_COLLISION:MCP_SERVICE_NAME_VS_PRODUCTION_WEBHOOK',
    );
  });

  it('rejects a database secret id reused from production', () => {
    const env = stagingEnv();
    env.GCP_DATABASE_URL_SECRET = env.PRODUCTION_GCP_DATABASE_URL_SECRET;
    const result = run(env);
    expect(result.status).toBe(1);
    expect(output(result)).toContain('STAGING_PRODUCTION_COLLISION:GCP_DATABASE_URL_SECRET_ID');
  });
});
