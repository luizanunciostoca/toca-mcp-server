import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/gcp-candidate-fast-probe.yml', 'utf8');
const target = JSON.parse(readFileSync('ops/gcp-fast-probe-target.json', 'utf8')) as {
  candidateSha: string;
  authorizationRef: string;
  environment: string;
  expectedMcpTag: string;
};

describe('GCP candidate fast probe contract', () => {
  it('is bounded to a short diagnostic-only production probe', () => {
    expect(workflow).toContain('timeout-minutes: 5');
    expect(workflow).toContain('NO_TRAFFIC_MUTATION=true');
    expect(workflow).toContain('NO_PROVIDER_CALLS=true');
    expect(workflow).toContain('NO_DATABASE_MUTATION=true');
    expect(workflow).not.toContain('gcloud run deploy');
    expect(workflow).not.toContain('docker build');
    expect(workflow).not.toContain('docker buildx');
    expect(workflow).not.toContain('gcloud sql backups create');
    expect(workflow).not.toContain('dist/scripts/migrate.js');
    expect(workflow).not.toContain('gcloud run services update-traffic');
    expect(workflow).not.toContain('--ingress all');
    expect(workflow).not.toContain('--allow-unauthenticated');
  });

  it('probes canonical and exact traffic-tagged run.app routes in one execution', () => {
    expect(workflow).toContain('MCP_TAG="production-mcp-${CANDIDATE_SHA:0:7}"');
    expect(workflow).toContain('"${MCP_CANONICAL_URL}/healthz"');
    expect(workflow).toContain('"${MCP_CANONICAL_URL}/readyz"');
    expect(workflow).toContain('"${MCP_TAGGED_URL}/healthz" "$MCP_CANONICAL_URL"');
    expect(workflow).toContain('"${MCP_TAGGED_URL}/readyz" "$MCP_CANONICAL_URL"');
    expect(workflow).toContain('"${MCP_TAGGED_URL}/healthz" "$MCP_TAGGED_URL"');
    expect(workflow).toContain('TAGGED_RUN_APP_ROUTE_REJECTED_BEFORE_CANDIDATE');
    expect(workflow).toContain('CANONICAL_INTERNAL_ROUTE_FAILURE');
  });

  it('diagnoses missing status.url instead of stopping before the HTTP matrix', () => {
    expect(workflow).toContain('MCP_STATUS_URL="$(jq -r');
    expect(workflow).toContain('CANONICAL_URL_SOURCE=status.url');
    expect(workflow).toContain('CANONICAL_URL_SOURCE=derived-from-tagged-url');
    expect(workflow).toContain('EXPECTED_PREFIX="https://${FAST_PROBE_MCP_TAG}---"');
    expect(workflow).toContain('MCP_DEFAULT_URL_DISABLED');
    expect(workflow).toContain('CLASSIFICATION=DEFAULT_RUN_APP_URL_DISABLED');
    expect(workflow).not.toContain("Canonical MCP URL missing");
    expect(workflow).not.toContain("Production MCP default run.app URL is disabled' >&2; exit 1");
  });

  it('requires exact candidate identity and private production posture', () => {
    expect(workflow).toContain('REVISION_RELEASE_SHA');
    expect(workflow).toContain('[[ "$REVISION_RELEASE_SHA" == "$FAST_PROBE_CANDIDATE" ]]');
    expect(workflow).toContain('[[ "$REVISION_READY" == True ]]');
    expect(workflow).toContain('internal|internal-and-cloud-load-balancing');
    expect(workflow).toContain('Production MCP exposes roles/run.invoker to allUsers');
  });

  it('cleans every ephemeral scheduler job and only a binding it created', () => {
    expect(workflow).toContain('trap cleanup EXIT');
    expect(workflow).toContain('gcloud scheduler jobs delete');
    expect(workflow).toContain('PROBE_BINDING_ADDED=false');
    expect(workflow).toContain('if [[ "$PROBE_BINDING_ADDED" == true ]]');
    expect(workflow).toContain('gcloud run services remove-iam-policy-binding');
    expect(workflow).toContain('trap - EXIT');
    expect(workflow).toContain('Fast probe cleanup left scheduler job behind');
    expect(workflow).toContain('Temporary fast-probe invoker binding remained after cleanup');
  });

  it('pins the initial diagnostic target to the current blocked candidate', () => {
    expect(target.environment).toBe('production');
    expect(target.candidateSha).toBe('b54f960a4b973bdf424ca6eeb7c1c24347a225f4');
    expect(target.expectedMcpTag).toBe('production-mcp-b54f960');
    expect(target.authorizationRef).toBe(
      'https://github.com/luizanunciostoca/toca-mcp-server/issues/262',
    );
  });
});
