import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy-gcp.yml', 'utf8');
const validator = 'scripts/validate-gcp-deploy-environment.mjs';

function productionEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith('GCP_') ||
      key.startsWith('PRODUCTION_GCP_') ||
      key.startsWith('META_') ||
      key.startsWith('WHATSAPP_') ||
      key.startsWith('EMAIL_SENDGRID_') ||
      key.startsWith('GOOGLE_ADS_') ||
      key.startsWith('AG01_MODEL_') ||
      key.startsWith('INSTAGRAM_READ_')
    ) {
      delete env[key];
    }
  }
  return {
    ...env,
    DEPLOY_ENVIRONMENT: 'production',
    GCP_PROJECT_ID: 'toca-mcp-production',
    GCP_PROJECT_NUMBER: '990081828836',
    GCP_REGION: 'southamerica-east1',
    GCP_ARTIFACT_REPOSITORY: 'toca-mcp',
    GCP_CLOUD_SQL_INSTANCE: 'toca-mcp-db',
    GCP_CLOUD_RUN_MCP_SERVICE: 'toca-mcp-production',
    GCP_CLOUD_RUN_WEBHOOK_SERVICE: 'toca-webhook-next-production',
    GCP_WORKLOAD_IDENTITY_PROVIDER:
      'projects/990081828836/locations/global/workloadIdentityPools/github/providers/github-toca-mcp',
    GCP_DEPLOY_SERVICE_ACCOUNT: 'toca-mcp-deployer@toca-mcp-production.iam.gserviceaccount.com',
    GCP_MCP_RUNTIME_SERVICE_ACCOUNT: 'toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com',
    GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT:
      'toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com',
    GCP_DATABASE_URL_SECRET: 'toca-database-url',
    GCP_DATABASE_URL_SECRET_VERSION: '1',
    GCP_META_ACCESS_TOKEN_SECRET: 'toca-meta-oauth-token',
    GCP_META_ACCESS_TOKEN_SECRET_VERSION: 'RESOLVE_RUNTIME',
    META_ENABLED: 'false',
    META_PROVIDER_VERIFIED: 'true',
    META_WEBHOOK_ENABLED: 'false',
    META_WEBHOOK_PERSISTENCE_ENABLED: 'false',
    INSTAGRAM_READ_ENABLED: 'false',
    META_ADS_READ_ENABLED: 'true',
    META_ADS_WRITE_ENABLED: 'false',
    WHATSAPP_ENABLED: 'false',
    WHATSAPP_PROVIDER_VERIFIED: 'false',
    EMAIL_SENDGRID_ENABLED: 'false',
    EMAIL_SENDGRID_PROVIDER_VERIFIED: 'false',
    GOOGLE_ADS_PHASE: 'OFF',
    GOOGLE_ADS_PROVIDER_VERIFIED: 'false',
    AG01_MODEL_ENABLED: 'false',
    AG01_MODEL_PROVIDER_VERIFIED: 'false',
  };
}

function runValidator(env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [validator], { env, encoding: 'utf8' });
}

function output(result: ReturnType<typeof runValidator>) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

describe('GCP production bootstrap contract', () => {
  it('accepts the exact canonical production coordinates and provider baseline', () => {
    const result = runValidator(productionEnv());
    expect(result.status, output(result)).toBe(0);
    expect(output(result)).toContain('GCP_DEPLOY_ENVIRONMENT_VALIDATED=production');
  });

  it('fails closed on production coordinate or deferred-provider drift', () => {
    const wrongProject = productionEnv();
    wrongProject.GCP_PROJECT_ID = 'wrong-project';
    const projectResult = runValidator(wrongProject);
    expect(projectResult.status).toBe(1);
    expect(output(projectResult)).toContain('PRODUCTION_CONFIG_ENV_MISMATCH:GCP_PROJECT_ID');

    const whatsappEnabled = productionEnv();
    whatsappEnabled.WHATSAPP_ENABLED = 'true';
    const providerResult = runValidator(whatsappEnabled);
    expect(providerResult.status).toBe(1);
    expect(output(providerResult)).toContain('PRODUCTION_PROVIDER_STATE_MISMATCH:WHATSAPP_ENABLED');
  });

  it('boots missing GitHub production variables from canonical non-secret fallbacks', () => {
    expect(workflow).toContain("inputs.environment == 'production' && 'toca-mcp-production'");
    expect(workflow).toContain("inputs.environment == 'production' && '990081828836'");
    expect(workflow).toContain(
      "inputs.environment == 'production' && 'toca-webhook-next-production'",
    );
    expect(workflow).toContain("inputs.environment == 'production' && 'toca-database-url'");
    expect(workflow).toContain("inputs.environment == 'production' && '1'");
    expect(workflow).toContain("inputs.environment == 'production' && 'toca-meta-oauth-token'");
  });

  it('requires an owner-authored open same-repository authorization with exact candidate markers', () => {
    const start = workflow.indexOf('Require exact production authorization before mutation');
    const end = workflow.indexOf('Fail closed on unverified provider activation', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const gate = workflow.slice(start, end);

    expect(gate).toContain('https://github.com/${GITHUB_REPOSITORY}/issues/');
    expect(gate).toContain('https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/${AUTH_ISSUE}');
    expect(gate).toContain('--arg owner "$GITHUB_REPOSITORY_OWNER"');
    expect(gate).toContain('(.user.login == $owner)');
    expect(gate).toContain('(.state == "open")');
    expect(gate).toContain('(has("pull_request") | not)');
    expect(gate).toContain('AUTHORIZED_CANDIDATE_SHA=');
    expect(gate).toContain('AUTHORIZATION_STATE=ACTIVE');
    expect(gate).toContain('production-authorization.json');
    expect(gate).toContain('exactShaMatched:true');
  });

  it('resolves the Meta token from one serving revision with immutable source evidence', () => {
    const start = workflow.indexOf('Resolve production Meta token to exact numeric secret version');
    const end = workflow.indexOf(
      'Require exact numeric production provider secret versions after resolution',
      start,
    );
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const resolver = workflow.slice(start, end);

    expect(resolver).toContain('--format=json');
    expect(resolver).toContain('/tmp/meta-resolver-service.json');
    expect(resolver).toContain(
      'https://run.googleapis.com/apis/serving.knative.dev/v1/namespaces/${GCP_PROJECT_ID}/revisions/${SERVING_REVISION}',
    );
    expect(resolver).toContain('/tmp/meta-resolver-revision-v1.json');
    expect(resolver).toContain(
      'Meta resolver could not identify exactly one 100%-serving MCP revision',
    );
    expect(resolver).toContain('.status.latestReadyRevisionName');
    expect(resolver).toContain('.status.imageDigest');
    expect(resolver).toContain('meta-resolver-source.json');
    expect(resolver).toContain('META_RESOLVER_SOURCE_REVISION=');
    expect(resolver).toContain('META_RESOLVER_CLEANUP=PASS');
    expect(resolver).toContain('META_SECRET_VERSION=');
    expect(resolver).toContain('GCP_META_ACCESS_TOKEN_SECRET_VERSION=$VERSION');
    expect(resolver).toContain('secretPayloadDisclosed:false');
    expect(resolver).toContain('providerCallExecuted:false');
    expect(resolver).not.toContain('gcloud run revisions describe "$SERVING_REVISION"');
    expect(resolver).not.toContain("--format='value(status.traffic[percent=100].revisionName)'");
    expect(resolver).not.toContain('test -n "$SERVING_REVISION"');
    expect(resolver).not.toContain('test -n "$CURRENT_IMAGE"');
    expect(workflow).toContain('Production Meta token must be pinned to a numeric version');
  });

  it('captures rollback targets with the same latestRevision fallback and requires an MCP target in production', () => {
    const start = workflow.indexOf('Capture known rollback targets');
    const end = workflow.indexOf('Deploy private MCP candidate by digest with no traffic', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const rollback = workflow.slice(start, end);

    expect(rollback).toContain('--format=json');
    expect(rollback).toContain('.latestRevision');
    expect(rollback).toContain('.status.latestReadyRevisionName');
    expect(rollback).toContain('Production deployment requires one serving MCP rollback revision');
    expect(rollback).not.toContain("--format='value(status.traffic[percent=100].revisionName)'");
  });

  it('scopes META_APP_ID to META_ENABLED instead of Meta Ads read-only mode', () => {
    const appIdIndex = workflow.indexOf('add_both META_APP_ID');
    const broadMetaIndex = workflow.indexOf(
      'if [[ "$META_ENABLED" == true || "$META_WEBHOOK_ENABLED"',
    );
    const dedicatedMetaIndex = workflow.lastIndexOf(
      'if [[ "$META_ENABLED" == true ]]; then',
      appIdIndex,
    );
    expect(dedicatedMetaIndex).toBeGreaterThan(-1);
    expect(appIdIndex).toBeGreaterThan(dedicatedMetaIndex);
    expect(appIdIndex).toBeLessThan(broadMetaIndex);
  });

  it('keeps Meta token binding scoped away from the public webhook in this release', () => {
    expect(workflow).toContain('MCP_RUNTIME_SECRETS=');
    expect(workflow).toContain('WEBHOOK_RUNTIME_SECRETS=');
    expect(workflow).toContain('require_mcp_secret TOCA_SECRET_META_ACCESS_TOKEN');
    expect(workflow).toContain('if [[ "$META_WEBHOOK_ENABLED" == true ]]');
    expect(workflow).toContain('--update-secrets "$MCP_RUNTIME_SECRETS"');
    expect(workflow).toContain('--update-secrets "$WEBHOOK_RUNTIME_SECRETS"');
    expect(workflow).not.toContain('--update-secrets "$RUNTIME_SECRETS"');
  });

  it('initializes evidence before Quality so early failures remain auditable', () => {
    const evidenceIndex = workflow.indexOf('Initialize immutable evidence package');
    const qualityIndex = workflow.indexOf('Install and run exact-head Quality');
    expect(evidenceIndex).toBeGreaterThan(-1);
    expect(qualityIndex).toBeGreaterThan(evidenceIndex);
    expect(workflow).toContain('platform-evidence/preflight.json');
  });
});
