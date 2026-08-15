import type { CapabilityStatus } from '../core/tool-registry.js';

export const CAPABILITY_CHECK_RESULTS = ['PASS', 'FAIL', 'NOT_APPLICABLE', 'UNKNOWN'] as const;
export type CapabilityCheckResult = (typeof CAPABILITY_CHECK_RESULTS)[number];

export interface CapabilityCheck {
  readonly result: CapabilityCheckResult;
  readonly evidence: readonly string[];
  readonly checkedAt: string;
  readonly reason?: string;
}

export interface CapabilityLifecycleEvidence {
  readonly contractDefinition: CapabilityCheck;
  readonly codePresence: CapabilityCheck;
  readonly runtimePresence: CapabilityCheck;
  readonly featureFlag: CapabilityCheck;
  readonly credentials: CapabilityCheck;
  readonly permissions: CapabilityCheck;
  readonly providerSupport: CapabilityCheck;
  readonly integrationTest: CapabilityCheck;
  readonly smokeTest: CapabilityCheck;
  readonly readback: CapabilityCheck;
}

export interface CapabilityValidationReport {
  readonly capabilityId: string;
  readonly previousStatus: CapabilityStatus;
  readonly recommendedStatus: CapabilityStatus;
  readonly event:
    | 'UNCHANGED'
    | 'PROMOTE'
    | 'DEMOTE'
    | 'DEGRADE'
    | 'BLOCK'
    | 'DISABLE'
    | 'SUSPEND'
    | 'RETIRE';
  readonly failedChecks: readonly (keyof CapabilityLifecycleEvidence)[];
  readonly unknownChecks: readonly (keyof CapabilityLifecycleEvidence)[];
  readonly evidence: readonly string[];
  readonly lastValidatedAt: string | null;
}

const orderedStatuses: readonly CapabilityStatus[] = [
  'PLANNED',
  'SPECIFIED',
  'IMPLEMENTED',
  'CONNECTED',
  'INTEGRATION_VALIDATED',
  'PRODUCTION_VALIDATED',
];

const transitionMap: Readonly<Record<CapabilityStatus, readonly CapabilityStatus[]>> = {
  PLANNED: ['SPECIFIED', 'DEPRECATED', 'RETIRED', 'REMOVED'],
  SPECIFIED: ['PLANNED', 'IMPLEMENTED', 'BLOCKED', 'DEPRECATED', 'RETIRED', 'REMOVED'],
  IMPLEMENTED: [
    'SPECIFIED',
    'CONNECTED',
    'BLOCKED',
    'DISABLED',
    'SUSPENDED',
    'DEPRECATED',
    'RETIRED',
    'REMOVED',
  ],
  CONNECTED: [
    'IMPLEMENTED',
    'INTEGRATION_VALIDATED',
    'DEGRADED',
    'BLOCKED',
    'DISABLED',
    'SUSPENDED',
    'DEPRECATED',
    'RETIRED',
    'REMOVED',
  ],
  INTEGRATION_VALIDATED: [
    'CONNECTED',
    'PRODUCTION_VALIDATED',
    'DEGRADED',
    'BLOCKED',
    'DISABLED',
    'SUSPENDED',
    'DEPRECATED',
    'RETIRED',
    'REMOVED',
  ],
  PRODUCTION_VALIDATED: [
    'INTEGRATION_VALIDATED',
    'DEGRADED',
    'BLOCKED',
    'DISABLED',
    'SUSPENDED',
    'DEPRECATED',
    'RETIRED',
    'REMOVED',
  ],
  DEGRADED: [
    'SPECIFIED',
    'IMPLEMENTED',
    'CONNECTED',
    'INTEGRATION_VALIDATED',
    'PRODUCTION_VALIDATED',
    'BLOCKED',
    'DISABLED',
    'SUSPENDED',
    'DEPRECATED',
    'RETIRED',
    'REMOVED',
  ],
  DISABLED: [
    'SPECIFIED',
    'IMPLEMENTED',
    'CONNECTED',
    'INTEGRATION_VALIDATED',
    'PRODUCTION_VALIDATED',
    'BLOCKED',
    'SUSPENDED',
    'DEPRECATED',
    'RETIRED',
    'REMOVED',
  ],
  BLOCKED: [
    'PLANNED',
    'SPECIFIED',
    'IMPLEMENTED',
    'CONNECTED',
    'INTEGRATION_VALIDATED',
    'PRODUCTION_VALIDATED',
    'DISABLED',
    'SUSPENDED',
    'DEPRECATED',
    'RETIRED',
    'REMOVED',
  ],
  SUSPENDED: [
    'PLANNED',
    'SPECIFIED',
    'IMPLEMENTED',
    'CONNECTED',
    'INTEGRATION_VALIDATED',
    'PRODUCTION_VALIDATED',
    'BLOCKED',
    'DISABLED',
    'DEPRECATED',
    'RETIRED',
    'REMOVED',
  ],
  DEPRECATED: ['SUSPENDED', 'RETIRED', 'REMOVED'],
  RETIRED: ['REMOVED'],
  REMOVED: [],
};

export function validateCapabilityLifecycle(
  capabilityId: string,
  previousStatus: CapabilityStatus,
  checks: CapabilityLifecycleEvidence,
): CapabilityValidationReport {
  if (
    previousStatus === 'REMOVED' ||
    previousStatus === 'RETIRED' ||
    previousStatus === 'DEPRECATED' ||
    previousStatus === 'DISABLED'
  ) {
    return report(capabilityId, previousStatus, previousStatus, checks);
  }

  if (checks.contractDefinition.result === 'FAIL') {
    return report(capabilityId, previousStatus, 'BLOCKED', checks);
  }

  const operationalChecks: readonly (keyof CapabilityLifecycleEvidence)[] = [
    'runtimePresence',
    'featureFlag',
    'credentials',
    'permissions',
    'providerSupport',
  ];
  const failedOperational = operationalChecks.some((name) => checks[name].result === 'FAIL');
  const failedValidation = ['integrationTest', 'smokeTest', 'readback'].some(
    (name) => checks[name as keyof CapabilityLifecycleEvidence].result === 'FAIL',
  );

  if (
    ['CONNECTED', 'INTEGRATION_VALIDATED', 'PRODUCTION_VALIDATED', 'DEGRADED'].includes(
      previousStatus,
    ) &&
    checks.permissions.result === 'FAIL'
  ) {
    return report(capabilityId, previousStatus, 'BLOCKED', checks);
  }

  if (
    ['INTEGRATION_VALIDATED', 'PRODUCTION_VALIDATED', 'DEGRADED'].includes(previousStatus) &&
    (failedOperational || failedValidation)
  ) {
    return report(capabilityId, previousStatus, 'DEGRADED', checks);
  }

  if (previousStatus === 'PRODUCTION_VALIDATED' && checks.codePresence.result === 'FAIL') {
    return report(capabilityId, previousStatus, 'SUSPENDED', checks);
  }

  let eligibleStatus: CapabilityStatus = 'PLANNED';
  if (checks.contractDefinition.result === 'PASS') eligibleStatus = 'SPECIFIED';
  if (eligibleStatus === 'SPECIFIED' && checks.codePresence.result === 'PASS') {
    eligibleStatus = 'IMPLEMENTED';
  }
  if (
    eligibleStatus === 'IMPLEMENTED' &&
    checks.runtimePresence.result === 'PASS' &&
    allSatisfied(checks, operationalChecks)
  ) {
    eligibleStatus = 'CONNECTED';
  }
  if (eligibleStatus === 'CONNECTED' && checks.integrationTest.result === 'PASS') {
    eligibleStatus = 'INTEGRATION_VALIDATED';
  }
  if (
    eligibleStatus === 'INTEGRATION_VALIDATED' &&
    allPassed(checks, ['smokeTest', 'readback'])
  ) {
    eligibleStatus = 'PRODUCTION_VALIDATED';
  }

  const recommendedStatus = nextValidatedStatus(previousStatus, eligibleStatus);
  return report(capabilityId, previousStatus, recommendedStatus, checks);
}

export function assertCapabilityLifecycleTransition(
  from: CapabilityStatus,
  to: CapabilityStatus,
): void {
  if (from === to) return;
  if (!transitionMap[from].includes(to)) {
    throw new Error(`CAPABILITY_TRANSITION_NOT_ALLOWED:${from}->${to}`);
  }
}

export function promoteCapability(
  current: CapabilityStatus,
  reportValue: CapabilityValidationReport,
): CapabilityStatus {
  if (reportValue.previousStatus !== current) {
    throw new Error('CAPABILITY_REPORT_STATUS_MISMATCH');
  }
  assertCapabilityLifecycleTransition(current, reportValue.recommendedStatus);
  return reportValue.recommendedStatus;
}

function report(
  capabilityId: string,
  previousStatus: CapabilityStatus,
  recommendedStatus: CapabilityStatus,
  checks: CapabilityLifecycleEvidence,
): CapabilityValidationReport {
  const entries = Object.entries(checks) as [keyof CapabilityLifecycleEvidence, CapabilityCheck][];
  const failedChecks = entries.filter(([, check]) => check.result === 'FAIL').map(([name]) => name);
  const unknownChecks = entries
    .filter(([, check]) => check.result === 'UNKNOWN')
    .map(([name]) => name);
  const evidence = [...new Set(entries.flatMap(([, check]) => check.evidence))].sort();
  const event = lifecycleEvent(previousStatus, recommendedStatus);
  return {
    capabilityId,
    previousStatus,
    recommendedStatus,
    event,
    failedChecks,
    unknownChecks,
    evidence,
    lastValidatedAt:
      recommendedStatus === 'PRODUCTION_VALIDATED'
        ? (entries
            .map(([, check]) => check.checkedAt)
            .sort()
            .at(-1) ?? null)
        : null,
  };
}

function allSatisfied(
  checks: CapabilityLifecycleEvidence,
  names: readonly (keyof CapabilityLifecycleEvidence)[],
): boolean {
  return names.every((name) => ['PASS', 'NOT_APPLICABLE'].includes(checks[name].result));
}

function allPassed(
  checks: CapabilityLifecycleEvidence,
  names: readonly (keyof CapabilityLifecycleEvidence)[],
): boolean {
  return names.every((name) => checks[name].result === 'PASS');
}

function lifecycleEvent(
  previous: CapabilityStatus,
  next: CapabilityStatus,
): CapabilityValidationReport['event'] {
  if (previous === next) return 'UNCHANGED';
  if (next === 'DEGRADED') return 'DEGRADE';
  if (next === 'BLOCKED') return 'BLOCK';
  if (next === 'DISABLED') return 'DISABLE';
  if (next === 'SUSPENDED') return 'SUSPEND';
  if (next === 'RETIRED' || next === 'REMOVED') return 'RETIRE';
  const previousIndex = orderedStatuses.indexOf(previous);
  const nextIndex = orderedStatuses.indexOf(next);
  return nextIndex > previousIndex ? 'PROMOTE' : 'DEMOTE';
}

function nextValidatedStatus(
  previous: CapabilityStatus,
  eligible: CapabilityStatus,
): CapabilityStatus {
  if (['SUSPENDED', 'BLOCKED', 'DEGRADED'].includes(previous)) return eligible;
  const previousIndex = orderedStatuses.indexOf(previous);
  const eligibleIndex = orderedStatuses.indexOf(eligible);
  if (previousIndex < 0 || eligibleIndex < 0) return eligible;
  if (eligibleIndex > previousIndex + 1) return orderedStatuses[previousIndex + 1]!;
  return eligible;
}
