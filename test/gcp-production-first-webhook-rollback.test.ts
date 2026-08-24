import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy-gcp.yml', 'utf8');

describe('GCP production first-webhook rollback contract', () => {
  it('records ABSENT as a supported explicit webhook rollback target', () => {
    expect(workflow).toContain('Known webhook revision, or ABSENT');
    expect(workflow).toContain('if [[ "$ROLLBACK_WEBHOOK_REVISION" == ABSENT ]]');
    expect(workflow).toContain('WEBHOOK_ROLLBACK_MODE=ABSENT_NO_DEFAULT_URL');
  });

  it('restores closed external exposure without deleting the webhook service', () => {
    expect(workflow).toContain(
      'gcloud run services update "$GCP_CLOUD_RUN_WEBHOOK_SERVICE"',
    );
    expect(workflow).toContain('--no-default-url');
    expect(workflow).not.toContain(
      'gcloud run services delete "$GCP_CLOUD_RUN_WEBHOOK_SERVICE"',
    );
  });

  it('re-enables the intended default URL on a subsequent webhook deploy', () => {
    expect(workflow).toContain('--default-url --allow-unauthenticated');
  });

  it('does not suppress MCP rollback just because no previous webhook revision exists', () => {
    expect(workflow).toContain(
      "if: failure() && inputs.operation == 'deploy' && env.PREVIOUS_MCP_REVISION != ''",
    );
    expect(workflow).not.toContain(
      "env.PREVIOUS_MCP_REVISION != '' && env.PREVIOUS_WEBHOOK_REVISION != ''",
    );
    expect(workflow).toContain(
      'WEBHOOK_AUTOMATIC_ROLLBACK_MODE=ABSENT_NO_DEFAULT_URL',
    );
  });

  it('fails closed instead of pretending a first-webhook canary split exists', () => {
    expect(workflow).toContain(
      'Production canary requires an existing serving webhook revision',
    );
  });
});
