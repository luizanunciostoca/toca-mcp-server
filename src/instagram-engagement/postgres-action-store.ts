import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { EngagementDecision } from '../providers/instagram/instagram-engagement-contracts.js';
import type { EngagementIntent } from '../policy/engagement-policy.js';
import type { InstagramEngagementKnowledgeMatch } from './knowledge.js';

export type InstagramEngagementActionStatus =
  | 'CLASSIFIED'
  | 'SUGGESTED'
  | 'HUMAN_REVIEW'
  | 'READY_TO_SEND'
  | 'SENT'
  | 'SEND_FAILED'
  | 'SEND_AMBIGUOUS';

export interface EngagementActionDecision {
  readonly eventId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly channel: 'COMMENT' | 'DIRECT';
  readonly intent: EngagementIntent;
  readonly decision: EngagementDecision;
  readonly knowledge: InstagramEngagementKnowledgeMatch | null;
  readonly replyMessage?: string;
  readonly status: InstagramEngagementActionStatus;
  readonly executionId: string;
  readonly now: string;
}

export class PostgresInstagramEngagementActionStore {
  constructor(private readonly pool: pg.Pool) {}

  async createIfAbsent(input: EngagementActionDecision): Promise<InstagramEngagementActionStatus> {
    const replySha256 = input.replyMessage
      ? createHash('sha256').update(input.replyMessage, 'utf8').digest('hex')
      : null;
    const result = await this.pool.query<{ status: InstagramEngagementActionStatus }>(
      `insert into instagram_engagement_actions (
         event_id, tenant_id, workspace_id, organization_id, channel, intent, risk,
         autonomy, policy_reason, faq_id, knowledge_source, knowledge_confidence,
         knowledge_tier, knowledge_chunk_id, reply_sha256, status, execution_id,
         created_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::timestamptz,$18::timestamptz)
       on conflict (event_id) do update set updated_at = instagram_engagement_actions.updated_at
       returning status`,
      [
        input.eventId,
        input.tenantId,
        input.workspaceId,
        input.organizationId,
        input.channel,
        input.intent,
        input.decision.risk,
        input.decision.autonomy,
        input.decision.reason,
        input.knowledge?.faqId ?? null,
        input.knowledge?.source ?? null,
        input.knowledge?.confidence ?? null,
        input.knowledge?.tier ?? (input.knowledge ? 'FAQ' : null),
        input.knowledge?.chunkId ?? null,
        replySha256,
        input.status,
        input.executionId,
        input.now,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('INSTAGRAM_ENGAGEMENT_ACTION_PERSIST_FAILED');
    return row.status;
  }

  async complete(input: {
    readonly eventId: string;
    readonly status: 'SENT' | 'SEND_FAILED' | 'SEND_AMBIGUOUS';
    readonly executionId: string;
    readonly now: string;
    readonly providerReplyId?: string;
    readonly failureCode?: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `update instagram_engagement_actions set
         status = $2, provider_reply_id = $3, failure_code = $4,
         execution_id = $5, updated_at = $6::timestamptz
       where event_id = $1 and status in ('READY_TO_SEND','SENT','SEND_FAILED','SEND_AMBIGUOUS')`,
      [
        input.eventId,
        input.status,
        input.providerReplyId ?? null,
        input.failureCode?.slice(0, 240) ?? null,
        input.executionId,
        input.now,
      ],
    );
    if (result.rowCount !== 1) throw new Error('INSTAGRAM_ENGAGEMENT_ACTION_STATE_CONFLICT');
  }
}
