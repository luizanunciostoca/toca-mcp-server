import type { StateMachineDefinition } from './state-machine.js';

export type ReleaseState =
  | 'CHANGE_REQUESTED'
  | 'BRANCH_CREATED'
  | 'IMPLEMENTED'
  | 'TESTS_PASSED'
  | 'ARCHITECTURE_PASSED'
  | 'QUALITY_GATE_PASSED'
  | 'PR_OPEN'
  | 'REVIEW_APPROVED'
  | 'MERGED'
  | 'DEPLOYED'
  | 'SMOKE_PASSED'
  | 'PROVIDER_VERIFIED'
  | 'RELEASE_EVIDENCE_RECORDED'
  | 'COMPLETED'
  | 'ROLLBACK_REQUIRED'
  | 'ROLLED_BACK'
  | 'ROLLBACK_VERIFIED'
  | 'FAILED';

export const RELEASE_LIFECYCLE: StateMachineDefinition<ReleaseState> = {
  id: 'R23_RELEASE_DEPLOYMENT_ROLLBACK',
  initialState: 'CHANGE_REQUESTED',
  terminalStates: ['COMPLETED', 'ROLLBACK_VERIFIED', 'FAILED'],
  transitions: {
    CHANGE_REQUESTED: ['BRANCH_CREATED', 'FAILED'],
    BRANCH_CREATED: ['IMPLEMENTED', 'FAILED'],
    IMPLEMENTED: ['TESTS_PASSED', 'FAILED'],
    TESTS_PASSED: ['ARCHITECTURE_PASSED', 'FAILED'],
    ARCHITECTURE_PASSED: ['QUALITY_GATE_PASSED', 'FAILED'],
    QUALITY_GATE_PASSED: ['PR_OPEN', 'FAILED'],
    PR_OPEN: ['REVIEW_APPROVED', 'FAILED'],
    REVIEW_APPROVED: ['MERGED', 'FAILED'],
    MERGED: ['DEPLOYED', 'ROLLBACK_REQUIRED'],
    DEPLOYED: ['SMOKE_PASSED', 'ROLLBACK_REQUIRED'],
    SMOKE_PASSED: ['PROVIDER_VERIFIED', 'ROLLBACK_REQUIRED'],
    PROVIDER_VERIFIED: ['RELEASE_EVIDENCE_RECORDED', 'ROLLBACK_REQUIRED'],
    RELEASE_EVIDENCE_RECORDED: ['COMPLETED', 'ROLLBACK_REQUIRED'],
    COMPLETED: [],
    ROLLBACK_REQUIRED: ['ROLLED_BACK'],
    ROLLED_BACK: ['ROLLBACK_VERIFIED'],
    ROLLBACK_VERIFIED: [],
    FAILED: [],
  },
};

export interface ReleaseEvidence {
  readonly repository: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly branch: string;
  readonly pullRequestUrl: string | null;
  readonly qualityRunUrl: string | null;
  readonly deploymentId: string | null;
  readonly smokeEvidence: readonly string[];
  readonly providerEvidence: readonly string[];
  readonly rollbackTargetSha: string;
  readonly correlationId: string;
}

export function validateReleaseEvidence(
  state: ReleaseState,
  evidence: ReleaseEvidence,
): void {
  if (!evidence.repository || !evidence.baseSha || !evidence.headSha || !evidence.branch)
    throw new Error('RELEASE_SOURCE_EVIDENCE_REQUIRED');
  if (!evidence.rollbackTargetSha) throw new Error('RELEASE_ROLLBACK_TARGET_REQUIRED');
  if (!evidence.correlationId) throw new Error('RELEASE_CORRELATION_REQUIRED');
  if (atOrAfter(state, 'PR_OPEN') && !evidence.pullRequestUrl)
    throw new Error('RELEASE_PR_EVIDENCE_REQUIRED');
  if (atOrAfter(state, 'QUALITY_GATE_PASSED') && !evidence.qualityRunUrl)
    throw new Error('RELEASE_QUALITY_EVIDENCE_REQUIRED');
  if (atOrAfter(state, 'DEPLOYED') && !evidence.deploymentId)
    throw new Error('RELEASE_DEPLOYMENT_EVIDENCE_REQUIRED');
  if (atOrAfter(state, 'SMOKE_PASSED') && evidence.smokeEvidence.length === 0)
    throw new Error('RELEASE_SMOKE_EVIDENCE_REQUIRED');
  if (atOrAfter(state, 'PROVIDER_VERIFIED') && evidence.providerEvidence.length === 0)
    throw new Error('RELEASE_PROVIDER_EVIDENCE_REQUIRED');
}

const orderedReleaseStates: readonly ReleaseState[] = [
  'CHANGE_REQUESTED',
  'BRANCH_CREATED',
  'IMPLEMENTED',
  'TESTS_PASSED',
  'ARCHITECTURE_PASSED',
  'QUALITY_GATE_PASSED',
  'PR_OPEN',
  'REVIEW_APPROVED',
  'MERGED',
  'DEPLOYED',
  'SMOKE_PASSED',
  'PROVIDER_VERIFIED',
  'RELEASE_EVIDENCE_RECORDED',
  'COMPLETED',
];

function atOrAfter(current: ReleaseState, checkpoint: ReleaseState): boolean {
  const currentIndex = orderedReleaseStates.indexOf(current);
  const checkpointIndex = orderedReleaseStates.indexOf(checkpoint);
  return currentIndex >= checkpointIndex && checkpointIndex >= 0;
}
