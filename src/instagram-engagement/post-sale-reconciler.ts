import type pg from 'pg';
import type { InstagramSalesFunnelCoordinator } from './sales-funnel-coordinator.js';
import type { InstagramSalesProduct } from './sales-funnel.js';

export interface InstagramPostSaleReconcilerOptions {
  readonly pool: pg.Pool;
  readonly coordinator: InstagramSalesFunnelCoordinator;
  readonly saturdaySambaPagodeVerified?: boolean;
}

interface WonCandidateRow {
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly opportunity_id: string;
  readonly contact_id: string;
  readonly lead_id: string;
  readonly product_event: string | null;
  readonly latest_inbound_at: Date | string | null;
}

export class InstagramPostSaleReconciler {
  constructor(private readonly options: InstagramPostSaleReconcilerOptions) {}

  async reconcile(nowInput: Date = new Date(), limit = 10): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('INSTAGRAM_POST_SALE_RECONCILE_LIMIT_INVALID');
    }
    const now = nowInput.toISOString();
    const result = await this.options.pool.query<WonCandidateRow>(
      `select o.tenant_id, o.workspace_id, o.organization_id,
              o.opportunity_id, o.contact_id, o.lead_id,
              l.attributes->>'productEvent' as product_event,
              max(e.occurred_at) as latest_inbound_at
         from crm_opportunities o
         join crm_leads l
           on l.tenant_id = o.tenant_id
          and l.workspace_id = o.workspace_id
          and l.organization_id = o.organization_id
          and l.lead_id = o.lead_id
         join crm_contact_channels ch
           on ch.tenant_id = o.tenant_id
          and ch.workspace_id = o.workspace_id
          and ch.organization_id = o.organization_id
          and ch.contact_id = o.contact_id
          and ch.channel_type = 'SOCIAL'
          and ch.provider = 'instagram'
         left join meta_webhook_events e
           on e.channel = 'DIRECT'
          and e.sender_scoped_id = ch.value
         left join instagram_engagement_actions ia
           on ia.event_id = e.event_id
          and ia.tenant_id = o.tenant_id
          and ia.workspace_id = o.workspace_id
          and ia.organization_id = o.organization_id
        where o.status = 'WON'
          and o.lead_id is not null
          and not exists (
            select 1
              from crm_next_actions na
             where na.tenant_id = o.tenant_id
               and na.workspace_id = o.workspace_id
               and na.organization_id = o.organization_id
               and na.lead_id = o.lead_id
               and na.playbook_key in (
                 'instagram-post-sale-sunset-v1',
                 'instagram-post-sale-the-party-v1',
                 'instagram-cross-sell-upcoming-events-v1'
               )
          )
        group by o.tenant_id, o.workspace_id, o.organization_id,
                 o.opportunity_id, o.contact_id, o.lead_id, l.attributes
       having max(case when ia.event_id is not null then e.occurred_at end) is not null
        order by max(e.occurred_at) desc, o.opportunity_id asc
        limit $1`,
      [limit],
    );

    let reconciled = 0;
    for (const row of result.rows) {
      if (!row.latest_inbound_at) continue;
      const product = normalizeProduct(row.product_event);
      await this.options.coordinator.coordinate({
        tenantId: row.tenant_id,
        workspaceId: row.workspace_id,
        organizationId: row.organization_id,
        leadId: row.lead_id,
        contactId: row.contact_id,
        lastInboundAt: toIso(row.latest_inbound_at),
        now,
        product,
        journeyStage: 'PURCHASED',
        commercialIntent: 'NONE',
        factsVerified: true,
        saturdaySambaPagodeVerified: this.options.saturdaySambaPagodeVerified === true,
        executionId: `instagram-post-sale:${row.opportunity_id}`,
        correlationId: `instagram-post-sale:${row.lead_id}`,
        evidence: [
          `crm:opportunity:${row.opportunity_id}:won`,
          'crm:won:revenue-gate-enforced',
          'instagram:sales-funnel:post-sale-reconciled',
        ],
      });
      reconciled += 1;
    }
    return reconciled;
  }
}

function normalizeProduct(value: string | null): InstagramSalesProduct {
  if (value === 'SUNSET' || value === 'THE_PARTY' || value === 'BOTH') return value;
  return 'UNSPECIFIED';
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
