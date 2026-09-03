import type pg from 'pg';
import type { InstagramConversationAnalyticsScope } from './conversation-analytics-scoped.js';

export interface InstagramScopedResponseStatusDashboard {
  readonly newConversations: number;
  readonly unansweredConversations: number;
  readonly awaitingCustomer: number;
  readonly awaitingHuman: number;
  readonly escalated: number;
  readonly p0Open: number;
  readonly p1Open: number;
  readonly sendFailed: number;
  readonly sendAmbiguous: number;
  readonly deadLetter: number;
  readonly overdueHumanEscalations: number;
  readonly faqMisses: number;
  readonly medianFirstResponseMs: number | null;
  readonly p95FirstResponseMs: number | null;
}

interface DashboardRow {
  readonly new_conversations: number | string;
  readonly unanswered_conversations: number | string;
  readonly awaiting_customer: number | string;
  readonly awaiting_human: number | string;
  readonly escalated: number | string;
  readonly p0_open: number | string;
  readonly p1_open: number | string;
  readonly send_failed: number | string;
  readonly send_ambiguous: number | string;
  readonly dead_letter: number | string;
  readonly overdue_human_escalations: number | string;
  readonly faq_misses: number | string;
  readonly median_first_response_ms: number | string | null;
  readonly p95_first_response_ms: number | string | null;
}

export class PostgresInstagramConversationStatusDashboardScoped {
  readonly #scope: InstagramConversationAnalyticsScope;

  constructor(
    private readonly pool: pg.Pool,
    scope: InstagramConversationAnalyticsScope,
  ) {
    this.#scope = validateScope(scope);
  }

  async getStatusDashboard(): Promise<InstagramScopedResponseStatusDashboard> {
    const result = await this.pool.query<DashboardRow>(
      `select
        (select count(*) from instagram_engagement_threads t
          where t.tenant_id=$1 and t.workspace_id=$2 and t.organization_id=$3 and t.state='NEW') as new_conversations,
        (select count(*) from instagram_engagement_threads t
          where t.tenant_id=$1 and t.workspace_id=$2 and t.organization_id=$3
            and t.state in ('NEW','CLASSIFIED','RESPONDABLE','AWAITING_APPROVAL')) as unanswered_conversations,
        (select count(*) from instagram_engagement_threads t
          where t.tenant_id=$1 and t.workspace_id=$2 and t.organization_id=$3 and t.state='AWAITING_CUSTOMER') as awaiting_customer,
        (select count(*) from instagram_engagement_human_queue h
          where h.tenant_id=$1 and h.workspace_id=$2 and h.organization_id=$3
            and h.state in ('PENDING','ACKNOWLEDGED')) as awaiting_human,
        (select count(*) from instagram_engagement_threads t
          where t.tenant_id=$1 and t.workspace_id=$2 and t.organization_id=$3 and t.state='ESCALATED') as escalated,
        (select count(*) from instagram_engagement_threads t
          where t.tenant_id=$1 and t.workspace_id=$2 and t.organization_id=$3
            and t.priority='P0' and t.state not in ('RESOLVED','CLOSED')) as p0_open,
        (select count(*) from instagram_engagement_threads t
          where t.tenant_id=$1 and t.workspace_id=$2 and t.organization_id=$3
            and t.priority='P1' and t.state not in ('RESOLVED','CLOSED')) as p1_open,
        (select count(*) from instagram_engagement_actions a
          where a.tenant_id=$1 and a.workspace_id=$2 and a.organization_id=$3 and a.status='SEND_FAILED') as send_failed,
        (select count(*) from instagram_engagement_actions a
          where a.tenant_id=$1 and a.workspace_id=$2 and a.organization_id=$3 and a.status='SEND_AMBIGUOUS') as send_ambiguous,
        (select count(*) from event_outbox e
          where e.tenant_id=$1 and e.workspace_id=$2 and e.organization_id=$3
            and e.event_type in ('instagram.engagement.inbound.v1','instagram.engagement.reply.v1')
            and e.status='DEAD_LETTER') as dead_letter,
        (select count(*) from instagram_engagement_human_queue h
          where h.tenant_id=$1 and h.workspace_id=$2 and h.organization_id=$3
            and h.state in ('PENDING','ACKNOWLEDGED') and h.sla_due_at < now()) as overdue_human_escalations,
        (select coalesce(sum(f.kb_miss_count),0) from instagram_engagement_faq_signals_scoped f
          where f.tenant_id=$1 and f.workspace_id=$2 and f.organization_id=$3) as faq_misses,
        (select percentile_cont(0.5) within group (order by extract(epoch from (t.first_response_at-t.first_inbound_at))*1000)
           from instagram_engagement_threads t where t.tenant_id=$1 and t.workspace_id=$2 and t.organization_id=$3
             and t.first_response_at is not null and t.first_inbound_at is not null) as median_first_response_ms,
        (select percentile_cont(0.95) within group (order by extract(epoch from (t.first_response_at-t.first_inbound_at))*1000)
           from instagram_engagement_threads t where t.tenant_id=$1 and t.workspace_id=$2 and t.organization_id=$3
             and t.first_response_at is not null and t.first_inbound_at is not null) as p95_first_response_ms`,
      [this.#scope.tenantId, this.#scope.workspaceId, this.#scope.organizationId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('INSTAGRAM_ENGAGEMENT_SCOPED_DASHBOARD_QUERY_EMPTY');
    return {
      newConversations: integer(row.new_conversations),
      unansweredConversations: integer(row.unanswered_conversations),
      awaitingCustomer: integer(row.awaiting_customer),
      awaitingHuman: integer(row.awaiting_human),
      escalated: integer(row.escalated),
      p0Open: integer(row.p0_open),
      p1Open: integer(row.p1_open),
      sendFailed: integer(row.send_failed),
      sendAmbiguous: integer(row.send_ambiguous),
      deadLetter: integer(row.dead_letter),
      overdueHumanEscalations: integer(row.overdue_human_escalations),
      faqMisses: integer(row.faq_misses),
      medianFirstResponseMs: nullableNumber(row.median_first_response_ms),
      p95FirstResponseMs: nullableNumber(row.p95_first_response_ms),
    };
  }
}

function validateScope(
  scope: InstagramConversationAnalyticsScope,
): InstagramConversationAnalyticsScope {
  const tenantId = scope.tenantId.trim();
  const workspaceId = scope.workspaceId.trim();
  const organizationId = scope.organizationId.trim();
  if (!tenantId) throw new Error('INSTAGRAM_ENGAGEMENT_DASHBOARD_TENANT_REQUIRED');
  if (!workspaceId) throw new Error('INSTAGRAM_ENGAGEMENT_DASHBOARD_WORKSPACE_REQUIRED');
  if (!organizationId) throw new Error('INSTAGRAM_ENGAGEMENT_DASHBOARD_ORGANIZATION_REQUIRED');
  return { tenantId, workspaceId, organizationId };
}

function integer(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('INSTAGRAM_ENGAGEMENT_SCOPED_DASHBOARD_COUNT_INVALID');
  }
  return parsed;
}

function nullableNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('INSTAGRAM_ENGAGEMENT_SCOPED_DASHBOARD_DURATION_INVALID');
  }
  return parsed;
}
