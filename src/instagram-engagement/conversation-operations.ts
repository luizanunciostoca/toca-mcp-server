import { createHash } from 'node:crypto';
import type pg from 'pg';
import type {
  SocialClassificationConfidence,
  SocialCommercialIntent,
  SocialConversationIntent,
  SocialEngagementClassification,
  SocialPriority,
  SocialSentiment,
} from '../crm/social-engagement-contracts.js';
import type { InstagramEngagementInboundPayload } from './events.js';

export type InstagramConversationState =
  | 'NEW'
  | 'CLASSIFIED'
  | 'RESPONDABLE'
  | 'AWAITING_APPROVAL'
  | 'RESPONDED'
  | 'AWAITING_CUSTOMER'
  | 'FOLLOW_UP_REQUIRED'
  | 'ESCALATED'
  | 'RESOLVED'
  | 'CLOSED';

export interface ConversationGroupContext {
  readonly threadId: string;
  readonly groupSha256: string;
  readonly groupedText: string;
  readonly eventIds: readonly string[];
  readonly messageCount: number;
  readonly isGroupOwner: boolean;
  readonly automationBlocked: boolean;
}

interface ThreadRow {
  readonly state: InstagramConversationState;
}

interface GroupRow {
  readonly event_id: string;
  readonly occurred_at: Date | string;
  readonly payload: unknown;
}

export interface ConversationOperationsOptions {
  readonly groupingWindowMs?: number;
}

export class PostgresInstagramConversationOperations {
  readonly #groupingWindowMs: number;

  constructor(
    private readonly pool: pg.Pool,
    options: ConversationOperationsOptions = {},
  ) {
    this.#groupingWindowMs = options.groupingWindowMs ?? 8_000;
    if (
      !Number.isInteger(this.#groupingWindowMs) ||
      this.#groupingWindowMs < 0 ||
      this.#groupingWindowMs > 60_000
    ) {
      throw new Error('INSTAGRAM_ENGAGEMENT_GROUPING_WINDOW_MS_INVALID');
    }
  }

  async claimMessageGroup(input: {
    readonly payload: InstagramEngagementInboundPayload;
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly organizationId: string;
    readonly now: string;
  }): Promise<ConversationGroupContext> {
    const senderId = input.payload.senderId?.trim();
    const currentText = input.payload.text?.trim() ?? '';
    if (!senderId) {
      const fallbackThreadId = digest(
        `thread|${input.tenantId}|${input.payload.channel}|${input.payload.eventId}`,
      );
      const groupSha256 = digest(`group|${input.payload.eventId}|${digest(currentText)}`);
      return {
        threadId: fallbackThreadId,
        groupSha256,
        groupedText: currentText,
        eventIds: [input.payload.eventId],
        messageCount: 1,
        isGroupOwner: true,
        automationBlocked: true,
      };
    }

    const threadId = threadKey(input.tenantId, input.payload);
    const occurredAt = new Date(input.payload.occurredAt ?? input.now);
    if (!Number.isFinite(occurredAt.getTime()))
      throw new Error('INSTAGRAM_ENGAGEMENT_OCCURRED_AT_INVALID');
    const from = new Date(occurredAt.getTime() - this.#groupingWindowMs).toISOString();
    const to = new Date(occurredAt.getTime() + this.#groupingWindowMs).toISOString();

    const rows = await this.pool.query<GroupRow>(
      `select event_id, occurred_at, payload
         from event_outbox
        where event_type = 'instagram.engagement.inbound.v1'
          and tenant_id = $1
          and payload->>'channel' = $2
          and payload->>'senderId' = $3
          and occurred_at between $4::timestamptz and $5::timestamptz
          and ($6::text is null or coalesce(payload->>'mediaId','') = $6)
        order by occurred_at asc, event_id asc`,
      [
        input.tenantId,
        input.payload.channel,
        senderId,
        from,
        to,
        input.payload.channel === 'COMMENT' ? (input.payload.mediaId ?? '') : null,
      ],
    );

    const parsed = rows.rows
      .map((row) => ({ row, payload: safeInbound(row.payload) }))
      .filter((entry): entry is { row: GroupRow; payload: InstagramEngagementInboundPayload } =>
        Boolean(entry.payload),
      );
    if (!parsed.some((entry) => entry.payload.eventId === input.payload.eventId)) {
      parsed.push({
        row: { event_id: input.payload.eventId, occurred_at: occurredAt, payload: input.payload },
        payload: input.payload,
      });
    }
    parsed.sort(
      (a, b) =>
        dateMs(a.row.occurred_at) - dateMs(b.row.occurred_at) ||
        a.row.event_id.localeCompare(b.row.event_id),
    );

    const eventIds = [...new Set(parsed.map((entry) => entry.payload.eventId))];
    const texts = parsed
      .map((entry) => entry.payload.text?.trim())
      .filter((value): value is string => Boolean(value));
    const groupedText = texts.join('\n');
    const textSha256 = digest(groupedText);
    const groupSha256 = digest(`group|${threadId}|${eventIds.join('|')}|${textSha256}`);
    const occurredFrom = new Date(
      Math.min(...parsed.map((entry) => dateMs(entry.row.occurred_at))),
    ).toISOString();
    const occurredTo = new Date(
      Math.max(...parsed.map((entry) => dateMs(entry.row.occurred_at))),
    ).toISOString();

    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into instagram_engagement_threads (
           thread_id, tenant_id, workspace_id, organization_id, channel, state,
           last_inbound_event_id, grouped_message_count, first_inbound_at, last_inbound_at,
           created_at, updated_at
         ) values ($1,$2,$3,$4,$5,'NEW',$6,$7,$8::timestamptz,$9::timestamptz,$10::timestamptz,$10::timestamptz)
         on conflict (thread_id) do update set
           last_inbound_event_id = excluded.last_inbound_event_id,
           last_inbound_at = greatest(instagram_engagement_threads.last_inbound_at, excluded.last_inbound_at),
           updated_at = excluded.updated_at,
           version = instagram_engagement_threads.version + 1`,
        [
          threadId,
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          input.payload.channel,
          input.payload.eventId,
          eventIds.length,
          occurredFrom,
          occurredTo,
          input.now,
        ],
      );
      const thread = await client.query<ThreadRow>(
        'select state from instagram_engagement_threads where thread_id = $1 for update',
        [threadId],
      );
      const existingState = thread.rows[0]?.state ?? 'NEW';
      const inserted = await client.query(
        `insert into instagram_engagement_message_groups (
           group_sha256, thread_id, claimed_event_id, event_ids, message_count, text_sha256,
           occurred_from, occurred_to, status, created_at, updated_at
         ) values ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,'CLAIMED',$9::timestamptz,$9::timestamptz)
         on conflict (group_sha256) do nothing`,
        [
          groupSha256,
          threadId,
          input.payload.eventId,
          eventIds,
          eventIds.length,
          textSha256,
          occurredFrom,
          occurredTo,
          input.now,
        ],
      );
      await client.query('commit');
      return {
        threadId,
        groupSha256,
        groupedText,
        eventIds,
        messageCount: eventIds.length,
        isGroupOwner: inserted.rowCount === 1,
        automationBlocked: existingState === 'ESCALATED' || existingState === 'AWAITING_APPROVAL',
      };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordDecision(input: {
    readonly threadId: string;
    readonly groupSha256: string;
    readonly classification: SocialEngagementClassification;
    readonly actionStatus: 'CLASSIFIED' | 'SUGGESTED' | 'HUMAN_REVIEW' | 'READY_TO_SEND';
    readonly now: string;
  }): Promise<void> {
    const state = stateForAction(input.actionStatus);
    const groupStatus = input.actionStatus;
    const primary = input.classification.conversationIntents[0] ?? 'OTHER';
    const secondary = input.classification.conversationIntents.slice(1);
    const followUpRequired =
      input.classification.commercialIntent === 'HIGH' && state !== 'ESCALATED';
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `update instagram_engagement_message_groups set status = $2, updated_at = $3::timestamptz
          where group_sha256 = $1`,
        [input.groupSha256, groupStatus, input.now],
      );
      await client.query(
        `update instagram_engagement_threads set
           state = $2, primary_intent = $3, secondary_intents = $4,
           priority = $5, classification_confidence = $6, commercial_intent = $7,
           sentiment = $8, follow_up_required = $9, last_group_sha256 = $10,
           awaiting_since = case when $2 in ('AWAITING_APPROVAL','ESCALATED') then $11::timestamptz else awaiting_since end,
           updated_at = $11::timestamptz, version = version + 1
         where thread_id = $1`,
        [
          input.threadId,
          state,
          primary,
          secondary,
          input.classification.priority,
          input.classification.confidence,
          input.classification.commercialIntent,
          input.classification.sentiment,
          followUpRequired,
          input.groupSha256,
          input.now,
        ],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordReply(input: {
    readonly threadId: string;
    readonly groupSha256: string;
    readonly providerReplyId: string;
    readonly now: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `update instagram_engagement_message_groups set status='RESPONDED', updated_at=$2::timestamptz
          where group_sha256=$1`,
        [input.groupSha256, input.now],
      );
      await client.query(
        `update instagram_engagement_threads set
           state='AWAITING_CUSTOMER', last_provider_reply_id=$2,
           first_response_at=coalesce(first_response_at,$3::timestamptz),
           last_response_at=$3::timestamptz, awaiting_since=$3::timestamptz,
           updated_at=$3::timestamptz, version=version+1
         where thread_id=$1`,
        [input.threadId, input.providerReplyId, input.now],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async markGroupNoAction(input: {
    readonly threadId: string;
    readonly groupSha256: string;
    readonly now: string;
  }): Promise<void> {
    await this.pool.query(
      `update instagram_engagement_message_groups set status='NO_ACTION', updated_at=$3::timestamptz
        where group_sha256=$1 and thread_id=$2`,
      [input.groupSha256, input.threadId, input.now],
    );
  }
}

function threadKey(tenantId: string, payload: InstagramEngagementInboundPayload): string {
  const sender = payload.senderId?.trim() || payload.eventId;
  const surface =
    payload.channel === 'COMMENT' ? (payload.mediaId ?? payload.commentId ?? 'comment') : 'direct';
  return digest(`thread|${tenantId}|${payload.channel}|${sender}|${surface}`);
}

function safeInbound(value: unknown): InstagramEngagementInboundPayload | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<InstagramEngagementInboundPayload>;
  if (
    typeof candidate.eventId !== 'string' ||
    (candidate.channel !== 'COMMENT' && candidate.channel !== 'DIRECT')
  )
    return null;
  return candidate as InstagramEngagementInboundPayload;
}

function stateForAction(
  status: 'CLASSIFIED' | 'SUGGESTED' | 'HUMAN_REVIEW' | 'READY_TO_SEND',
): InstagramConversationState {
  if (status === 'HUMAN_REVIEW') return 'ESCALATED';
  if (status === 'SUGGESTED') return 'AWAITING_APPROVAL';
  if (status === 'READY_TO_SEND') return 'RESPONDABLE';
  return 'CLASSIFIED';
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function dateMs(value: Date | string): number {
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(ms)) throw new Error('INSTAGRAM_ENGAGEMENT_GROUP_OCCURRED_AT_INVALID');
  return ms;
}

export type ConversationIntent = SocialConversationIntent;
export type ConversationPriority = SocialPriority;
export type ConversationConfidence = SocialClassificationConfidence;
export type ConversationCommercialIntent = SocialCommercialIntent;
export type ConversationSentiment = SocialSentiment;
