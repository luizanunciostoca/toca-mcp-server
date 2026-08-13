export type SchedulingState =
  | 'READY_FOR_NATIVE_SCHEDULING'
  | 'MANUAL_HANDOFF_REQUIRED'
  | 'READY_TO_PUBLISH_AT_WINDOW'
  | 'SCHEDULED'
  | 'PUBLISHED';

export interface ProviderScheduleEvidence {
  providerScheduleId: string;
  providerScheduledAt: string;
  providerStatus: string;
}

export function assertProviderScheduleEvidence(evidence: ProviderScheduleEvidence): void {
  if (!evidence.providerScheduleId.trim()) throw new Error('PROVIDER_SCHEDULE_ID_REQUIRED');
  if (!Number.isFinite(Date.parse(evidence.providerScheduledAt))) {
    throw new Error('INVALID_PROVIDER_SCHEDULE_TIMESTAMP');
  }
  if (evidence.providerStatus !== 'SCHEDULED') {
    throw new Error('PROVIDER_SCHEDULE_STATUS_NOT_CONFIRMED');
  }
}

export function assertScheduledStateClaim(
  state: SchedulingState,
  evidence?: ProviderScheduleEvidence,
): void {
  if (state !== 'SCHEDULED') return;
  if (!evidence) throw new Error('PROVIDER_SCHEDULE_EVIDENCE_REQUIRED');
  assertProviderScheduleEvidence(evidence);
}

export function deriveSchedulingDisposition(input: {
  requiresProviderNativeScheduling: boolean;
  providerNativeApiAvailable: boolean;
  providerEvidence?: ProviderScheduleEvidence;
}): SchedulingState {
  if (input.providerEvidence) {
    assertProviderScheduleEvidence(input.providerEvidence);
    return 'SCHEDULED';
  }
  if (input.requiresProviderNativeScheduling) {
    return input.providerNativeApiAvailable
      ? 'READY_FOR_NATIVE_SCHEDULING'
      : 'MANUAL_HANDOFF_REQUIRED';
  }
  return 'READY_TO_PUBLISH_AT_WINDOW';
}
