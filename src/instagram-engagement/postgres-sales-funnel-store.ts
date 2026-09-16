import type pg from 'pg';

const OWNED_PLAYBOOKS = [
  'instagram-ticket-follow-up-help-v1',
  'instagram-ticket-follow-up-last-window-v1',
  'instagram-post-sale-sunset-v1',
  'instagram-cross-sell-saturday-samba-pagode-v1',
  'instagram-post-sale-the-party-v1',
  'instagram-cross-sell-upcoming-events-v1',
] as const;

export type InstagramSalesFunnelOwnedPlaybook = (typeof OWNED_PLAYBOOKS)[number];

export interface ClaimedInstagramSalesFunnelAction {
  readonly nextActionId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly contactId: string;
  readonly leadId: string;
  readonly actionType: 'FOLLOW_UP' | 'POST_SALE';
  readonly playbookKey: InstagramSalesFunnelOwnedPlaybook;
  readonly dueAt: string;
  readonly createdAt: string;
  readonly version: number;
}

export interface InstagramSalesFunnelRecipientProof {
  readonly recipientScopedId: string;
  readonly latestInboundAt: string;
}

export class PostgresInstagramSalesFunnelStore {
  constructor(private readonly pool: pg.Pool) {}

  async claimDue(input: {
    readonly now: string;
    readonly limit: number;
  }): Promise<readonly ClaimedInstagramSalesFunnelAction[]> {
    const now = normalizeTimestamp(input.now, 'INSTAGRAM_SALES_FUNNEL_CLAIM_NOW_INVALID');
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) {
      throw new Error('INSTAGRAM_SALES_FUNNEL_CLAIM_LIMIT_INVALID');
    }
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await client.query<{
        next_action_id: string;
        tenant_id: string;
        workspace_id: string;
        organization_id: string;
        contact_id: string;
        lead_id: string | null;
        action_type: string;
        playbook_key: string | null;
        due_at: Date | string | null;
        created_at: Date | string;
        version: number;
      }>(
        `with candidates as (
           select next_action_id
             from crm_next_actions
            where status = 'PENDING'
              and due_at is not null
              and due_at <= $1::timestamptz
              and playbook_key = any($2::text[])
            order by due_at asc, priority desc, next_action_id asc
            for update skip locked
            limit $3
         )
         update crm_next_actions a
            set status = 'IN_PROGRESS',
                version = a.version + 1,
                updated_at = $1::timestamptz
           from candidates c
          where a.next_action_id = c.next_action_id
          returning a.next_action_id, a.tenant_id, a.workspace_id, a.organization_id,
                    a.contact_id, a.lead_id, a.action_type, a.playbook_key, a.due_at,
                    a.created_at, a.version`,
        [now, [...OWNED_PLAYBOOKS], input.limit],
      );
      await client.query('commit');
      return result.rows.map((row) => {
        if (!row.lead_id) throw new Error('INSTAGRAM_SALES_FUNNEL_CLAIM_LEAD_REQUIRED');
        if (!isOwnedPlaybook(row.playbook_key)) {
          throw new Error('INSTAGRAM_SALES_FUNNEL_CLAIM_PLAYBOOK_INVALID');
        }
        if (!row.due_at) throw new Error('INSTAGRAM_SALES_FUNNEL_CLAIM_DUE_AT_REQUIRED');
        if (row.action_type !== 'FOLLOW_UP' && row.action_type !== 'POST_SALE') {
          throw new Error('INSTAGRAM_SALES_FUNNEL_CLAIM_ACTION_INVALID');
        }
        return {
          nextActionId: row.next_action_id,
          tenantId: row.tenant_id,
          workspaceId: row.workspace_id,
          organizationId: row.organization_id,
          contactId: row.contact_id,
          leadId: row.lead_id,
          actionType: row.action_type,
          playbookKey: row.playbook_key,
          dueAt: toIso(row.due_at),
          createdAt: toIso(row.created_at),
          version: row.version,
        };
      });
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async resolveRecipientAndWindow(
    action: ClaimedInstagramSalesFunnelAction,
  ): Promise<InstagramSalesFunnelRecipientProof | null> {
    const result = await this.pool.query<{
      recipient_scoped_id: string;
      latest_inbound_at: Date | string | null;
    }>(
      `select ch.value as recipient_scoped_id,
              max(e.occurred_at) as latest_inbound_at
         from crm_contact_channels ch
         join meta_webhook_events e
           on e.channel = 'DIRECT'
          and e.sender_scoped_id = ch.value
         join instagram_engagement_actions a
           on a.event_id = e.event_id
          and a.tenant_id = ch.tenant_id
          and a.workspace_id = ch.workspace_id
          and a.organization_id = ch.organization_id
        where ch.tenant_id = $1
          and ch.workspace_id = $2
          and ch.organization_id = $3
          and ch.contact_id = $4
          and ch.channel_type = 'SOCIAL'
          and ch.provider = 'instagram'
        group by ch.value
        order by max(e.occurred_at) desc
        limit 1`,
      [action.tenantId, action.workspaceId, action.organizationId, action.contactId],
    );
    const row = result.rows[0];
    if (!row?.recipient_scoped_id || !row.latest_inbound_at) return null;
    return {
      recipientScopedId: row.recipient_scoped_id,
      latestInboundAt: toIso(row.latest_inbound_at),
    };
  }

  async completeSent(input: {
    readonly action: ClaimedInstagramSalesFunnelAction;
    readonly providerMessageId: string;
    readonly now: string;
  }): Promise<void> {
    const now = normalizeTimestamp(input.now, 'INSTAGRAM_SALES_FUNNEL_COMPLETE_NOW_INVALID');
    requireText(input.providerMessageId, 'INSTAGRAM_SALES_FUNNEL_PROVIDER_MESSAGE_ID_REQUIRED');
    const result = await this.pool.query(
      `update crm_next_actions
          set status = 'COMPLETED', completed_at = $3::timestamptz,
              version = version + 1, updated_at = $3::timestamptz
        where next_action_id = $1
          and version = $2
          and status = 'IN_PROGRESS'`,
      [input.action.nextActionId, input.action.version, now],
    );
    if (result.rowCount !== 1) throw new Error('INSTAGRAM_SALES_FUNNEL_COMPLETE_STATE_MISMATCH');
  }

  async cancel(input: {
    readonly action: ClaimedInstagramSalesFunnelAction;
    readonly now: string;
    readonly reason: string;
  }): Promise<void> {
    const now = normalizeTimestamp(input.now, 'INSTAGRAM_SALES_FUNNEL_CANCEL_NOW_INVALID');
    const reason = requireText(input.reason, 'INSTAGRAM_SALES_FUNNEL_CANCEL_REASON_REQUIRED');
    const result = await this.pool.query(
      `update crm_next_actions
          set status = 'CANCELED',
              rationale = case
                when position($3 in rationale) > 0 then rationale
                else rationale || ' | canceled:' || $3
              end,
              version = version + 1,
              updated_at = $4::timestamptz
        where next_action_id = $1
          and version = $2
          and status = 'IN_PROGRESS'`,
      [input.action.nextActionId, input.action.version, reason.slice(0, 240), now],
    );
    if (result.rowCount !== 1) throw new Error('INSTAGRAM_SALES_FUNNEL_CANCEL_STATE_MISMATCH');
  }
}

export function contentKeyForPlaybook(
  playbook: InstagramSalesFunnelOwnedPlaybook,
):
  | 'TICKET_FOLLOW_UP_HELP'
  | 'TICKET_FOLLOW_UP_LAST_WINDOW'
  | 'SUNSET_POST_SALE'
  | 'SUNSET_SATURDAY_SAMBA_PAGODE'
  | 'THE_PARTY_POST_SALE'
  | 'UPCOMING_EVENTS_CROSS_SELL' {
  switch (playbook) {
    case 'instagram-ticket-follow-up-help-v1':
      return 'TICKET_FOLLOW_UP_HELP';
    case 'instagram-ticket-follow-up-last-window-v1':
      return 'TICKET_FOLLOW_UP_LAST_WINDOW';
    case 'instagram-post-sale-sunset-v1':
      return 'SUNSET_POST_SALE';
    case 'instagram-cross-sell-saturday-samba-pagode-v1':
      return 'SUNSET_SATURDAY_SAMBA_PAGODE';
    case 'instagram-post-sale-the-party-v1':
      return 'THE_PARTY_POST_SALE';
    case 'instagram-cross-sell-upcoming-events-v1':
      return 'UPCOMING_EVENTS_CROSS_SELL';
  }
}

function isOwnedPlaybook(value: string | null): value is InstagramSalesFunnelOwnedPlaybook {
  return Boolean(value && (OWNED_PLAYBOOKS as readonly string[]).includes(value));
}

function normalizeTimestamp(value: string, code: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(code);
  return new Date(parsed).toISOString();
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function requireText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}
