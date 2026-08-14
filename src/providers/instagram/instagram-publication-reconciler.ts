import type { InstagramPublishRequest } from './instagram-contracts.js';
import type {
  InstagramPublicationTransport,
  PublicationExecutionResult,
  PublicationExecutionStore,
  PublishedMediaEvidence,
} from './instagram-publication-executor.js';
import { reconcilePublishedPublication } from './publication-state.js';

export interface PublicationReconciliationDescriptor {
  readonly scheduledFor: string;
  readonly mediaType: InstagramPublishRequest['mediaType'];
  readonly caption?: string;
  readonly toleranceMs?: number;
}

const DEFAULT_TOLERANCE_MS = 30 * 60 * 1000;
const MAX_AUTOMATIC_DRAFT_LATENESS_MS = 15 * 60 * 1000;

export class InstagramPublicationReconciler {
  constructor(
    private readonly store: PublicationExecutionStore,
    private readonly transport: InstagramPublicationTransport,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async reconcile(
    request: InstagramPublishRequest,
    descriptor: PublicationReconciliationDescriptor,
  ): Promise<PublicationExecutionResult | undefined> {
    const nowIso = this.now();
    const record = await this.store.reserve(request, nowIso);
    if (record.state === 'PUBLISHED') return { publication: record, completed: true };
    if (record.state === 'CANCELED') return undefined;
    if (!this.transport.listRecentPublishedMedia) {
      throw new Error('INSTAGRAM_PUBLICATION_RECONCILIATION_UNAVAILABLE');
    }

    const recent = await this.transport.listRecentPublishedMedia(
      request.account.instagramAccountId,
      25,
    );
    const matches = recent.filter((candidate) => matchesDescriptor(candidate, descriptor));
    if (matches.length === 0) {
      if (record.state === 'DRAFT' && isPastAutomaticDraftWindow(descriptor.scheduledFor, nowIso)) {
        throw new Error('INSTAGRAM_PUBLICATION_OVERDUE_RECONCILIATION_REQUIRED');
      }
      return undefined;
    }
    if (matches.length > 1) throw new Error('INSTAGRAM_PUBLICATION_RECONCILIATION_AMBIGUOUS');

    const match = matches[0]!;
    const reconciled = reconcilePublishedPublication(record, nowIso, {
      externalMediaId: match.mediaId,
      ...(match.permalink ? { permalink: match.permalink } : {}),
      ...(match.timestamp ? { providerPublishedAt: match.timestamp } : {}),
      reconciliationSource: 'PROVIDER_LOOKUP',
    });
    await this.store.save(reconciled);
    return { publication: reconciled, completed: true };
  }
}

function matchesDescriptor(
  candidate: PublishedMediaEvidence,
  descriptor: PublicationReconciliationDescriptor,
): boolean {
  if (!candidate.timestamp) return false;
  const expectedAt = Date.parse(descriptor.scheduledFor);
  const providerAt = Date.parse(candidate.timestamp);
  if (!Number.isFinite(expectedAt) || !Number.isFinite(providerAt)) return false;
  if (Math.abs(providerAt - expectedAt) > (descriptor.toleranceMs ?? DEFAULT_TOLERANCE_MS)) {
    return false;
  }
  if (
    descriptor.caption !== undefined &&
    normalizeCaption(candidate.caption) !== normalizeCaption(descriptor.caption)
  ) {
    return false;
  }
  return normalizeMediaType(candidate.mediaType) === descriptor.mediaType;
}

function isPastAutomaticDraftWindow(scheduledFor: string, nowIso: string): boolean {
  const scheduledAt = Date.parse(scheduledFor);
  const now = Date.parse(nowIso);
  return (
    Number.isFinite(scheduledAt) &&
    Number.isFinite(now) &&
    now - scheduledAt > MAX_AUTOMATIC_DRAFT_LATENESS_MS
  );
}

function normalizeCaption(value: string | undefined): string {
  return (value ?? '').replace(/\r\n/g, '\n').trim();
}

function normalizeMediaType(
  value: string | undefined,
): InstagramPublishRequest['mediaType'] | undefined {
  if (value === 'IMAGE') return 'IMAGE';
  if (value === 'VIDEO' || value === 'REELS') return 'REEL';
  if (value === 'CAROUSEL_ALBUM') return 'CAROUSEL';
  return undefined;
}
