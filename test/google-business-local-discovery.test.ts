import { describe, expect, it } from 'vitest';
import type { AuditSink } from '../src/core/audit.js';
import { evaluatePolicy, requiresFormalApproval } from '../src/core/policy.js';
import type { EventRecord, EventRecordStore } from '../src/events/event-record.js';
import type { ApprovalStore } from '../src/governance/approval-governance.js';
import {
  GOOGLE_BUSINESS_PUBLIC_WRITE_TOOLS,
  classifyGoogleBusinessReview,
  detectGoogleBusinessProfileDriftFromSnapshots,
  draftGoogleBusinessReviewReply,
  executeGoogleBusinessReviewReply,
  ingestGoogleBusinessNotification,
  prepareGoogleBusinessPost,
  reconcileGoogleBusinessHours,
  verifyGoogleBusinessPostReadback,
  type GoogleBusinessLocationSnapshot,
  type GoogleBusinessProvider,
  type GoogleBusinessReviewSnapshot,
} from '../src/local-discovery/google-business.js';

const EVENT: EventRecord = {
  eventId: 'event-the-party-2026-08-15',
  eventKey: 'the-party:2026-08-15',
  tenantId: 'tenant-toca',
  workspaceId: 'workspace-marketing',
  organizationId: 'org-toca',
  seriesKey: 'the-party',
  name: 'The Party',
  eventType: 'PARTY',
  status: 'ON_SALE',
  startsAt: '2026-08-16T02:59:00.000Z',
  endsAt: '2026-08-16T09:00:00.000Z',
  timezone: 'America/Bahia',
  venueName: 'Toca do Morcego',
  attributes: {},
  version: 1,
  createdAt: '2026-08-15T01:00:00.000Z',
  updatedAt: '2026-08-15T01:00:00.000Z',
};

function review(
  overrides: Partial<GoogleBusinessReviewSnapshot> = {},
): GoogleBusinessReviewSnapshot {
  return {
    name: 'accounts/1/locations/2/reviews/3',
    locationName: 'locations/2',
    reviewerDisplayName: 'Visitante',
    starRating: 5,
    comment: 'Experiencia excelente',
    createTime: '2026-08-14T20:00:00.000Z',
    updateTime: '2026-08-14T20:00:00.000Z',
    reply: null,
    ...overrides,
  };
}

function location(
  overrides: Partial<GoogleBusinessLocationSnapshot> = {},
): GoogleBusinessLocationSnapshot {
  return {
    name: 'locations/2',
    title: 'Toca do Morcego',
    storefrontAddress: 'Morro de Sao Paulo, BA, Brasil',
    websiteUri: 'https://tocadomorcego.com.br',
    primaryPhone: '+55 75 0000-0000',
    additionalPhones: [],
    primaryCategory: 'Night club',
    additionalCategories: [],
    regularHours: null,
    specialHours: [],
    openState: 'OPEN',
    profileDescription: null,
    ...overrides,
  };
}

describe('Google Business Profile / Local Discovery / Reputation', () => {
  it('prepares event posts from the canonical EventRecord instead of duplicating event truth', async () => {
    const store = {
      get: (eventId: string) => Promise.resolve(eventId === EVENT.eventId ? EVENT : undefined),
    } as unknown as EventRecordStore;

    const draft = await prepareGoogleBusinessPost(
      {
        locationName: 'locations/2',
        summary: 'The Party acontece neste sabado.',
        eventId: EVENT.eventId,
        callToAction: { actionType: 'BUY', url: 'https://tocadomorcego.com.br/the-party' },
      },
      store,
    );

    expect(draft).toMatchObject({
      topicType: 'EVENT',
      eventId: EVENT.eventId,
      event: {
        eventId: EVENT.eventId,
        title: EVENT.name,
        startsAt: EVENT.startsAt,
        endsAt: EVENT.endsAt,
        timezone: EVENT.timezone,
      },
    });
  });

  it('reconciles hours read-only and reports both missing and unexpected provider periods', () => {
    const result = reconcileGoogleBusinessHours(
      {
        periods: [{ openDay: 'MONDAY', openTime: '16:30', closeDay: 'MONDAY', closeTime: '22:00' }],
      },
      {
        periods: [{ openDay: 'MONDAY', openTime: '17:00', closeDay: 'MONDAY', closeTime: '22:00' }],
      },
    );

    expect(result.inSync).toBe(false);
    expect(result.missingFromProvider).toHaveLength(1);
    expect(result.unexpectedAtProvider).toHaveLength(1);
  });

  it('requires human review for complaints, legal content and crisis content', () => {
    expect(
      classifyGoogleBusinessReview(review({ starRating: 1, comment: 'Pessimo atendimento' })),
    ).toMatchObject({
      category: 'RECLAMACAO',
      requiresHumanReview: true,
      sensitivity: 'HUMAN_REVIEW_REQUIRED',
    });
    expect(
      classifyGoogleBusinessReview(review({ comment: 'Meu advogado vai abrir processo' })),
    ).toMatchObject({
      category: 'JURIDICO',
      requiresHumanReview: true,
    });
    expect(
      classifyGoogleBusinessReview(review({ comment: 'Houve agressao e problema de seguranca' })),
    ).toMatchObject({
      category: 'CRISE',
      requiresHumanReview: true,
    });
  });

  it('never marks review drafts as unrestricted auto-reply candidates', () => {
    const classification = classifyGoogleBusinessReview(review());
    const draft = draftGoogleBusinessReviewReply(classification, 'Obrigado pela visita!');
    expect(draft).toMatchObject({
      autoReplyEligible: false,
      requiresR27Approval: true,
      requiresHumanReview: false,
    });
  });

  it('blocks a sensitive reply before provider execution when human-review evidence is absent', async () => {
    const classification = classifyGoogleBusinessReview(review({ starRating: 1 }));
    const draft = draftGoogleBusinessReviewReply(classification, 'Vamos analisar o ocorrido.');

    await expect(
      executeGoogleBusinessReviewReply({
        provider: {} as GoogleBusinessProvider,
        classification,
        draft,
        governance: {
          approvalId: 'approval-1',
          approvalStore: {} as ApprovalStore,
          policyContext: {},
          auditSink: {} as AuditSink,
          correlationId: 'corr-1',
        },
      }),
    ).rejects.toThrow('GOOGLE_BUSINESS_SENSITIVE_REVIEW_HUMAN_REVIEW_REQUIRED');
  });

  it('keeps public Google Business writes behind formal R27 policy and non-production status', () => {
    for (const tool of Object.values(GOOGLE_BUSINESS_PUBLIC_WRITE_TOOLS)) {
      expect(requiresFormalApproval(tool)).toBe(true);
      expect(tool.riskClass).toBe('WRITE_EXTERNAL');
      expect(tool.sideEffects).toBe(true);
      expect(tool.capabilityStatus).toBe('IMPLEMENTED');
      expect(evaluatePolicy(tool, {}).decision).toBe('DENY');
    }
  });

  it('verifies provider readback against the exact prepared local post', async () => {
    const store = { get: () => Promise.resolve(EVENT) } as unknown as EventRecordStore;
    const draft = await prepareGoogleBusinessPost(
      { locationName: 'locations/2', summary: 'Evento confirmado.', eventId: EVENT.eventId },
      store,
    );
    const verification = verifyGoogleBusinessPostReadback(draft, {
      name: 'accounts/1/locations/2/localPosts/4',
      locationName: draft.locationName,
      topicType: draft.topicType,
      summary: draft.summary,
      callToAction: draft.callToAction,
      event: draft.event,
      state: 'LIVE',
      createTime: '2026-08-15T02:00:00.000Z',
      updateTime: '2026-08-15T02:00:00.000Z',
      canonicalUrl: 'https://www.google.com/search?q=toca+do+morcego',
    });

    expect(verification.verified).toBe(true);
    expect(verification.evidence).toHaveLength(1);
  });

  it('detects canonical and Google-updated profile drift without mutating the provider', () => {
    const current = location();
    const googleUpdated = location({ websiteUri: 'https://example.com/wrong' });
    const result = detectGoogleBusinessProfileDriftFromSnapshots(
      { title: 'Toca do Morcego', websiteUri: 'https://tocadomorcego.com.br' },
      current,
      googleUpdated,
    );

    expect(result.driftDetected).toBe(true);
    expect(result.drifts).toContainEqual({
      field: 'websiteUri',
      expected: 'https://example.com/wrong',
      actual: 'https://tocadomorcego.com.br',
      source: 'GOOGLE_UPDATED_VS_PROVIDER',
    });
  });

  it('normalizes provider notifications with a stable deduplication key', () => {
    const result = ingestGoogleBusinessNotification({
      messageId: 'pubsub-message-1',
      publishedAt: '2026-08-15T02:00:00.000Z',
      accountName: 'accounts/1',
      locationName: 'locations/2',
      notificationType: 'NEW_REVIEW',
      resourceName: 'accounts/1/locations/2/reviews/3',
    });

    expect(result.deduplicationKey).toBe('google-business-notification:pubsub-message-1');
  });
});
