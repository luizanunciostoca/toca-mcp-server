import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { PostgresInstagramConversationStatusDashboardScoped } from '../src/instagram-engagement/conversation-status-dashboard-scoped.js';

const row = {
  new_conversations: '1',
  unanswered_conversations: '2',
  awaiting_customer: '3',
  awaiting_human: '4',
  escalated: '5',
  p0_open: '0',
  p1_open: '1',
  send_failed: '0',
  send_ambiguous: '0',
  dead_letter: '0',
  overdue_human_escalations: '0',
  faq_misses: '2',
  median_first_response_ms: '1000',
  p95_first_response_ms: '2500',
};

function poolStub() {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const pool = {
    query: (text: string, values: readonly unknown[] = []) => {
      calls.push({ text, values });
      return { rows: [row] };
    },
  } as unknown as pg.Pool;
  return { pool, calls };
}

describe('scoped Instagram conversation status dashboard', () => {
  it('requires tenant, workspace and organization scope', () => {
    const { pool } = poolStub();
    expect(
      () =>
        new PostgresInstagramConversationStatusDashboardScoped(pool, {
          tenantId: '',
          workspaceId: 'toca',
          organizationId: 'toca',
        }),
    ).toThrow('INSTAGRAM_ENGAGEMENT_DASHBOARD_TENANT_REQUIRED');
  });

  it('scopes dead letter and FAQ miss counters by all three dimensions', async () => {
    const { pool, calls } = poolStub();
    const dashboard = new PostgresInstagramConversationStatusDashboardScoped(pool, {
      tenantId: 'toca',
      workspaceId: 'toca',
      organizationId: 'toca',
    });

    const result = await dashboard.getStatusDashboard();
    expect(result.deadLetter).toBe(0);
    expect(result.faqMisses).toBe(2);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.values).toEqual(['toca', 'toca', 'toca']);
    expect(calls[0]?.text).toContain(
      'e.tenant_id=$1 and e.workspace_id=$2 and e.organization_id=$3',
    );
    expect(calls[0]?.text).toContain('instagram_engagement_faq_signals_scoped');
    expect(calls[0]?.text).toContain(
      'f.tenant_id=$1 and f.workspace_id=$2 and f.organization_id=$3',
    );
  });

  it('does not expose a provider write path', () => {
    const source = PostgresInstagramConversationStatusDashboardScoped.toString();
    expect(source).not.toContain('provider.send');
    expect(source).not.toContain('replyToDirect');
    expect(source).not.toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true');
  });
});
