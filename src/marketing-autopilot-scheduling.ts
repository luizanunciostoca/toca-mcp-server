export type SchedulingState =
  | 'READY_FOR_SCHEDULING'
  | 'TOCA_SCHEDULED'
  | 'READY_FOR_NATIVE_SCHEDULING'
  | 'SCHEDULED'
  | 'PUBLISHED';

export type SchedulingPolicy =
  'TOCA_MANAGED_SCHEDULING' | 'NATIVE_PROVIDER_SCHEDULING' | 'SHARE_NOW';

export type PublicationIntent = 'TOCA_SCHEDULE' | 'NATIVE_SCHEDULE' | 'SHARE_NOW';

export interface ProviderScheduleEvidence {
  providerScheduleId: string;
  providerScheduledAt: string;
  providerStatus: string;
}

export interface TocaManagedScheduleEvidence {
  jobId: string;
  descriptorSha256: string;
  scheduledFor: string;
  schedulerStatus: 'TOCA_SCHEDULED';
}

export type SchedulingEvidence = ProviderScheduleEvidence | TocaManagedScheduleEvidence;

export function assertProviderScheduleEvidence(evidence: ProviderScheduleEvidence): void {
  if (!evidence.providerScheduleId.trim()) throw new Error('PROVIDER_SCHEDULE_ID_REQUIRED');
  if (!Number.isFinite(Date.parse(evidence.providerScheduledAt))) {
    throw new Error('INVALID_PROVIDER_SCHEDULE_TIMESTAMP');
  }
  if (evidence.providerStatus !== 'SCHEDULED') {
    throw new Error('PROVIDER_SCHEDULE_STATUS_NOT_CONFIRMED');
  }
}

export function assertTocaManagedScheduleEvidence(evidence: TocaManagedScheduleEvidence): void {
  if (!evidence.jobId.trim()) throw new Error('TOCA_SCHEDULE_JOB_ID_REQUIRED');
  if (!/^[a-f0-9]{64}$/.test(evidence.descriptorSha256)) {
    throw new Error('TOCA_SCHEDULE_DESCRIPTOR_SHA256_INVALID');
  }
  if (!Number.isFinite(Date.parse(evidence.scheduledFor))) {
    throw new Error('TOCA_SCHEDULE_TIMESTAMP_INVALID');
  }
  if (evidence.schedulerStatus !== 'TOCA_SCHEDULED') {
    throw new Error('TOCA_SCHEDULE_STATUS_NOT_CONFIRMED');
  }
}

export function assertScheduledStateClaim(
  state: SchedulingState,
  evidence?: SchedulingEvidence,
): void {
  if (state === 'SCHEDULED') {
    if (!evidence || !isProviderScheduleEvidence(evidence)) {
      throw new Error('PROVIDER_SCHEDULE_EVIDENCE_REQUIRED');
    }
    assertProviderScheduleEvidence(evidence);
    return;
  }
  if (state === 'TOCA_SCHEDULED') {
    if (!evidence || !isTocaManagedScheduleEvidence(evidence)) {
      throw new Error('TOCA_SCHEDULE_EVIDENCE_REQUIRED');
    }
    assertTocaManagedScheduleEvidence(evidence);
  }
}

export function assertSchedulingPolicyAllowsIntent(
  policy: SchedulingPolicy,
  intent: PublicationIntent,
): void {
  if (policy === 'TOCA_MANAGED_SCHEDULING' && intent !== 'TOCA_SCHEDULE') {
    throw new Error('TOCA_MANAGED_SCHEDULING_POLICY_DENIED');
  }
  if (policy === 'NATIVE_PROVIDER_SCHEDULING' && intent !== 'NATIVE_SCHEDULE') {
    throw new Error('NATIVE_PROVIDER_SCHEDULING_POLICY_DENIED');
  }
  if (policy === 'SHARE_NOW' && intent !== 'SHARE_NOW') {
    throw new Error('SHARE_NOW_POLICY_DENIED');
  }
}

export function deriveSchedulingDisposition(input: {
  policy: SchedulingPolicy;
  tocaManagedSchedulerAvailable: boolean;
  providerNativeApiAvailable: boolean;
  managedEvidence?: TocaManagedScheduleEvidence;
  providerEvidence?: ProviderScheduleEvidence;
}): SchedulingState {
  if (input.providerEvidence) {
    assertProviderScheduleEvidence(input.providerEvidence);
    return 'SCHEDULED';
  }
  if (input.managedEvidence) {
    assertTocaManagedScheduleEvidence(input.managedEvidence);
    return 'TOCA_SCHEDULED';
  }
  if (input.policy === 'TOCA_MANAGED_SCHEDULING') {
    if (!input.tocaManagedSchedulerAvailable) throw new Error('TOCA_MANAGED_SCHEDULER_UNAVAILABLE');
    return 'READY_FOR_SCHEDULING';
  }
  if (input.policy === 'NATIVE_PROVIDER_SCHEDULING') {
    if (!input.providerNativeApiAvailable) throw new Error('NATIVE_PROVIDER_SCHEDULER_UNAVAILABLE');
    return 'READY_FOR_NATIVE_SCHEDULING';
  }
  return 'READY_FOR_SCHEDULING';
}

function isProviderScheduleEvidence(
  evidence: SchedulingEvidence,
): evidence is ProviderScheduleEvidence {
  return 'providerScheduleId' in evidence;
}

function isTocaManagedScheduleEvidence(
  evidence: SchedulingEvidence,
): evidence is TocaManagedScheduleEvidence {
  return 'jobId' in evidence;
}
