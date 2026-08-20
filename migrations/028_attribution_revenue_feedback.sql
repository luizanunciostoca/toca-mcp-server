create table if not exists attribution_window_policies (
  policy_id text primary key,
  policy_key text not null,
  version integer not null,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  first_touch_lookback_days integer not null,
  last_touch_lookback_days integer not null,
  assisted_lookback_days integer not null,
  idempotency_key text not null,
  execution_id text not null,
  correlation_id text not null,
  actor_principal_id text not null,
  evidence jsonb not null,
  created_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, policy_key, version),
  check (version >= 1),
  check (first_touch_lookback_days between 1 and 3650),
  check (last_touch_lookback_days between 1 and 3650),
  check (assisted_lookback_days between 1 and 3650),
  check (length(trim(policy_id)) > 0),
  check (length(trim(policy_key)) > 0),
  check (length(trim(idempotency_key)) > 0),
  check (length(trim(execution_id)) > 0),
  check (length(trim(correlation_id)) > 0),
  check (length(trim(actor_principal_id)) > 0),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists attribution_window_policies_latest_idx
  on attribution_window_policies (
    tenant_id, workspace_id, organization_id, policy_key, version desc, created_at desc
  );

create table if not exists attribution_touchpoints (
  touchpoint_id text primary key,
  dedupe_key text not null,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  contact_id text,
  lead_id text,
  opportunity_id text,
  conversation_id text,
  message_id text,
  channel text not null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  meta_campaign_id text,
  meta_adset_id text,
  meta_ad_id text,
  meta_creative_id text,
  google_campaign_id text,
  google_ad_group_id text,
  google_ad_id text,
  google_creative_id text,
  click_id text,
  fbclid text,
  gclid text,
  gbraid text,
  wbraid text,
  landing_url text,
  session_id text,
  lead_source text,
  ticket_reference text,
  order_reference text,
  payment_reference text,
  checkout_reference text,
  message_ref text,
  intent text,
  demand_context jsonb not null default '{}'::jsonb,
  attribution_source text not null,
  occurred_at timestamptz not null,
  idempotency_key text not null,
  execution_id text not null,
  correlation_id text not null,
  actor_principal_id text not null,
  evidence jsonb not null,
  created_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, dedupe_key),
  foreign key (tenant_id, workspace_id, organization_id, contact_id)
    references crm_contacts (tenant_id, workspace_id, organization_id, contact_id) on delete restrict,
  foreign key (tenant_id, workspace_id, organization_id, lead_id)
    references crm_leads (tenant_id, workspace_id, organization_id, lead_id) on delete restrict,
  foreign key (tenant_id, workspace_id, organization_id, opportunity_id)
    references crm_opportunities (tenant_id, workspace_id, organization_id, opportunity_id) on delete restrict,
  check (length(trim(touchpoint_id)) > 0),
  check (length(dedupe_key) = 64 and dedupe_key ~ '^[a-f0-9]+$'),
  check (length(trim(channel)) > 0),
  check (length(trim(attribution_source)) > 0),
  check (
    contact_id is not null or lead_id is not null or opportunity_id is not null or
    conversation_id is not null or session_id is not null
  ),
  check (jsonb_typeof(demand_context) = 'object'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists attribution_touchpoints_opportunity_time_idx
  on attribution_touchpoints (
    tenant_id, workspace_id, organization_id, opportunity_id, occurred_at, touchpoint_id
  ) where opportunity_id is not null;
create index if not exists attribution_touchpoints_contact_time_idx
  on attribution_touchpoints (
    tenant_id, workspace_id, organization_id, contact_id, occurred_at, touchpoint_id
  ) where contact_id is not null;
create index if not exists attribution_touchpoints_campaign_idx
  on attribution_touchpoints (
    tenant_id, meta_campaign_id, meta_adset_id, meta_ad_id, occurred_at
  ) where meta_campaign_id is not null or meta_ad_id is not null;
create index if not exists attribution_touchpoints_google_campaign_idx
  on attribution_touchpoints (
    tenant_id, google_campaign_id, google_ad_group_id, google_ad_id, occurred_at
  ) where google_campaign_id is not null or google_ad_id is not null;

create table if not exists revenue_evidence_records (
  revenue_evidence_id text primary key,
  dedupe_key text not null,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  opportunity_id text not null,
  contact_id text not null,
  lead_id text,
  conversation_id text,
  event_id text references event_records (event_id) on delete restrict,
  source_type text not null,
  provider text not null,
  provider_event_id text not null,
  provider_evidence_ref text not null,
  external_reference text not null,
  status text not null,
  provider_readback_at timestamptz not null,
  occurred_at timestamptz not null,
  currency text,
  gross_revenue_minor bigint,
  net_revenue_minor bigint,
  refund_minor bigint,
  cost_minor bigint,
  ticket_reference text,
  order_reference text,
  payment_reference text,
  checkout_reference text,
  idempotency_key text not null,
  execution_id text not null,
  correlation_id text not null,
  actor_principal_id text not null,
  evidence jsonb not null,
  created_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, dedupe_key),
  foreign key (tenant_id, workspace_id, organization_id, opportunity_id)
    references crm_opportunities (tenant_id, workspace_id, organization_id, opportunity_id) on delete restrict,
  foreign key (tenant_id, workspace_id, organization_id, contact_id)
    references crm_contacts (tenant_id, workspace_id, organization_id, contact_id) on delete restrict,
  foreign key (tenant_id, workspace_id, organization_id, lead_id)
    references crm_leads (tenant_id, workspace_id, organization_id, lead_id) on delete restrict,
  check (source_type in ('TICKETING', 'CHECKOUT', 'PAYMENT', 'ORDER')),
  check (status in ('CONFIRMED', 'REFUNDED', 'CANCELED')),
  check (length(dedupe_key) = 64 and dedupe_key ~ '^[a-f0-9]+$'),
  check (length(trim(provider)) > 0),
  check (length(trim(provider_event_id)) > 0),
  check (length(trim(provider_evidence_ref)) > 0),
  check (length(trim(external_reference)) > 0),
  check (provider_readback_at >= occurred_at),
  check (currency is null or currency ~ '^[A-Z]{3}$'),
  check (gross_revenue_minor is null or gross_revenue_minor >= 0),
  check (net_revenue_minor is null or net_revenue_minor >= 0),
  check (refund_minor is null or refund_minor >= 0),
  check (cost_minor is null or cost_minor >= 0),
  check (net_revenue_minor is null or gross_revenue_minor is null or net_revenue_minor <= gross_revenue_minor),
  check (
    (gross_revenue_minor is null and net_revenue_minor is null and refund_minor is null and cost_minor is null) or
    currency is not null
  ),
  check (status <> 'REFUNDED' or (refund_minor is not null and refund_minor > 0)),
  check (
    (source_type = 'TICKETING' and ticket_reference is not null and length(trim(ticket_reference)) > 0) or
    (source_type = 'CHECKOUT' and checkout_reference is not null and length(trim(checkout_reference)) > 0) or
    (source_type = 'PAYMENT' and payment_reference is not null and length(trim(payment_reference)) > 0) or
    (source_type = 'ORDER' and order_reference is not null and length(trim(order_reference)) > 0)
  ),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists revenue_evidence_opportunity_time_idx
  on revenue_evidence_records (
    tenant_id, workspace_id, organization_id, opportunity_id, occurred_at, revenue_evidence_id
  );
create index if not exists revenue_evidence_external_ref_idx
  on revenue_evidence_records (
    tenant_id, source_type, provider, external_reference, occurred_at, revenue_evidence_id
  );

create table if not exists marketing_sales_feedback_snapshots (
  feedback_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  opportunity_id text not null,
  marketing jsonb not null,
  sales jsonb not null,
  idempotency_key text not null,
  execution_id text not null,
  correlation_id text not null,
  actor_principal_id text not null,
  evidence jsonb not null,
  created_at timestamptz not null,
  foreign key (tenant_id, workspace_id, organization_id, opportunity_id)
    references crm_opportunities (tenant_id, workspace_id, organization_id, opportunity_id) on delete restrict,
  check (jsonb_typeof(marketing) = 'object'),
  check (jsonb_typeof(sales) = 'object'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists marketing_sales_feedback_opportunity_idx
  on marketing_sales_feedback_snapshots (
    tenant_id, workspace_id, organization_id, opportunity_id, created_at desc, feedback_id
  );

create table if not exists measurement_intelligence_idempotency (
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  operation text not null,
  idempotency_key text not null,
  request_hash text not null,
  record_type text not null,
  record_id text not null,
  response_snapshot jsonb,
  created_at timestamptz not null,
  completed_at timestamptz,
  primary key (tenant_id, workspace_id, organization_id, operation, idempotency_key),
  check (record_type in ('ATTRIBUTION_WINDOW_POLICY', 'ATTRIBUTION_TOUCHPOINT', 'REVENUE_EVIDENCE', 'MARKETING_SALES_FEEDBACK')),
  check (length(request_hash) = 64 and request_hash ~ '^[a-f0-9]+$'),
  check (response_snapshot is null or jsonb_typeof(response_snapshot) = 'object')
);

create or replace function enforce_crm_won_verified_conversion_evidence()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'WON' and old.status is distinct from 'WON' then
    if not exists (
      select 1
        from revenue_evidence_records confirmed
       where confirmed.tenant_id = new.tenant_id
         and confirmed.workspace_id = new.workspace_id
         and confirmed.organization_id = new.organization_id
         and confirmed.opportunity_id = new.opportunity_id
         and confirmed.status = 'CONFIRMED'
         and confirmed.source_type in ('TICKETING', 'CHECKOUT', 'PAYMENT', 'ORDER')
         and length(trim(confirmed.provider_evidence_ref)) > 0
         and not exists (
           select 1
             from revenue_evidence_records canceled
            where canceled.tenant_id = confirmed.tenant_id
              and canceled.workspace_id = confirmed.workspace_id
              and canceled.organization_id = confirmed.organization_id
              and canceled.opportunity_id = confirmed.opportunity_id
              and canceled.source_type = confirmed.source_type
              and canceled.provider = confirmed.provider
              and canceled.external_reference = confirmed.external_reference
              and canceled.status = 'CANCELED'
              and canceled.occurred_at >= confirmed.occurred_at
         )
         and (
           coalesce((
             select sum(refunded.refund_minor)
               from revenue_evidence_records refunded
              where refunded.tenant_id = confirmed.tenant_id
                and refunded.workspace_id = confirmed.workspace_id
                and refunded.organization_id = confirmed.organization_id
                and refunded.opportunity_id = confirmed.opportunity_id
                and refunded.source_type = confirmed.source_type
                and refunded.provider = confirmed.provider
                and refunded.external_reference = confirmed.external_reference
                and refunded.status = 'REFUNDED'
                and refunded.occurred_at >= confirmed.occurred_at
           ), 0) = 0
           or (
             coalesce(confirmed.net_revenue_minor, confirmed.gross_revenue_minor) is not null
             and coalesce((
               select sum(refunded.refund_minor)
                 from revenue_evidence_records refunded
                where refunded.tenant_id = confirmed.tenant_id
                  and refunded.workspace_id = confirmed.workspace_id
                  and refunded.organization_id = confirmed.organization_id
                  and refunded.opportunity_id = confirmed.opportunity_id
                  and refunded.source_type = confirmed.source_type
                  and refunded.provider = confirmed.provider
                  and refunded.external_reference = confirmed.external_reference
                  and refunded.status = 'REFUNDED'
                  and refunded.occurred_at >= confirmed.occurred_at
             ), 0) < coalesce(confirmed.net_revenue_minor, confirmed.gross_revenue_minor)
           )
         )
    ) then
      raise exception 'CRM_WON_REQUIRES_VERIFIED_CONVERSION_EVIDENCE';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists crm_opportunities_won_evidence_guard on crm_opportunities;
create trigger crm_opportunities_won_evidence_guard
before update of status on crm_opportunities
for each row execute function enforce_crm_won_verified_conversion_evidence();

create or replace function reject_attribution_revenue_history_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ATTRIBUTION_REVENUE_HISTORY_MUTATION_FORBIDDEN';
end;
$$;

drop trigger if exists attribution_window_policies_append_only on attribution_window_policies;
create trigger attribution_window_policies_append_only
before update or delete on attribution_window_policies
for each row execute function reject_attribution_revenue_history_mutation();

drop trigger if exists attribution_touchpoints_append_only on attribution_touchpoints;
create trigger attribution_touchpoints_append_only
before update or delete on attribution_touchpoints
for each row execute function reject_attribution_revenue_history_mutation();

drop trigger if exists revenue_evidence_records_append_only on revenue_evidence_records;
create trigger revenue_evidence_records_append_only
before update or delete on revenue_evidence_records
for each row execute function reject_attribution_revenue_history_mutation();

drop trigger if exists marketing_sales_feedback_snapshots_append_only on marketing_sales_feedback_snapshots;
create trigger marketing_sales_feedback_snapshots_append_only
before update or delete on marketing_sales_feedback_snapshots
for each row execute function reject_attribution_revenue_history_mutation();
