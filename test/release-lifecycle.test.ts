import { describe, expect, it } from 'vitest';
import { RELEASE_LIFECYCLE, validateReleaseEvidence } from '../src/governance/release-lifecycle.js';
import { startStateMachine, transitionState } from '../src/governance/state-machine.js';

describe('R23 release, deployment and rollback', () => {
  it('forces rollback after a post-merge smoke failure', () => {
    let release = startStateMachine(RELEASE_LIFECYCLE);
    const sequence = [
      'BRANCH_CREATED',
      'IMPLEMENTED',
      'TESTS_PASSED',
      'ARCHITECTURE_PASSED',
      'QUALITY_GATE_PASSED',
      'PR_OPEN',
      'REVIEW_APPROVED',
      'MERGED',
      'DEPLOYED',
      'ROLLBACK_REQUIRED',
      'ROLLED_BACK',
      'ROLLBACK_VERIFIED',
    ] as const;
    for (const next of sequence)
      release = transitionState(RELEASE_LIFECYCLE, release, next, {
        correlationId: 'corr-release-1',
      });
    expect(release.state).toBe('ROLLBACK_VERIFIED');
  });

  it('requires release and rollback evidence before closure', () => {
    expect(() =>
      validateReleaseEvidence('DEPLOYED', {
        repository: 'luizidebook/toca-mcp-server',
        baseSha: 'base',
        headSha: 'head',
        branch: 'feat/routes-r21-r32',
        pullRequestUrl: 'https://github.com/luizidebook/toca-mcp-server/pull/1',
        qualityRunUrl: 'https://github.com/luizidebook/toca-mcp-server/actions/runs/1',
        deploymentId: null,
        smokeEvidence: [],
        providerEvidence: [],
        rollbackTargetSha: 'base',
        correlationId: 'corr-release-1',
      }),
    ).toThrow('RELEASE_DEPLOYMENT_EVIDENCE_REQUIRED');
  });
});
