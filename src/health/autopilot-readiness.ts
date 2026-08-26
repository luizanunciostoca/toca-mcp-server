import {
  AUTOPILOT_READINESS_CHECKS,
  type AutopilotReadinessCheckName,
  type CompiledAutonomyPolicy,
  loadEffectiveAutonomyPolicy,
} from '../governance/autonomy-policy.js';

export const AUTOPILOT_READINESS_STATUSES = ['PASS', 'FAIL', 'UNKNOWN'] as const;
export type AutopilotReadinessStatus = (typeof AUTOPILOT_READINESS_STATUSES)[number];

export interface AutopilotReadinessCheck {
  readonly name: AutopilotReadinessCheckName;
  readonly status: AutopilotReadinessStatus;
  readonly evidence: readonly string[];
  readonly reasonCode?: string;
  readonly checkedAt: string;
}

export interface AutopilotReadinessResult {
  readonly ready: boolean;
  readonly policyVersion: string;
  readonly evaluatedAt: string;
  readonly checks: readonly AutopilotReadinessCheck[];
  readonly failedChecks: readonly AutopilotReadinessCheckName[];
  readonly unknownChecks: readonly AutopilotReadinessCheckName[];
  readonly evidence: readonly string[];
}

export function evaluateAutopilotReadiness(
  checks: readonly AutopilotReadinessCheck[],
  options: {
    readonly now?: string;
    readonly policy?: CompiledAutonomyPolicy;
  } = {},
): AutopilotReadinessResult {
  const policy = options.policy ?? loadEffectiveAutonomyPolicy();
  const evaluatedAt = options.now ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(evaluatedAt))) {
    throw new Error('AUTOPILOT_READINESS_EVALUATED_AT_INVALID');
  }

  const byName = new Map<AutopilotReadinessCheckName, AutopilotReadinessCheck>();
  for (const check of checks) {
    if (byName.has(check.name)) {
      throw new Error(`AUTOPILOT_READINESS_CHECK_DUPLICATE:${check.name}`);
    }
    assertReadinessCheck(check, evaluatedAt);
    byName.set(check.name, {
      ...check,
      evidence: normalizeEvidence(check.evidence),
    });
  }

  const normalized = policy.policy.readinessRequiredChecks.map(
    (name): AutopilotReadinessCheck =>
      byName.get(name) ?? {
        name,
        status: 'UNKNOWN',
        evidence: [],
        reasonCode: 'READINESS_CHECK_MISSING',
        checkedAt: evaluatedAt,
      },
  );
  const failedChecks = normalized
    .filter((check) => check.status === 'FAIL')
    .map((check) => check.name);
  const unknownChecks = normalized
    .filter((check) => check.status === 'UNKNOWN')
    .map((check) => check.name);

  return {
    ready: failedChecks.length === 0 && unknownChecks.length === 0,
    policyVersion: policy.policy.policyVersion,
    evaluatedAt,
    checks: normalized,
    failedChecks,
    unknownChecks,
    evidence: normalizeEvidence(normalized.flatMap((check) => check.evidence)),
  };
}

export function readinessChecksFromRecord(
  values: Readonly<
    Partial<
      Record<
        AutopilotReadinessCheckName,
        Omit<AutopilotReadinessCheck, 'name' | 'checkedAt'> & { readonly checkedAt?: string }
      >
    >
  >,
  now = new Date().toISOString(),
): readonly AutopilotReadinessCheck[] {
  return AUTOPILOT_READINESS_CHECKS.flatMap((name) => {
    const value = values[name];
    if (!value) return [];
    return [
      {
        name,
        status: value.status,
        evidence: value.evidence,
        ...(value.reasonCode ? { reasonCode: value.reasonCode } : {}),
        checkedAt: value.checkedAt ?? now,
      },
    ];
  });
}

export function assertExternalAutopilotReady(result: AutopilotReadinessResult): void {
  if (result.ready) return;
  if (result.failedChecks.length > 0) {
    throw new Error(`AUTOPILOT_NOT_READY_FAILED:${result.failedChecks.join(',')}`);
  }
  throw new Error(`AUTOPILOT_NOT_READY_UNKNOWN:${result.unknownChecks.join(',')}`);
}

function assertReadinessCheck(check: AutopilotReadinessCheck, evaluatedAt: string): void {
  if (!AUTOPILOT_READINESS_CHECKS.includes(check.name)) {
    throw new Error(`AUTOPILOT_READINESS_CHECK_UNKNOWN:${check.name}`);
  }
  if (!AUTOPILOT_READINESS_STATUSES.includes(check.status)) {
    throw new Error(`AUTOPILOT_READINESS_STATUS_INVALID:${check.name}`);
  }
  if (!Number.isFinite(Date.parse(check.checkedAt))) {
    throw new Error(`AUTOPILOT_READINESS_CHECKED_AT_INVALID:${check.name}`);
  }
  if (Date.parse(check.checkedAt) > Date.parse(evaluatedAt)) {
    throw new Error(`AUTOPILOT_READINESS_FROM_FUTURE:${check.name}`);
  }
  if (check.status === 'PASS' && normalizeEvidence(check.evidence).length === 0) {
    throw new Error(`AUTOPILOT_READINESS_PASS_EVIDENCE_REQUIRED:${check.name}`);
  }
  if (check.status !== 'PASS' && !check.reasonCode?.trim()) {
    throw new Error(`AUTOPILOT_READINESS_REASON_REQUIRED:${check.name}`);
  }
}

function normalizeEvidence(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}
