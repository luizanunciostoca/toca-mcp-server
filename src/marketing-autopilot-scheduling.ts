export type SchedulingState =
  | 'READY_FOR_NATIVE_SCHEDULING'
  | 'MANUAL_HANDOFF_REQUIRED'
  | 'READY_TO_PUBLISH_AT_WINDOW'
  | 'SCHEDULED'
  | 'PUBLISHED';

export type SchedulingPolicy = 'NATIVE_PROVIDER_SCHEDULING_ONLY' | 'SHARE_NOW';

export type PublicationIntent = 'NATIVE_SCHEDULE' | 'PUBLISH_AT_WINDOW' | 'SHARE_NOW';

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

export function assertSchedulingPolicyAllowsIntent(
  policy: SchedulingPolicy,
  intent: PublicationIntent,
): void {
  if (policy === 'NATIVE_PROVIDER_SCHEDULING_ONLY' && intent !== 'NATIVE_SCHEDULE') {
    throw new Error('NATIVE_PROVIDER_SCHEDULING_ONLY_POLICY_DENIED');
  }

  if (policy === 'SHARE_NOW' && intent !== 'SHARE_NOW') {
    throw new Error('SHARE_NOW_POLICY_DENIED');
  }
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
