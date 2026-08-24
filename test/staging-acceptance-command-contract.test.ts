import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflowPath = '.github/workflows/staging-acceptance-command.yml';

describe('staging acceptance command control-plane', () => {
  it('fails closed when any dispatched child workflow does not succeed', () => {
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain("ALLOWED_ACTOR: 'luizanunciostoca'");
    expect(workflow).toContain("EVIDENCE_ISSUE: '151'");
    expect(workflow).toContain('if [[ "$conclusion" != success ]]; then');
    expect(workflow).toContain('Child workflow ${workflow} failed with conclusion=${conclusion} run_id=${run_id}');
    expect(workflow).toContain('return 1');

    const syntheticDispatch = workflow.indexOf(
      'SYNTHETIC_RUN="$(dispatch_wait staging-synthetic-alert.yml',
    );
    const passMarker = workflow.indexOf('CANONICAL_CHAIN_PASS');
    expect(syntheticDispatch).toBeGreaterThan(-1);
    expect(passMarker).toBeGreaterThan(syntheticDispatch);
  });
});
