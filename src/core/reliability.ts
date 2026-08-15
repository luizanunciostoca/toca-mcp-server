export const RELIABILITY_ALERT_SEVERITIES = ['P0', 'P1', 'P2'] as const;
export type ReliabilityAlertSeverity = (typeof RELIABILITY_ALERT_SEVERITIES)[number];

export interface ReliabilitySnapshot {
  readonly windowMinutes: number;
  readonly coreRequests: number;
  readonly coreFailures: number;
  readonly schedulerTicks: number;
  readonly schedulerFailures: number;
  readonly successfulExternalWrites: number;
  readonly verifiedExternalWrites: number;
  readonly outboxPending: number;
  readonly oldestOutboxAgeSeconds: number;
  readonly auditLedgerIntegrityValid: boolean;
  readonly latestBackupAgeHours: number | null;
  readonly pointInTimeRecoveryEnabled: boolean;
  readonly latestRestoreDrillAgeDays: number | null;
}

export interface ReliabilityObjectives {
  readonly coreAvailability: number;
  readonly schedulerSuccess: number;
  readonly maximumOldestOutboxAgeSeconds: number;
  readonly maximumBackupAgeHours: number;
  readonly maximumRestoreDrillAgeDays: number;
}

export interface ReliabilityAlert {
  readonly code: string;
  readonly severity: ReliabilityAlertSeverity;
  readonly summary: string;
  readonly evidence: readonly string[];
}

export interface SloAssessment {
  readonly name: 'core_availability' | 'scheduler_success';
  readonly target: number;
  readonly total: number;
  readonly failures: number;
  readonly achieved: number | null;
  readonly errorBudgetFractionConsumed: number | null;
  readonly met: boolean | null;
}

export interface ReliabilityAssessment {
  readonly slos: readonly SloAssessment[];
  readonly alerts: readonly ReliabilityAlert[];
  readonly healthy: boolean;
}

export const FOUNDATION_V1_RELIABILITY_OBJECTIVES: ReliabilityObjectives = Object.freeze({
  coreAvailability: 0.999,
  schedulerSuccess: 0.995,
  maximumOldestOutboxAgeSeconds: 300,
  maximumBackupAgeHours: 36,
  maximumRestoreDrillAgeDays: 90,
});

export function assessReliability(
  snapshot: ReliabilitySnapshot,
  objectives: ReliabilityObjectives = FOUNDATION_V1_RELIABILITY_OBJECTIVES,
): ReliabilityAssessment {
  validateSnapshot(snapshot);
  validateObjectives(objectives);

  const core = assessRatioSlo(
    'core_availability',
    snapshot.coreRequests,
    snapshot.coreFailures,
    objectives.coreAvailability,
  );
  const scheduler = assessRatioSlo(
    'scheduler_success',
    snapshot.schedulerTicks,
    snapshot.schedulerFailures,
    objectives.schedulerSuccess,
  );

  const alerts: ReliabilityAlert[] = [];

  if (!snapshot.auditLedgerIntegrityValid) {
    alerts.push({
      code: 'AUDIT_LEDGER_INTEGRITY_FAILED',
      severity: 'P0',
      summary: 'Audit Ledger integrity verification failed.',
      evidence: ['audit-ledger:integrity=false'],
    });
  }

  if (snapshot.verifiedExternalWrites < snapshot.successfulExternalWrites) {
    alerts.push({
      code: 'UNVERIFIED_EXTERNAL_WRITE_SUCCESS',
      severity: 'P0',
      summary: 'A terminal external write success exists without matching provider verification.',
      evidence: [
        `successful-writes:${snapshot.successfulExternalWrites}`,
        `verified-writes:${snapshot.verifiedExternalWrites}`,
      ],
    });
  }

  if (snapshot.oldestOutboxAgeSeconds > objectives.maximumOldestOutboxAgeSeconds) {
    alerts.push({
      code: 'OUTBOX_DELIVERY_STALLED',
      severity: 'P1',
      summary: 'The oldest pending Transactional Outbox event exceeded the delivery-age objective.',
      evidence: [
        `pending:${snapshot.outboxPending}`,
        `oldest-age-seconds:${snapshot.oldestOutboxAgeSeconds}`,
      ],
    });
  }

  if (snapshot.latestBackupAgeHours === null) {
    alerts.push({
      code: 'BACKUP_EVIDENCE_MISSING',
      severity: 'P1',
      summary: 'No recent successful Cloud SQL backup evidence is available.',
      evidence: ['backup-age-hours:unknown'],
    });
  } else if (snapshot.latestBackupAgeHours > objectives.maximumBackupAgeHours) {
    alerts.push({
      code: 'BACKUP_TOO_OLD',
      severity: 'P1',
      summary: 'The latest successful Cloud SQL backup is older than the recovery baseline.',
      evidence: [`backup-age-hours:${snapshot.latestBackupAgeHours}`],
    });
  }

  if (!snapshot.pointInTimeRecoveryEnabled) {
    alerts.push({
      code: 'PITR_DISABLED',
      severity: 'P0',
      summary: 'Cloud SQL point-in-time recovery is disabled.',
      evidence: ['pitr:false'],
    });
  }

  if (
    snapshot.latestRestoreDrillAgeDays === null ||
    snapshot.latestRestoreDrillAgeDays > objectives.maximumRestoreDrillAgeDays
  ) {
    alerts.push({
      code: 'RESTORE_DRILL_STALE',
      severity: 'P2',
      summary: 'Disaster-recovery restore evidence is missing or older than the drill objective.',
      evidence: [`restore-drill-age-days:${snapshot.latestRestoreDrillAgeDays ?? 'unknown'}`],
    });
  }

  pushSloAlert(alerts, core);
  pushSloAlert(alerts, scheduler);

  return {
    slos: [core, scheduler],
    alerts,
    healthy: alerts.every((alert) => alert.severity === 'P2'),
  };
}

function assessRatioSlo(
  name: SloAssessment['name'],
  total: number,
  failures: number,
  target: number,
): SloAssessment {
  if (total === 0) {
    return {
      name,
      target,
      total,
      failures,
      achieved: null,
      errorBudgetFractionConsumed: null,
      met: null,
    };
  }

  const achieved = (total - failures) / total;
  const permittedFailureRatio = 1 - target;
  const observedFailureRatio = failures / total;
  const errorBudgetFractionConsumed =
    permittedFailureRatio === 0
      ? observedFailureRatio === 0
        ? 0
        : Number.POSITIVE_INFINITY
      : observedFailureRatio / permittedFailureRatio;

  return {
    name,
    target,
    total,
    failures,
    achieved,
    errorBudgetFractionConsumed,
    met: achieved >= target,
  };
}

function pushSloAlert(alerts: ReliabilityAlert[], assessment: SloAssessment): void {
  if (assessment.met !== false || assessment.errorBudgetFractionConsumed === null) return;

  const severity: ReliabilityAlertSeverity =
    assessment.errorBudgetFractionConsumed >= 10 ? 'P0' : 'P1';
  alerts.push({
    code: `${assessment.name.toUpperCase()}_SLO_BREACH`,
    severity,
    summary: `${assessment.name} is below its Foundation v1 SLO target.`,
    evidence: [
      `achieved:${assessment.achieved}`,
      `target:${assessment.target}`,
      `error-budget-consumed:${assessment.errorBudgetFractionConsumed}`,
    ],
  });
}

function validateSnapshot(snapshot: ReliabilitySnapshot): void {
  requirePositiveInteger(snapshot.windowMinutes, 'RELIABILITY_WINDOW_INVALID');
  requireNonNegativeInteger(snapshot.coreRequests, 'RELIABILITY_CORE_REQUESTS_INVALID');
  requireNonNegativeInteger(snapshot.coreFailures, 'RELIABILITY_CORE_FAILURES_INVALID');
  requireNonNegativeInteger(snapshot.schedulerTicks, 'RELIABILITY_SCHEDULER_TICKS_INVALID');
  requireNonNegativeInteger(snapshot.schedulerFailures, 'RELIABILITY_SCHEDULER_FAILURES_INVALID');
  requireNonNegativeInteger(
    snapshot.successfulExternalWrites,
    'RELIABILITY_EXTERNAL_WRITES_INVALID',
  );
  requireNonNegativeInteger(snapshot.verifiedExternalWrites, 'RELIABILITY_VERIFIED_WRITES_INVALID');
  requireNonNegativeInteger(snapshot.outboxPending, 'RELIABILITY_OUTBOX_PENDING_INVALID');
  requireNonNegativeNumber(snapshot.oldestOutboxAgeSeconds, 'RELIABILITY_OUTBOX_AGE_INVALID');

  if (snapshot.coreFailures > snapshot.coreRequests)
    throw new Error('RELIABILITY_CORE_FAILURES_EXCEED_REQUESTS');
  if (snapshot.schedulerFailures > snapshot.schedulerTicks)
    throw new Error('RELIABILITY_SCHEDULER_FAILURES_EXCEED_TICKS');
  if (snapshot.verifiedExternalWrites > snapshot.successfulExternalWrites)
    throw new Error('RELIABILITY_VERIFIED_WRITES_EXCEED_SUCCESSES');

  if (snapshot.latestBackupAgeHours !== null)
    requireNonNegativeNumber(snapshot.latestBackupAgeHours, 'RELIABILITY_BACKUP_AGE_INVALID');
  if (snapshot.latestRestoreDrillAgeDays !== null)
    requireNonNegativeNumber(
      snapshot.latestRestoreDrillAgeDays,
      'RELIABILITY_RESTORE_DRILL_AGE_INVALID',
    );
}

function validateObjectives(objectives: ReliabilityObjectives): void {
  requireRatio(objectives.coreAvailability, 'RELIABILITY_CORE_SLO_INVALID');
  requireRatio(objectives.schedulerSuccess, 'RELIABILITY_SCHEDULER_SLO_INVALID');
  requirePositiveNumber(
    objectives.maximumOldestOutboxAgeSeconds,
    'RELIABILITY_OUTBOX_OBJECTIVE_INVALID',
  );
  requirePositiveNumber(objectives.maximumBackupAgeHours, 'RELIABILITY_BACKUP_OBJECTIVE_INVALID');
  requirePositiveNumber(
    objectives.maximumRestoreDrillAgeDays,
    'RELIABILITY_RESTORE_OBJECTIVE_INVALID',
  );
}

function requireRatio(value: number, errorCode: string): void {
  if (!Number.isFinite(value) || value <= 0 || value > 1) throw new Error(errorCode);
}

function requirePositiveInteger(value: number, errorCode: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(errorCode);
}

function requireNonNegativeInteger(value: number, errorCode: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(errorCode);
}

function requirePositiveNumber(value: number, errorCode: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(errorCode);
}

function requireNonNegativeNumber(value: number, errorCode: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(errorCode);
}
