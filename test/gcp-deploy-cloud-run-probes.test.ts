import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy-gcp.yml', 'utf8');

describe('GCP deploy Cloud Run probe contract', () => {
  it('does not pass unsupported readiness-probe to gcloud run deploy', () => {
    expect(workflow).not.toContain('--readiness-probe');
  });

  it('preserves startup and liveness probes for both canonical services and ephemeral acceptance', () => {
    expect(workflow.match(/--startup-probe/g)).toHaveLength(3);
    expect(workflow.match(/--liveness-probe/g)).toHaveLength(3);
    expect(workflow).toContain("--startup-probe 'httpGet.path=/healthz");
    expect(workflow).toContain("--startup-probe 'httpGet.path=/readyz");
    expect(workflow).toContain("--liveness-probe 'httpGet.path=/healthz");
    expect(workflow).toContain('gcloud run deploy "$PROBE_SERVICE" --image "$IMAGE"');
  });

  it('keeps readiness fail-closed for staging, webhook, and production acceptance', () => {
    expect(workflow).toContain('Verify health readiness and webhook route confinement');
    expect(workflow).toContain('$MCP_URL/readyz');
    expect(workflow).toContain('$WEBHOOK_URL/readyz');
    expect(workflow).toContain('PROBE_STARTUP_PATH=');
    expect(workflow).toContain('[[ "$PROBE_STARTUP_PATH" == /readyz ]]');
    expect(workflow).toContain('[[ "$CANDIDATE_READY" == True && "$PROBE_READY" == True ]]');
    expect(workflow).toContain('.status == "ready" and (.checks | all(.ok == true))');
    expect(workflow).not.toContain('${PROBE_URL}/readyz');
  });
});
