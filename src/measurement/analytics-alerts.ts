import type { ExecutiveAnalyticsSnapshot } from './analytics-read-models.js';

export const ANALYTICS_ALERT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export type AnalyticsAlertSeverity = (typeof ANALYTICS_ALERT_SEVERITIES)[number];

export interface AnalyticsAlertPolicy {
  readonly minimumPublicationReliabilityRate: number;
  readonly maximumProviderFailureRate: number;
  readonly maximumAverageOpenOpportunityAgeDays: number;
  readonly minimumResponseSlaComplianceRate: number;
}

export interface AnalyticsAlert {
  readonly code:
    | 'CAPACITY_NEAR_LIMIT'
    | 'CAPACITY_SOLD_OUT'
    | 'OPERATIONAL_CONSTRAINT_BLOCKS_GROWTH'
    | 'PIPELINE_AGING_HIGH'
    | 'PUBLICATION_RELIABILITY_LOW'
    | 'PROVIDER_FAILURE_RATE_HIGH'
    | 'RESPONSE_SLA_LOW'
    | 'RESPONSE_SLA_SOURCE_UNAVAILABLE';
  readonly severity: AnalyticsAlertSeverity;
  readonly message: string;
  readonly evidence: readonly string[];
}

export function deriveAnalyticsAlerts(
  snapshot: ExecutiveAnalyticsSnapshot,
  policy: AnalyticsAlertPolicy,
): readonly AnalyticsAlert[] {
  validateAlertPolicy(policy);
  const alerts: AnalyticsAlert[] = [];

  if (snapshot.capacity.state === 'AVAILABLE' && snapshot.capacity.value !== null) {
    const capacity = snapshot.capacity.value;
    if (capacity.status === 'SOLD_OUT') {
      alerts.push({
        code: 'CAPACITY_SOLD_OUT',
        severity: 'CRITICAL',
        message: 'Event capacity is exhausted; positive demand growth must remain blocked.',
        evidence: capacity.evidence,
      });
    } else if (capacity.status === 'BLOCKED') {
      alerts.push({
        code: 'OPERATIONAL_CONSTRAINT_BLOCKS_GROWTH',
        severity: 'CRITICAL',
        message: 'An operational constraint blocks positive demand growth.',
        evidence: capacity.evidence,
      });
    } else if (capacity.status === 'NEAR_CAPACITY') {
      alerts.push({
        code: 'CAPACITY_NEAR_LIMIT',
        severity: 'WARNING',
        message: 'Event occupancy reached the configured near-capacity threshold.',
        evidence: capacity.evidence,
      });
    }
  }

  if (
    snapshot.averageOpenOpportunityAgeDays.state === 'AVAILABLE' &&
    snapshot.averageOpenOpportunityAgeDays.value !== null &&
    snapshot.averageOpenOpportunityAgeDays.value > policy.maximumAverageOpenOpportunityAgeDays
  ) {
    alerts.push({
      code: 'PIPELINE_AGING_HIGH',
      severity: 'WARNING',
      message: 'Average age of open opportunities exceeds the configured threshold.',
      evidence: snapshot.averageOpenOpportunityAgeDays.evidence,
    });
  }

  if (
    snapshot.publicationReliabilityRate.state === 'AVAILABLE' &&
    snapshot.publicationReliabilityRate.value !== null &&
    snapshot.publicationReliabilityRate.value < policy.minimumPublicationReliabilityRate
  ) {
    alerts.push({
      code: 'PUBLICATION_RELIABILITY_LOW',
      severity: 'CRITICAL',
      message: 'Publication reliability is below the configured threshold.',
      evidence: snapshot.publicationReliabilityRate.evidence,
    });
  }

  if (
    snapshot.providerFailureRate.state === 'AVAILABLE' &&
    snapshot.providerFailureRate.value !== null &&
    snapshot.providerFailureRate.value > policy.maximumProviderFailureRate
  ) {
    alerts.push({
      code: 'PROVIDER_FAILURE_RATE_HIGH',
      severity: 'CRITICAL',
      message: 'Provider failure rate exceeds the configured threshold.',
      evidence: snapshot.providerFailureRate.evidence,
    });
  }

  if (snapshot.responseSlaComplianceRate.state === 'UNAVAILABLE') {
    alerts.push({
      code: 'RESPONSE_SLA_SOURCE_UNAVAILABLE',
      severity: 'INFO',
      message:
        'Response SLA is unavailable until the canonical activity/message source is present.',
      evidence: snapshot.responseSlaComplianceRate.evidence,
    });
  } else if (
    snapshot.responseSlaComplianceRate.state === 'AVAILABLE' &&
    snapshot.responseSlaComplianceRate.value !== null &&
    snapshot.responseSlaComplianceRate.value < policy.minimumResponseSlaComplianceRate
  ) {
    alerts.push({
      code: 'RESPONSE_SLA_LOW',
      severity: 'WARNING',
      message: 'Response SLA compliance is below the configured threshold.',
      evidence: snapshot.responseSlaComplianceRate.evidence,
    });
  }

  return alerts.sort((left, right) => left.code.localeCompare(right.code));
}

export function validateAlertPolicy(policy: AnalyticsAlertPolicy): void {
  validateRatio(
    policy.minimumPublicationReliabilityRate,
    'ANALYTICS_PUBLICATION_THRESHOLD_INVALID',
  );
  validateRatio(policy.maximumProviderFailureRate, 'ANALYTICS_PROVIDER_FAILURE_THRESHOLD_INVALID');
  validateRatio(
    policy.minimumResponseSlaComplianceRate,
    'ANALYTICS_RESPONSE_SLA_THRESHOLD_INVALID',
  );
  if (
    !Number.isFinite(policy.maximumAverageOpenOpportunityAgeDays) ||
    policy.maximumAverageOpenOpportunityAgeDays < 0
  ) {
    throw new Error('ANALYTICS_PIPELINE_AGING_THRESHOLD_INVALID');
  }
}

function validateRatio(value: number, code: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(code);
}
