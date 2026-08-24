import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy-gcp.yml', 'utf8');

describe('GCP deploy Cloud Run probe contract', () => {
  it('does not pass unsupported readiness-probe to gcloud run deploy', () => {
    expect(workflow).not.toContain('--readiness-probe');
  });

  it('preserves startup and liveness probes for both services', () => {
    expect(workflow.match(/--startup-probe/g)).toHaveLength(2);
    expect(workflow.match(/--liveness-probe/g)).toHaveLength(2);
    expect(workflow).toContain("--startup-probe 'httpGet.path=/readyz");
    expect(workflow).toContain("--liveness-probe 'httpGet.path=/healthz");
  });

  it('keeps readiness as an explicit post-deploy fail-closed readback', () => {
    expect(workflow).toContain('Verify health readiness and webhook route confinement');
    expect(workflow).toContain('$MCP_URL/readyz');
    expect(workflow).toContain('$WEBHOOK_URL/readyz');
    expect(workflow).toContain('.status == "ready" and (.checks | all(.ok == true))');
  });
});
