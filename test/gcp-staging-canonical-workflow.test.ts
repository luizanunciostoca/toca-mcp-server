import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflowPath = '.github/workflows/deploy-gcp-staging-canonical.yml';
const configPath = 'infra/environments/staging.json';
const workflow = readFileSync(workflowPath, 'utf8');
const runtimeWorkflow = readFileSync('.github/workflows/staging-runtime-observability.yml', 'utf8');
const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;

describe('canonical isolated staging deployment workflow', () => {
  it('keeps Quality outside the staging deployment environment', () => {
    const qualityStart = workflow.indexOf('  quality:\n');
    const deployStart = workflow.indexOf('  deploy:\n');
    const cleanQuality = workflow.indexOf('Exact-head Quality in clean non-deployment environment');
    const stagingEnvironment = workflow.indexOf('    environment: staging', deployStart);

    expect(qualityStart).toBeGreaterThanOrEqual(0);
    expect(deployStart).toBeGreaterThan(qualityStart);
    expect(cleanQuality).toBeGreaterThan(qualityStart);
    expect(cleanQuality).toBeLessThan(deployStart);
    expect(stagingEnvironment).toBeGreaterThan(deployStart);
    expect(workflow.slice(qualityStart, deployStart)).not.toContain('environment: staging');
    expect(workflow).toContain('    needs: quality');
  });

  it('loads canonical repository coordinates only after Quality', () => {
    const qualityStep = workflow.indexOf('Exact-head Quality in clean non-deployment environment');
    const loadStep = workflow.indexOf('Load repository-canonical staging coordinates');

    expect(loadStep).toBeGreaterThan(qualityStep);
    expect(workflow).toContain(
      'node scripts/export-staging-deploy-config.mjs infra/environments/staging.json',
    );
    expect(workflow).toContain('node scripts/validate-gcp-deploy-environment.mjs');
    expect(workflow).toContain('steps.config.outputs.wif');
    expect(workflow).toContain('steps.config.outputs.deployer_sa');
  });

  it('uses an attestation-capable BuildKit builder without dropping provenance or SBOM', () => {
    const setupBuildx = workflow.indexOf('Setup Docker Buildx for attestations');
    const build = workflow.indexOf('Build push and resolve immutable candidate digest');

    expect(setupBuildx).toBeGreaterThanOrEqual(0);
    expect(build).toBeGreaterThan(setupBuildx);
    expect(workflow).toContain(
      'docker/setup-buildx-action@bb05f3f5519dd87d3ba754cc423b652a5edd6d2c',
    );
    expect(workflow).toContain('driver: docker-container');
    expect(workflow).toContain('--provenance=mode=max');
    expect(workflow).toContain('--sbom=true');
  });

  it('has no production coordinate dependency or provider activation', () => {
    expect(workflow).not.toContain('PRODUCTION_GCP_');
    expect(workflow).not.toContain('toca-mcp-production');
    expect(workflow).toContain('"META_ENABLED=false"');
    expect(workflow).toContain('"WHATSAPP_ENABLED=false"');
    expect(workflow).toContain('"EMAIL_SENDGRID_ENABLED=false"');
    expect(workflow).toContain('"GOOGLE_ADS_PHASE=OFF"');
    expect(workflow).toContain('"AG01_MODEL_ENABLED=false"');
  });

  it('binds the database through Secret Manager references and never embeds a payload', () => {
    expect(workflow).toContain(
      'RUNTIME_SECRETS=DATABASE_URL=${GCP_DATABASE_URL_SECRET}:${GCP_DATABASE_URL_SECRET_VERSION}',
    );
    expect(workflow).toContain('gcloud secrets versions access "$GCP_DATABASE_URL_SECRET_VERSION"');
    expect(workflow.toLowerCase()).not.toContain('postgresql://');

    expect(config.secretReferences).toEqual({
      databaseUrl: {
        id: 'toca-next-staging-database-url',
        version: 'latest',
      },
    });
  });

  it('does not use unsupported Cloud Run readiness-probe and keeps readiness fail-closed', () => {
    expect(workflow).not.toContain('--readiness-probe');
    expect(workflow).toContain("--startup-probe 'httpGet.path=/readyz");
    expect(workflow).toContain(
      'Verify candidate health readiness and public route confinement before traffic',
    );
    expect(workflow).toContain('$MCP_URL/readyz');
    expect(workflow).toContain('$WEBHOOK_URL/readyz');
    expect(workflow).toContain('.status == "ready" and (.checks | all(.ok == true))');
  });

  it('keeps the webhook traffic tag within the Cloud Run combined 46-character limit', () => {
    const webhookService = 'toca-webhook-next-staging';
    const webhookTag = 'wh-abcdef0';

    expect(webhookService.length + webhookTag.length).toBeLessThanOrEqual(46);
    expect(workflow).toContain('WEBHOOK_TAG=wh-${GITHUB_SHA::7}');
    expect(workflow).not.toContain('WEBHOOK_TAG=staging-webhook-${GITHUB_SHA::7}');
  });

  it('waits boundedly for tagged revision propagation and validates the exact revisions', () => {
    expect(workflow).toContain('for attempt in $(seq 1 24); do');
    expect(workflow).toContain('select(.tag == $tag)');
    expect(workflow).toContain('sleep 5');
    expect(workflow).toContain('Timed out resolving Cloud Run traffic tag');
    expect(workflow).toContain('EXPECTED_MCP_REVISION=');
    expect(workflow).toContain('EXPECTED_WEBHOOK_REVISION=');
    expect(workflow).toContain('test "$MCP_REVISION" = "$EXPECTED_MCP_REVISION"');
    expect(workflow).toContain('test "$WEBHOOK_REVISION" = "$EXPECTED_WEBHOOK_REVISION"');
  });

  it('mints Cloud Run ID tokens through pinned staging WIF actions instead of gcloud external-account audiences', () => {
    expect(workflow).not.toContain('gcloud auth print-identity-token');
    expect(workflow).toContain('id: mcp_probe_auth');
    expect(workflow).toContain('token_format: id_token');
    expect(workflow).toContain('echo "mcp_tag_url=$MCP_URL" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain('echo "mcp_service_url=$MCP_SERVICE_URL" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain('id_token_audience: ${{ steps.candidate.outputs.mcp_service_url }}');
    expect(workflow).not.toContain('id_token_audience: ${{ steps.candidate.outputs.mcp_url }}');
    expect(workflow).toContain('create_credentials_file: false');
    expect(workflow).toContain('export_environment_variables: false');
    expect(runtimeWorkflow).not.toContain('gcloud auth print-identity-token');
    expect(runtimeWorkflow).toContain('id: mcp_probe_auth');
    expect(runtimeWorkflow).toContain('id: webhook_probe_auth');
    expect(runtimeWorkflow).toContain('id: capacity_auth');
    expect(runtimeWorkflow).toContain('id_token_audience: ${{ steps.runtime.outputs.mcp_url }}');
    expect(runtimeWorkflow).toContain(
      'id_token_audience: ${{ steps.runtime.outputs.webhook_url }}',
    );
  });

  it('uses the canonical Cloud Run service URL as token audience while probing the tagged candidate URL', () => {
    expect(workflow).toContain(
      'MCP_SERVICE_URL="$(gcloud run services describe "$GCP_CLOUD_RUN_MCP_SERVICE"',
    );
    expect(workflow).toContain('test "$MCP_SERVICE_URL" != "$MCP_URL"');
    expect(workflow).toContain('-H "Authorization: Bearer $MCP_TOKEN" "$MCP_URL/healthz"');
    expect(workflow).toContain('-H "Authorization: Bearer $MCP_TOKEN" "$MCP_URL/readyz"');
  });

  it('requires exact frozen candidate, immutable digest, readiness before promotion and final readback', () => {
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$CANDIDATE_SHA"');
    expect(workflow).toContain('[[ "$IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]');
    expect(workflow).toContain(
      'Verify candidate health readiness and public route confinement before traffic',
    );
    expect(workflow).toContain('Promote verified candidate to full staging traffic');
    expect(workflow).toContain('Read back exact final staging runtime');
    expect(workflow).toContain('.revisionName == $revision');
    expect(workflow).toContain(
      'Automatic staging traffic rollback after failed post-promotion step',
    );
  });
});
