import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { PostgresInstagramConversationAnalyticsScoped } from '../src/instagram-engagement/conversation-analytics-scoped.js';

function poolStub() {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const pool = {
    query: async (text: string, values: readonly unknown[] = []) => {
      calls.push({ text, values });
      if (text.includes('sum(kb_miss_count)')) return { rows: [{ faq_misses: '3' }] };
      return { rows: [] };
    },
  } as unknown as pg.Pool;
  return { pool, calls };
}

const scope = {
  tenantId: 'toca',
  workspaceId: 'toca',
  organizationId: 'toca',
} as const;

describe('scoped Instagram conversation analytics runtime', () => {
  it('fails closed when tenant, workspace or organization scope is missing', () => {
    const { pool } = poolStub();
    expect(
      () =>
        new PostgresInstagramConversationAnalyticsScoped(pool, {
          tenantId: '',
          workspaceId: 'toca',
          organizationId: 'toca',
        }),
    ).toThrow('INSTAGRAM_ENGAGEMENT_ANALYTICS_TENANT_REQUIRED');
    expect(
      () =>
        new PostgresInstagramConversationAnalyticsScoped(pool, {
          tenantId: 'toca',
          workspaceId: '',
          organizationId: 'toca',
        }),
    ).toThrow('INSTAGRAM_ENGAGEMENT_ANALYTICS_WORKSPACE_REQUIRED');
    expect(
      () =>
        new PostgresInstagramConversationAnalyticsScoped(pool, {
          tenantId: 'toca',
          workspaceId: 'toca',
          organizationId: '',
        }),
    ).toThrow('INSTAGRAM_ENGAGEMENT_ANALYTICS_ORGANIZATION_REQUIRED');
  });

  it('writes FAQ evidence only to the scoped surface with a composite conflict key', async () => {
    const { pool, calls } = poolStub();
    const analytics = new PostgresInstagramConversationAnalyticsScoped(pool, scope, 4);
    await analytics.recordFaqSignal({
      questionRedacted: 'que horas abre?',
      questionSha256: 'a'.repeat(64),
      primaryIntent: 'HOURS',
      kbHit: false,
      resolved: false,
      now: '2026-09-03T06:00:00Z',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain('instagram_engagement_faq_signals_scoped');
    expect(calls[0]?.text).toContain(
      'on conflict (tenant_id,workspace_id,organization_id,normalized_question_sha256)',
    );
    expect(calls[0]?.values.slice(0, 3)).toEqual(['toca', 'toca', 'toca']);
  });

  it('writes classifier feedback and QA with the same mandatory scope', async () => {
    const { pool, calls } = poolStub();
    const analytics = new PostgresInstagramConversationAnalyticsScoped(pool, scope);
    await analytics.recordClassificationFeedback({
      eventSha256: 'b'.repeat(64),
      predictedIntent: 'EVENT_INFO',
      expectedIntent: 'EVENT_INFO',
      predictedPriority: 'P2',
      expectedPriority: 'P2',
      now: '2026-09-03T06:01:00Z',
    });
    await analytics.recordResponseQa({
      eventSha256: 'b'.repeat(64),
      scores: {
        factuality: 5,
        verbalIdentity: 4,
        clarity: 5,
        personalization: 4,
        safety: 5,
        concision: 4,
        ctaQuality: 4,
        contextAwareness: 5,
      },
      duplicateDetected: false,
      reviewer: 'human-qa',
      reviewedAt: '2026-09-03T06:02:00Z',
    });
    expect(calls[0]?.text).toContain('instagram_engagement_classification_feedback_scoped');
    expect(calls[1]?.text).toContain('instagram_engagement_response_qa_scoped');
    expect(calls[0]?.values.slice(0, 3)).toEqual(['toca', 'toca', 'toca']);
    expect(calls[1]?.values.slice(0, 3)).toEqual(['toca', 'toca', 'toca']);
  });

  it('reads FAQ misses only from the configured scope', async () => {
    const { pool, calls } = poolStub();
    const analytics = new PostgresInstagramConversationAnalyticsScoped(pool, scope);
    await expect(analytics.getFaqMisses()).resolves.toBe(3);
    expect(calls[0]?.text).toContain('instagram_engagement_faq_signals_scoped');
    expect(calls[0]?.text).toContain('tenant_id=$1 and workspace_id=$2 and organization_id=$3');
    expect(calls[0]?.values).toEqual(['toca', 'toca', 'toca']);
  });

  it('rejects invalid hashes and QA scores before persistence', async () => {
    const { pool, calls } = poolStub();
    const analytics = new PostgresInstagramConversationAnalyticsScoped(pool, scope);
    await expect(
      analytics.recordFaqSignal({
        questionRedacted: 'horário',
        questionSha256: 'not-a-hash',
        primaryIntent: 'HOURS',
        kbHit: true,
        resolved: true,
        now: '2026-09-03T06:00:00Z',
      }),
    ).rejects.toThrow('INSTAGRAM_ENGAGEMENT_FAQ_SIGNAL_SHA256_INVALID');
    await expect(
      analytics.recordResponseQa({
        eventSha256: 'c'.repeat(64),
        scores: {
          factuality: 6,
          verbalIdentity: 4,
          clarity: 5,
          personalization: 4,
          safety: 5,
          concision: 4,
          ctaQuality: 4,
          contextAwareness: 5,
        },
        duplicateDetected: false,
        reviewer: 'human-qa',
        reviewedAt: '2026-09-03T06:02:00Z',
      }),
    ).rejects.toThrow('INSTAGRAM_ENGAGEMENT_RESPONSE_QA_SCORE_INVALID');
    expect(calls).toHaveLength(0);
  });
});
