export type CapabilityStatus =
  | 'PLANNED'
  | 'IMPLEMENTED'
  | 'CONNECTED'
  | 'PRODUCTION_VALIDATED'
  | 'PROVIDER_UNAVAILABLE'
  | 'SUSPENDED'
  | 'DEPRECATED'
  | 'REMOVED';

export type SlotWindowState = 'FUTURE' | 'ACTIVE' | 'EXPIRED';

export type ContentLifecycleStatus =
  | 'PLANNED'
  | 'SOURCE_BOUND'
  | 'BRIEFED'
  | 'PRODUCED'
  | 'QA_PASS'
  | 'APPROVED'
  | 'SCHEDULER_READY'
  | 'TOCA_SCHEDULED'
  | 'PUBLISHED'
  | 'RECONCILED'
  | 'CANCELED';

export type ContentOperationalDisposition = 'ACTIVE' | 'MISSED_WINDOW' | 'SUPERSEDED' | 'CANCELED';

export interface SlotLifecycleInput {
  scheduledAt: string;
  now: string;
  lateToleranceMinutes?: number;
}

export interface SlotLifecycleResult {
  state: SlotWindowState;
  expiredAt: string;
  isPrepareEligible: boolean;
}

export function deriveSlotWindow({
  scheduledAt,
  now,
  lateToleranceMinutes = 30,
}: SlotLifecycleInput): SlotLifecycleResult {
  const due = Date.parse(scheduledAt);
  const current = Date.parse(now);

  if (!Number.isFinite(due) || !Number.isFinite(current)) {
    throw new Error('INVALID_SLOT_TIMESTAMP');
  }

  const expiredAtEpoch = due + lateToleranceMinutes * 60_000;
  const expiredAt = new Date(expiredAtEpoch).toISOString();

  if (current > expiredAtEpoch) {
    return { state: 'EXPIRED', expiredAt, isPrepareEligible: false };
  }

  if (current < due) {
    return { state: 'FUTURE', expiredAt, isPrepareEligible: true };
  }

  return { state: 'ACTIVE', expiredAt, isPrepareEligible: true };
}

/**
 * Lifecycle state is never rewritten because a publication window expired.
 * Missed windows, cancellation and supersession are operational dispositions,
 * while the canonical content lifecycle remains monotonic and auditable.
 */
export function deriveLifecycleStatus(
  currentStatus: ContentLifecycleStatus,
  _slotWindowState: SlotWindowState,
): ContentLifecycleStatus {
  return currentStatus;
}

export function deriveOperationalDisposition(
  currentStatus: ContentLifecycleStatus,
  slotWindowState: SlotWindowState,
): ContentOperationalDisposition {
  if (currentStatus === 'CANCELED') return 'CANCELED';
  if (
    slotWindowState === 'EXPIRED' &&
    currentStatus !== 'PUBLISHED' &&
    currentStatus !== 'RECONCILED'
  ) {
    return 'MISSED_WINDOW';
  }
  return 'ACTIVE';
}

export function assertExternalWriteCapability(status: CapabilityStatus): void {
  if (status !== 'PRODUCTION_VALIDATED') {
    throw new Error('CAPABILITY_NOT_PRODUCTION_VALIDATED');
  }
}

export function buildProductionIdempotencyKey(contentItemId: string, version: string): string {
  const item = contentItemId.trim();
  const normalizedVersion = version.trim().toUpperCase();
  if (!item || !normalizedVersion) {
    throw new Error('INVALID_IDEMPOTENCY_INPUT');
  }
  return `PROD:${item}:${normalizedVersion}`;
}

export interface CoverageItem {
  date: string;
  required: boolean;
  status: ContentLifecycleStatus;
}

function hasReached(
  status: ContentLifecycleStatus,
  threshold: 'BRIEFED' | 'PRODUCED' | 'SCHEDULER_READY',
): boolean {
  const rank: Record<ContentLifecycleStatus, number> = {
    PLANNED: 0,
    SOURCE_BOUND: 1,
    BRIEFED: 2,
    PRODUCED: 3,
    QA_PASS: 4,
    APPROVED: 5,
    SCHEDULER_READY: 6,
    TOCA_SCHEDULED: 7,
    PUBLISHED: 8,
    RECONCILED: 9,
    CANCELED: -1,
  };
  const thresholdRank = rank[threshold];
  return rank[status] >= thresholdRank;
}

export function deriveCompleteDayCoverage(
  items: CoverageItem[],
  threshold: 'BRIEFED' | 'PRODUCED' | 'SCHEDULER_READY',
): number {
  const byDate = new Map<string, CoverageItem[]>();
  for (const item of items) {
    if (!item.required) continue;
    const list = byDate.get(item.date) ?? [];
    list.push(item);
    byDate.set(item.date, list);
  }

  let completeDays = 0;
  for (const dayItems of byDate.values()) {
    if (dayItems.length > 0 && dayItems.every((item) => hasReached(item.status, threshold))) {
      completeDays += 1;
    }
  }
  return completeDays;
}

export interface Reservation {
  reservationId: string;
  assetId: string;
  contentItemId: string;
  reservedAt: string;
  expiresAt: string;
}

export function isReservationExpired(reservation: Reservation, now: string): boolean {
  const expiry = Date.parse(reservation.expiresAt);
  const current = Date.parse(now);
  if (!Number.isFinite(expiry) || !Number.isFinite(current)) {
    throw new Error('INVALID_RESERVATION_TIMESTAMP');
  }
  return current > expiry;
}
