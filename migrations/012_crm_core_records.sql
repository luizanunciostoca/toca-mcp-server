create table if not exists crm_contacts (
  contact_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  contact_type text not null,
  display_name text not null,
  status text not null default 'ACTIVE',
  attributes jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, contact_id),
  check (length(trim(contact_id)) > 0),
  check (length(trim(tenant_id)) > 0),
  check (length(trim(workspace_id)) > 0),
  check (length(trim(organization_id)) > 0),
  check (contact_type in ('PERSON', 'ORGANIZATION')),
  check (length(trim(display_name)) > 0),
  check (status in ('ACTIVE', 'ARCHIVED')),
  check (jsonb_typeof(attributes) = 'object'),
  check (version >= 1)
);

create index if not exists crm_contacts_scope_name_idx
  on crm_contacts (tenant_id, workspace_id, organization_id, display_name, contact_id);

create table if not exists crm_contact_channels (
  channel_id text primary key,
  contact_id text not null,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  channel_type text not null,
  provider text,
  provider_key text generated always as (coalesce(provider, '')) stored,
  value text not null,
  normalized_value text not null,
  is_primary boolean not null default false,
  verified_at timestamptz,
  evidence jsonb not null,
  created_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, channel_type, provider_key, normalized_value),
  foreign key (tenant_id, workspace_id, organization_id, contact_id)
    references crm_contacts (tenant_id, workspace_id, organization_id, contact_id) on delete restrict,
  check (channel_type in ('EMAIL', 'PHONE', 'SOCIAL', 'OTHER')),
  check (length(trim(value)) > 0),
  check (length(trim(normalized_value)) > 0),
  check ((channel_type in ('EMAIL', 'PHONE') and provider is null) or
         (channel_type in ('SOCIAL', 'OTHER') and provider is not null and length(trim(provider)) > 0)),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create unique index if not exists crm_contact_channels_primary_idx
  on crm_contact_channels (tenant_id, workspace_id, organization_id, contact_id, channel_type)
  where is_primary;

create index if not exists crm_contact_channels_contact_idx
  on crm_contact_channels (tenant_id, workspace_id, organization_id, contact_id, created_at, channel_id);

create table if not exists crm_leads (
  lead_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  contact_id text not null,
  event_id text references event_records (event_id) on delete restrict,
  source_type text not null,
  source_ref text,
  status text not null,
  qualification text not null,
  score double precision,
  owner_principal_id text,
  sla_due_at timestamptz,
  captured_at timestamptz not null,
  qualified_at timestamptz,
  converted_at timestamptz,
  disqualified_reason text,
  attributes jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, lead_id),
  foreign key (tenant_id, workspace_id, organization_id, contact_id)
    references crm_contacts (tenant_id, workspace_id, organization_id, contact_id) on delete restrict,
  check (status in ('NEW', 'WORKING', 'QUALIFIED', 'NURTURING', 'CONVERTED', 'DISQUALIFIED', 'ARCHIVED')),
  check (qualification in ('UNQUALIFIED', 'MARKETING_QUALIFIED', 'SALES_QUALIFIED', 'DISQUALIFIED')),
  check (score is null or (score >= 0 and score <= 100)),
  check (status <> 'DISQUALIFIED' or (qualification = 'DISQUALIFIED' and disqualified_reason is not null)),
  check (status in ('DISQUALIFIED', 'ARCHIVED') or disqualified_reason is null),
  check (status <> 'CONVERTED' or qualification = 'SALES_QUALIFIED'),
  check (jsonb_typeof(attributes) = 'object'),
  check (version >= 1)
);

create index if not exists crm_leads_contact_idx
  on crm_leads (tenant_id, workspace_id, organization_id, contact_id, captured_at desc, lead_id);
create index if not exists crm_leads_owner_sla_idx
  on crm_leads (tenant_id, workspace_id, organization_id, owner_principal_id, sla_due_at, lead_id)
  where status not in ('CONVERTED', 'DISQUALIFIED', 'ARCHIVED');

create table if not exists crm_opportunities (
  opportunity_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  contact_id text not null,
  lead_id text,
  event_id text references event_records (event_id) on delete restrict,
  name text not null,
  pipeline_key text not null,
  stage_key text not null,
  status text not null default 'OPEN',
  currency text,
  value_minor bigint,
  next_action text,
  next_action_at timestamptz,
  owner_principal_id text,
  expected_close_at timestamptz,
  closed_at timestamptz,
  loss_reason text,
  attributes jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, opportunity_id),
  foreign key (tenant_id, workspace_id, organization_id, contact_id)
    references crm_contacts (tenant_id, workspace_id, organization_id, contact_id) on delete restrict,
  foreign key (tenant_id, workspace_id, organization_id, lead_id)
    references crm_leads (tenant_id, workspace_id, organization_id, lead_id) on delete restrict,
  check (status in ('OPEN', 'WON', 'LOST', 'CANCELED', 'ARCHIVED')),
  check ((value_minor is null and currency is null) or
         (value_minor is not null and value_minor >= 0 and currency ~ '^[A-Z]{3}$')),
  check (next_action_at is null or next_action is not null),
  check (status <> 'OPEN' or closed_at is null),
  check (status = 'OPEN' or closed_at is not null),
  check (status <> 'LOST' or loss_reason is not null),
  check (status in ('LOST', 'ARCHIVED') or loss_reason is null),
  check (jsonb_typeof(attributes) = 'object'),
  check (version >= 1)
);

create index if not exists crm_opportunities_contact_idx
  on crm_opportunities (tenant_id, workspace_id, organization_id, contact_id, created_at desc, opportunity_id);
create index if not exists crm_opportunities_pipeline_idx
  on crm_opportunities (tenant_id, workspace_id, organization_id, pipeline_key, stage_key, status, opportunity_id);
create index if not exists crm_opportunities_owner_next_action_idx
  on crm_opportunities (tenant_id, workspace_id, organization_id, owner_principal_id, next_action_at, opportunity_id)
  where status = 'OPEN';

create table if not exists crm_record_revisions (
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  record_type text not null,
  record_id text not null,
  revision integer not null,
  change_type text not null,
  snapshot jsonb not null,
  details jsonb not null default '{}'::jsonb,
  evidence jsonb not null,
  execution_id text not null,
  correlation_id text not null,
  actor_principal_id text not null,
  idempotency_key text not null,
  created_at timestamptz not null,
  primary key (tenant_id, workspace_id, organization_id, record_type, record_id, revision),
  check (record_type in ('CONTACT', 'LEAD', 'OPPORTUNITY')),
  check (revision >= 1),
  check (jsonb_typeof(snapshot) = 'object'),
  check (jsonb_typeof(details) = 'object'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists crm_record_revisions_correlation_idx
  on crm_record_revisions (tenant_id, correlation_id, created_at, record_type, record_id, revision);

create table if not exists crm_idempotency_keys (
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
  check (record_type in ('CONTACT', 'LEAD', 'OPPORTUNITY')),
  check (response_snapshot is null or jsonb_typeof(response_snapshot) = 'object')
);

create or replace function reject_crm_history_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'CRM_HISTORY_MUTATION_FORBIDDEN';
end;
$$;

drop trigger if exists crm_record_revisions_append_only on crm_record_revisions;
create trigger crm_record_revisions_append_only before update or delete on crm_record_revisions
for each row execute function reject_crm_history_mutation();

drop trigger if exists crm_contact_channels_append_only on crm_contact_channels;
create trigger crm_contact_channels_append_only before update or delete on crm_contact_channels
for each row execute function reject_crm_history_mutation();
