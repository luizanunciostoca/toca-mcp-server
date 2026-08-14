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
  readonly codePresence: CapabilityCheck;
  readonly runtimePresence: CapabilityCheck;
  readonly featureFlag: CapabilityCheck;
  readonly credentials: CapabilityCheck;
  readonly permissions: CapabilityCheck;
  readonly providerSupport: CapabilityCheck;
  readonly smokeTest: CapabilityCheck;
  readonly readback: CapabilityCheck;
}

export interface CapabilityValidationReport {
  readonly capabilityId: string;
  readonly previousStatus: CapabilityStatus;
  readonly recommendedStatus: CapabilityStatus;
  readonly event: 'UNCHANGED' | 'PROMOTE' | 'DEMOTE' | 'SUSPEND';
  readonly failedChecks: readonly (keyof CapabilityLifecycleEvidence)[];
  readonly unknownChecks: readonly (keyof CapabilityLifecycleEvidence)[];
  readonly evidence: readonly string[];
  readonly lastValidatedAt: string | null;
}

const orderedStatuses: readonly CapabilityStatus[] = [
  'PLANNED',
  'IMPLEMENTED',
  'CONNECTED',
  'PRODUCTION_VALIDATED',
];

const transitionMap: Readonly<Record<CapabilityStatus, readonly CapabilityStatus[]>> = {
  PLANNED: ['IMPLEMENTED', 'DEPRECATED', 'REMOVED'],
  IMPLEMENTED: ['PLANNED', 'CONNECTED', 'SUSPENDED', 'DEPRECATED', 'REMOVED'],
  CONNECTED: ['IMPLEMENTED', 'PRODUCTION_VALIDATED', 'SUSPENDED', 'DEPRECATED', 'REMOVED'],
  PRODUCTION_VALIDATED: ['SUSPENDED', 'DEPRECATED', 'REMOVED'],
  SUSPENDED: [
    'PLANNED',
    'IMPLEMENTED',
    'CONNECTED',
    'PRODUCTION_VALIDATED',
    'DEPRECATED',
    'REMOVED',
  ],
  DEPRECATED: ['SUSPENDED', 'REMOVED'],
  REMOVED: [],
};

export function validateCapabilityLifecycle(
  capabilityId: string,
  previousStatus: CapabilityStatus,
  checks: CapabilityLifecycleEvidence,
): CapabilityValidationReport {
  if (previousStatus === 'REMOVED' || previousStatus === 'DEPRECATED') {
    return report(capabilityId, previousStatus, previousStatus, checks);
  }

  const operationalChecks: readonly (keyof CapabilityLifecycleEvidence)[] = [
    'runtimePresence',
    'featureFlag',
    'credentials',
    'permissions',
    'providerSupport',
  ];
  const productionChecks: readonly (keyof CapabilityLifecycleEvidence)[] = [
    'smokeTest',
    'readback',
  ];
  const failedOperational = operationalChecks.some((name) => checks[name].result === 'FAIL');
  const failedProduction = productionChecks.some((name) => checks[name].result === 'FAIL');

  if (
    previousStatus === 'PRODUCTION_VALIDATED' &&
    (checks.codePresence.result === 'FAIL' || failedOperational || failedProduction)
  ) {
    return report(capabilityId, previousStatus, 'SUSPENDED', checks);
  }

  let eligibleStatus: CapabilityStatus = 'PLANNED';
  if (checks.codePresence.result === 'PASS') eligibleStatus = 'IMPLEMENTED';
  if (
    eligibleStatus === 'IMPLEMENTED' &&
    checks.runtimePresence.result === 'PASS' &&
    allSatisfied(checks, operationalChecks)
  )
    eligibleStatus = 'CONNECTED';
  if (eligibleStatus === 'CONNECTED' && allPassed(checks, productionChecks))
    eligibleStatus = 'PRODUCTION_VALIDATED';

  const recommendedStatus = nextValidatedStatus(previousStatus, eligibleStatus);

  return report(capabilityId, previousStatus, recommendedStatus, checks);
}

export function assertCapabilityLifecycleTransition(
  from: CapabilityStatus,
  to: CapabilityStatus,
): void {
  if (from === to) return;
  if (!transitionMap[from].includes(to))
    throw new Error(`CAPABILITY_TRANSITION_NOT_ALLOWED:${from}->${to}`);
}

export function promoteCapability(
  current: CapabilityStatus,
  report: CapabilityValidationReport,
): CapabilityStatus {
  if (report.previousStatus !== current) throw new Error('CAPABILITY_REPORT_STATUS_MISMATCH');
  assertCapabilityLifecycleTransition(current, report.recommendedStatus);
  return report.recommendedStatus;
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
  if (next === 'SUSPENDED') return 'SUSPEND';
  const previousIndex = orderedStatuses.indexOf(previous);
  const nextIndex = orderedStatuses.indexOf(next);
  return nextIndex > previousIndex ? 'PROMOTE' : 'DEMOTE';
}

function nextValidatedStatus(
  previous: CapabilityStatus,
  eligible: CapabilityStatus,
): CapabilityStatus {
  if (previous === 'SUSPENDED') return eligible;
  const previousIndex = orderedStatuses.indexOf(previous);
  const eligibleIndex = orderedStatuses.indexOf(eligible);
  if (previousIndex < 0 || eligibleIndex < 0) return eligible;
  if (eligibleIndex > previousIndex + 1) return orderedStatuses[previousIndex + 1]!;
  return eligible;
}
