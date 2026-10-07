import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy-gcp.yml', 'utf8');

describe('Deploy GCP Next staging recovery configuration binding', () => {
  it('loads canonical staging coordinates before environment validation', () => {
    const load = workflow.indexOf(
      'Load repository-canonical staging coordinates for governed recovery',
    );
    const validate = workflow.indexOf('Prove environment isolation before any GCP access');

    expect(load).toBeGreaterThan(-1);
    expect(validate).toBeGreaterThan(load);

    const block = workflow.slice(load, validate);
    expect(block).toContain("if: inputs.environment == 'staging'");
    expect(block).toContain(
      'node scripts/export-staging-deploy-config.mjs infra/environments/staging.json',
    );
    expect(block).toContain('cat /tmp/staging-recovery.env >> "$GITHUB_ENV"');
    expect(block).toContain('source /tmp/staging-recovery.env');
    expect(block).toContain('test "$GCP_PROJECT_ID" = toca-mcp-next-staging');
    expect(block).toContain('test "$GCP_PROJECT_NUMBER" = 729069789107');
    expect(block).toContain('test "$STAGING_DATABASE_ISOLATION_MODE" = DEDICATED_CLOUD_SQL');
    expect(block).toContain('test "$STAGING_PROVIDER_MODE" = DISABLED');
  });

  it('authenticates staging with exporter outputs and keeps production auth separate', () => {
    const staging = workflow.indexOf('Authenticate isolated staging WIF from canonical config');
    const production = workflow.indexOf('Authenticate production WIF from production coordinates');
    const setupGcloud = workflow.indexOf('Setup gcloud', staging);

    expect(staging).toBeGreaterThan(-1);
    expect(production).toBeGreaterThan(staging);
    expect(setupGcloud).toBeGreaterThan(production);

    const stagingAuth = workflow.slice(staging, production);
    expect(stagingAuth).toContain("if: inputs.environment == 'staging'");
    expect(stagingAuth).toContain('${{ steps.staging_config.outputs.wif }}');
    expect(stagingAuth).toContain('${{ steps.staging_config.outputs.deployer_sa }}');
    expect(stagingAuth).not.toContain('env.GCP_WORKLOAD_IDENTITY_PROVIDER');

    const productionAuth = workflow.slice(production, setupGcloud);
    expect(productionAuth).toContain("if: inputs.environment == 'production'");
    expect(productionAuth).toContain('${{ env.GCP_WORKLOAD_IDENTITY_PROVIDER }}');
    expect(productionAuth).toContain('${{ env.GCP_DEPLOY_SERVICE_ACCOUNT }}');
  });

  it('does not enable providers while importing canonical staging config', () => {
    const load = workflow.indexOf(
      'Load repository-canonical staging coordinates for governed recovery',
    );
    const validate = workflow.indexOf('Prove environment isolation before any GCP access');
    const block = workflow.slice(load, validate);

    expect(block).toContain('STAGING_PROVIDER_MODE');
    expect(block).not.toContain('META_ENABLED=true');
    expect(block).not.toContain('WHATSAPP_ENABLED=true');
    expect(block).not.toContain('EMAIL_SENDGRID_ENABLED=true');
    expect(block).not.toContain('GOOGLE_ADS_PHASE=ACTIVE');
  });
});
