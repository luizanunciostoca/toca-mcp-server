create table if not exists finops_cost_events (
  event_id text primary key,
  event_sha256 text not null check (event_sha256 ~ '^[0-9a-f]{64}$'),
  execution_id text not null,
  correlation_id text not null,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  route_id text,
  agent_id text,
  provider text not null,
  model text,
  category text not null check (category in (
    'AI_TEXT','AI_IMAGE','AI_VIDEO','COMPUTE','STORAGE','NETWORK','MEDIA_SPEND','OTHER'
  )),
  phase text not null check (phase in ('ESTIMATE','ACTUAL','RECONCILIATION')),
  price_catalog_version text not null,
  currency text not null check (currency = 'USD'),
  estimated_cost_micro_usd bigint check (estimated_cost_micro_usd is null or estimated_cost_micro_usd >= 0),
  actual_cost_micro_usd bigint check (actual_cost_micro_usd is null or actual_cost_micro_usd >= 0),
  usage jsonb not null,
  content_item_id text,
  campaign_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  check (phase <> 'ESTIMATE' or estimated_cost_micro_usd is not null),
  check (phase <> 'ACTUAL' or actual_cost_micro_usd is not null)
);

create index if not exists finops_cost_events_correlation_idx
  on finops_cost_events (correlation_id, created_at asc);
create index if not exists finops_cost_events_tenant_time_idx
  on finops_cost_events (tenant_id, workspace_id, organization_id, created_at desc);
create index if not exists finops_cost_events_route_time_idx
  on finops_cost_events (route_id, created_at desc) where route_id is not null;
create index if not exists finops_cost_events_content_idx
  on finops_cost_events (content_item_id, created_at desc) where content_item_id is not null;
create index if not exists finops_cost_events_campaign_idx
  on finops_cost_events (campaign_id, created_at desc) where campaign_id is not null;

create or replace function reject_finops_cost_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'FINOPS_COST_LEDGER_APPEND_ONLY';
end;
$$;

drop trigger if exists finops_cost_events_append_only on finops_cost_events;
create trigger finops_cost_events_append_only
before update or delete on finops_cost_events
for each row execute function reject_finops_cost_event_mutation();

comment on table finops_cost_events is
  'Append-only TOCA OS cost evidence. Monetary values use integer micro-USD; business authorization remains in Core Policy/Approval.';
