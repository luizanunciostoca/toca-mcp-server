create table if not exists measurement_plans (
  plan_id text primary key,
  plan_key text not null,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  event_id text references event_records (event_id) on delete restrict,
  objective text not null,
  attribution_model text not null,
  conversion_event_names jsonb not null,
  required_dimensions jsonb not null,
  created_by_principal_id text not null,
  correlation_id text not null,
  workflow_instance_id text,
  evidence jsonb not null,
  created_at timestamptz not null,
  unique (tenant_id, plan_key),
  check (length(trim(plan_id)) > 0),
  check (length(trim(plan_key)) > 0),
  check (length(trim(tenant_id)) > 0),
  check (length(trim(workspace_id)) > 0),
  check (length(trim(organization_id)) > 0),
  check (length(trim(objective)) > 0),
  check (attribution_model in ('FIRST_TOUCH', 'LAST_TOUCH', 'LINEAR')),
  check (jsonb_typeof(conversion_event_names) = 'array' and jsonb_array_length(conversion_event_names) > 0),
  check (jsonb_typeof(required_dimensions) = 'array'),
  check (length(trim(created_by_principal_id)) > 0),
  check (length(trim(correlation_id)) > 0),
  check (workflow_instance_id is null or length(trim(workflow_instance_id)) > 0),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists measurement_plans_event_idx
  on measurement_plans (tenant_id, event_id, created_at)
  where event_id is not null;

create table if not exists measurement_events (
  measurement_event_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  event_id text references event_records (event_id) on delete restrict,
  source_system text not null,
  source_event_id text not null,
  event_name text not null,
  occurred_at timestamptz not null,
  ingested_at timestamptz not null,
  session_id text,
  anonymous_id text,
  subject_id text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  campaign_id text,
  content_id text,
  is_conversion boolean not null default false,
  value_minor bigint,
  currency text,
  properties jsonb not null default '{}'::jsonb,
  data_quality jsonb not null,
  requester_principal_id text not null,
  correlation_id text not null,
  workflow_instance_id text,
  evidence jsonb not null,
  unique (tenant_id, source_system, source_event_id),
  check (source_system in ('GA4', 'SEARCH_CONSOLE', 'META', 'TICKETING', 'CUSTOM')),
  check (length(trim(source_event_id)) > 0),
  check (length(trim(event_name)) > 0),
  check (source_system <> 'TICKETING' or event_id is not null),
  check (value_minor is null or value_minor >= 0),
  check (currency is null or currency ~ '^[A-Z]{3}$'),
  check ((value_minor is null) or currency is not null),
  check (jsonb_typeof(properties) = 'object'),
  check (jsonb_typeof(data_quality) = 'object'),
  check (length(trim(requester_principal_id)) > 0),
  check (length(trim(correlation_id)) > 0),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists measurement_events_event_time_idx
  on measurement_events (tenant_id, event_id, occurred_at, measurement_event_id);
create index if not exists measurement_events_campaign_idx
  on measurement_events (tenant_id, utm_campaign, campaign_id, occurred_at)
  where utm_campaign is not null or campaign_id is not null;
create index if not exists measurement_events_conversion_idx
  on measurement_events (tenant_id, event_id, occurred_at)
  where is_conversion;

create table if not exists ticketing_event_bindings (
  binding_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  event_id text not null references event_records (event_id) on delete restrict,
  provider text not null,
  external_event_id text not null,
  external_event_url text,
  requester_principal_id text not null,
  correlation_id text not null,
  workflow_instance_id text,
  evidence jsonb not null,
  created_at timestamptz not null,
  unique (provider, external_event_id),
  check (length(trim(provider)) > 0),
  check (length(trim(external_event_id)) > 0),
  check (external_event_url is null or length(trim(external_event_url)) > 0),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists ticketing_event_bindings_event_idx
  on ticketing_event_bindings (tenant_id, event_id, provider);

create table if not exists ticketing_sales_snapshots (
  snapshot_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  event_id text not null references event_records (event_id) on delete restrict,
  provider text not null,
  external_event_id text not null,
  sold_count integer not null,
  order_count integer not null,
  gross_revenue_minor bigint not null,
  net_revenue_minor bigint,
  currency text not null,
  as_of timestamptz not null,
  requester_principal_id text not null,
  correlation_id text not null,
  workflow_instance_id text,
  evidence jsonb not null,
  unique (provider, external_event_id, as_of),
  foreign key (provider, external_event_id)
    references ticketing_event_bindings (provider, external_event_id) on delete restrict,
  check (sold_count >= 0),
  check (order_count >= 0),
  check (gross_revenue_minor >= 0),
  check (net_revenue_minor is null or net_revenue_minor >= 0),
  check (net_revenue_minor is null or net_revenue_minor <= gross_revenue_minor),
  check (currency ~ '^[A-Z]{3}$'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists ticketing_sales_snapshots_event_idx
  on ticketing_sales_snapshots (tenant_id, event_id, as_of desc);

create table if not exists ticketing_inventory_snapshots (
  snapshot_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  event_id text not null references event_records (event_id) on delete restrict,
  provider text not null,
  external_event_id text not null,
  capacity integer,
  sold integer not null,
  available integer,
  held integer,
  as_of timestamptz not null,
  requester_principal_id text not null,
  correlation_id text not null,
  workflow_instance_id text,
  evidence jsonb not null,
  unique (provider, external_event_id, as_of),
  foreign key (provider, external_event_id)
    references ticketing_event_bindings (provider, external_event_id) on delete restrict,
  check (capacity is null or capacity >= 0),
  check (sold >= 0),
  check (available is null or available >= 0),
  check (held is null or held >= 0),
  check (capacity is null or sold <= capacity),
  check (capacity is null or available is null or sold + available <= capacity),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists ticketing_inventory_snapshots_event_idx
  on ticketing_inventory_snapshots (tenant_id, event_id, as_of desc);

create table if not exists ticketing_webhook_receipts (
  receipt_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  event_id text not null references event_records (event_id) on delete restrict,
  provider text not null,
  external_event_id text not null,
  provider_delivery_id text not null,
  event_type text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null,
  payload_hash text not null,
  normalized_payload jsonb not null,
  data_quality jsonb not null,
  requester_principal_id text not null,
  correlation_id text not null,
  workflow_instance_id text,
  evidence jsonb not null,
  unique (provider, provider_delivery_id),
  foreign key (provider, external_event_id)
    references ticketing_event_bindings (provider, external_event_id) on delete restrict,
  check (length(payload_hash) = 64 and payload_hash ~ '^[a-f0-9]+$'),
  check (jsonb_typeof(normalized_payload) = 'object'),
  check (jsonb_typeof(data_quality) = 'object'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists ticketing_webhook_receipts_event_idx
  on ticketing_webhook_receipts (tenant_id, event_id, occurred_at, receipt_id);

create table if not exists conversion_reconciliations (
  reconciliation_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  event_id text not null references event_records (event_id) on delete restrict,
  window_starts_at timestamptz not null,
  window_ends_at timestamptz not null,
  measured_conversions integer not null,
  ticket_conversions integer not null,
  matched_conversions integer not null,
  unmatched_measurements integer not null,
  unmatched_tickets integer not null,
  measured_revenue_minor bigint,
  ticket_revenue_minor bigint,
  currency text,
  confidence jsonb not null,
  requester_principal_id text not null,
  correlation_id text not null,
  workflow_instance_id text,
  evidence jsonb not null,
  created_at timestamptz not null,
  check (window_ends_at > window_starts_at),
  check (measured_conversions >= 0 and ticket_conversions >= 0 and matched_conversions >= 0),
  check (matched_conversions <= measured_conversions and matched_conversions <= ticket_conversions),
  check (unmatched_measurements = measured_conversions - matched_conversions),
  check (unmatched_tickets = ticket_conversions - matched_conversions),
  check (measured_revenue_minor is null or measured_revenue_minor >= 0),
  check (ticket_revenue_minor is null or ticket_revenue_minor >= 0),
  check (currency is null or currency ~ '^[A-Z]{3}$'),
  check (jsonb_typeof(confidence) = 'object'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists conversion_reconciliations_event_idx
  on conversion_reconciliations (tenant_id, event_id, window_starts_at, window_ends_at);

create or replace function reject_measurement_history_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'MEASUREMENT_HISTORY_MUTATION_FORBIDDEN';
end;
$$;

create trigger measurement_events_append_only
before update or delete on measurement_events
for each row execute function reject_measurement_history_mutation();
create trigger ticketing_event_bindings_append_only
before update or delete on ticketing_event_bindings
for each row execute function reject_measurement_history_mutation();
create trigger ticketing_sales_snapshots_append_only
before update or delete on ticketing_sales_snapshots
for each row execute function reject_measurement_history_mutation();
create trigger ticketing_inventory_snapshots_append_only
before update or delete on ticketing_inventory_snapshots
for each row execute function reject_measurement_history_mutation();
create trigger ticketing_webhook_receipts_append_only
before update or delete on ticketing_webhook_receipts
for each row execute function reject_measurement_history_mutation();
create trigger conversion_reconciliations_append_only
before update or delete on conversion_reconciliations
for each row execute function reject_measurement_history_mutation();
