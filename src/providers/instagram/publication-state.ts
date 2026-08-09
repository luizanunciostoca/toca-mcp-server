export type PublicationState =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'CREATING_CONTAINER'
  | 'PROCESSING'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'CANCELED';

export interface PublicationRecord {
  readonly publicationId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly state: PublicationState;
  readonly externalContainerId?: string;
  readonly externalMediaId?: string;
  readonly lastError?: string;
  readonly updatedAt: string;
}

const allowedTransitions: Readonly<Record<PublicationState, readonly PublicationState[]>> = {
  DRAFT: ['SCHEDULED', 'CREATING_CONTAINER', 'CANCELED'],
  SCHEDULED: ['CREATING_CONTAINER', 'CANCELED', 'FAILED'],
  CREATING_CONTAINER: ['PROCESSING', 'FAILED'],
  PROCESSING: ['PUBLISHING', 'FAILED'],
  PUBLISHING: ['PUBLISHED', 'FAILED'],
  PUBLISHED: [],
  FAILED: ['CREATING_CONTAINER', 'CANCELED'],
  CANCELED: [],
};

export function transitionPublication(
  current: PublicationRecord,
  next: PublicationState,
  nowIso: string,
  patch: Partial<Pick<PublicationRecord, 'externalContainerId' | 'externalMediaId' | 'lastError'>> = {},
): PublicationRecord {
  if (!allowedTransitions[current.state].includes(next)) {
    throw new Error(`Invalid publication transition: ${current.state} -> ${next}`);
  }
  return { ...current, ...patch, state: next, updatedAt: nowIso };
}

export type PublicationReconciliation =
  | { readonly status: 'IN_SYNC'; readonly state: PublicationState }
  | { readonly status: 'LOCAL_STALE'; readonly local: PublicationState; readonly provider: PublicationState }
  | { readonly status: 'STATE_CONFLICT'; readonly local: PublicationState; readonly provider: PublicationState };

export function reconcilePublicationState(
  local: PublicationState,
  provider: PublicationState,
): PublicationReconciliation {
  if (local === provider) return { status: 'IN_SYNC', state: local };
  if (provider === 'PUBLISHED' && local !== 'PUBLISHED') {
    return { status: 'LOCAL_STALE', local, provider };
  }
  return { status: 'STATE_CONFLICT', local, provider };
}
