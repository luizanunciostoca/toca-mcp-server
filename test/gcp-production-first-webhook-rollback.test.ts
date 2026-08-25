import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy-gcp.yml', 'utf8');

describe('GCP production first-webhook rollback contract', () => {
  it('records ABSENT as a supported explicit webhook rollback target', () => {
    expect(workflow).toContain('Known webhook revision, or ABSENT');
    expect(workflow).toContain('if [[ "$ROLLBACK_WEBHOOK_REVISION" == ABSENT ]]');
    expect(workflow).toContain('WEBHOOK_ROLLBACK_MODE=ABSENT_CLOSED');
  });

  it('closes external exposure when rolling back to an absent webhook target', () => {
    expect(workflow).toContain('gcloud run services update "$GCP_CLOUD_RUN_WEBHOOK_SERVICE"');
    expect(workflow).toContain('--no-default-url');
    expect(workflow).toContain('gcloud run services remove-iam-policy-binding');
    expect(workflow).toContain('--member=allUsers --role=roles/run.invoker');
  });

  it('re-enables the intended default URL and public auth mode on a subsequent webhook deploy', () => {
    expect(workflow).toContain('--default-url');
    expect(workflow).toContain('WEBHOOK_AUTH_ARGS=(--allow-unauthenticated)');
  });

  it('does not suppress MCP rollback just because no previous webhook revision exists', () => {
    expect(workflow).toContain(
      "if: failure() && inputs.operation == 'deploy' && env.PREVIOUS_MCP_REVISION != ''",
    );
    expect(workflow).not.toContain(
      "env.PREVIOUS_MCP_REVISION != '' && env.PREVIOUS_WEBHOOK_REVISION != ''",
    );
    expect(workflow).toContain('WEBHOOK_AUTOMATIC_ROLLBACK_MODE=ABSENT_CLOSED');
  });

  it('fails closed instead of pretending a first-webhook canary split exists', () => {
    expect(workflow).toContain('Production canary requires an existing serving webhook revision');
  });
});
