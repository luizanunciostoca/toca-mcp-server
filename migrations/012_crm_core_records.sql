do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'event_records_tenant_event_unique'
  ) then
    alter table event_records
      add constraint event_records_tenant_event_unique unique (tenant_id, event_id);
  end if;
end;
$$;

create table if not exists crm_contacts (
  contact_id text primary key,
  contact_key text not null,
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
  unique (tenant_id, contact_key),
  unique (tenant_id, contact_id),
  check (length(trim(contact_id)) > 0),
  check (length(trim(contact_key)) > 0),
  check (length(trim(tenant_id)) > 0),
  check (length(trim(workspace_id)) > 0),
  check (length(trim(organization_id)) > 0),
  check (contact_type in ('PERSON', 'ORGANIZATION')),
  check (length(trim(display_name)) > 0),
  check (status in ('ACTIVE', 'ARCHIVED')),
  check (jsonb_typeof(attributes) = 'object'),
  check (version >= 1)
);

create index if not exists crm_contacts_status_idx
  on crm_contacts (tenant_id, status, updated_at desc, contact_id);

create table if not exists crm_contact_identities (
  identity_id text primary key,
  tenant_id text not null,
  contact_id text not null,
  identity_type text not null,
  provider text,
  provider_key text generated always as (coalesce(provider, '')) stored,
  identity_value text not null,
  normalized_value text not null,
  is_primary boolean not null default false,
  status text not null default 'ACTIVE',
  verified_at timestamptz,
  revoked_at timestamptz,
  evidence jsonb not null,
  created_at timestamptz not null,
  unique (tenant_id, identity_type, provider_key, normalized_value),
  unique (tenant_id, contact_id, identity_id),
  foreign key (tenant_id, contact_id)
    references crm_contacts (tenant_id, contact_id) on delete restrict,
  check (identity_type in ('EMAIL', 'PHONE', 'SOCIAL_HANDLE', 'PROVIDER_ID')),
  check (status in ('ACTIVE', 'REVOKED')),
  check (length(trim(identity_value)) > 0),
  check (length(trim(normalized_value)) > 0),
  check (
    (identity_type in ('EMAIL', 'PHONE') and provider is null)
    or (identity_type in ('SOCIAL_HANDLE', 'PROVIDER_ID') and provider is not null and length(trim(provider)) > 0)
  ),
  check (status <> 'REVOKED' or revoked_at is not null),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create unique index if not exists crm_contact_identities_active_primary_uidx
  on crm_contact_identities (tenant_id, contact_id, identity_type)
  where status = 'ACTIVE' and is_primary;

create index if not exists crm_contact_identities_contact_idx
  on crm_contact_identities (tenant_id, contact_id, status, identity_type, identity_id);

create table if not exists crm_leads (
  lead_id text primary key,
  lead_key text not null,
  tenant_id text not null,
  contact_id text not null,
  event_id text,
  source_type text not null,
  source_ref text,
  status text not null default 'NEW',
  owner_principal_id text,
  captured_at timestamptz not null,
  converted_at timestamptz,
  disqualified_reason text,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, lead_key),
  unique (tenant_id, lead_id),
  unique (tenant_id, contact_id, lead_id),
  foreign key (tenant_id, contact_id)
    references crm_contacts (tenant_id, contact_id) on delete restrict,
  foreign key (tenant_id, event_id)
    references event_records (tenant_id, event_id) on delete restrict,
  check (length(trim(lead_id)) > 0),
  check (length(trim(lead_key)) > 0),
  check (length(trim(source_type)) > 0),
  check (source_ref is null or length(trim(source_ref)) > 0),
  check (
    status in ('NEW', 'QUALIFYING', 'QUALIFIED', 'NURTURING', 'CONVERTED', 'DISQUALIFIED', 'ARCHIVED')
  ),
  check (status <> 'CONVERTED' or converted_at is not null),
  check (status <> 'DISQUALIFIED' or (disqualified_reason is not null and length(trim(disqualified_reason)) > 0)),
  check (version >= 1)
);

create index if not exists crm_leads_contact_idx
  on crm_leads (tenant_id, contact_id, created_at, lead_id);

create index if not exists crm_leads_event_idx
  on crm_leads (tenant_id, event_id, status, created_at, lead_id)
  where event_id is not null;

create index if not exists crm_leads_status_idx
  on crm_leads (tenant_id, status, updated_at desc, lead_id);

create table if not exists crm_opportunities (
  opportunity_id text primary key,
  opportunity_key text not null,
  tenant_id text not null,
  contact_id text not null,
  lead_id text,
  event_id text,
  name text not null,
  stage_key text not null,
  status text not null default 'OPEN',
  currency text not null,
  value_minor bigint,
  owner_principal_id text,
  expected_close_at timestamptz,
  closed_at timestamptz,
  loss_reason text,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, opportunity_key),
  unique (tenant_id, opportunity_id),
  unique (tenant_id, contact_id, opportunity_id),
  foreign key (tenant_id, contact_id)
    references crm_contacts (tenant_id, contact_id) on delete restrict,
  foreign key (tenant_id, contact_id, lead_id)
    references crm_leads (tenant_id, contact_id, lead_id) on delete restrict,
  foreign key (tenant_id, event_id)
    references event_records (tenant_id, event_id) on delete restrict,
  check (length(trim(opportunity_id)) > 0),
  check (length(trim(opportunity_key)) > 0),
  check (length(trim(name)) > 0),
  check (length(trim(stage_key)) > 0),
  check (status in ('OPEN', 'WON', 'LOST', 'CANCELED', 'ARCHIVED')),
  check (currency ~ '^[A-Z]{3}$'),
  check (value_minor is null or value_minor >= 0),
  check (status not in ('WON', 'LOST', 'CANCELED', 'ARCHIVED') or closed_at is not null),
  check (status <> 'LOST' or (loss_reason is not null and length(trim(loss_reason)) > 0)),
  check (version >= 1)
);

create index if not exists crm_opportunities_contact_idx
  on crm_opportunities (tenant_id, contact_id, created_at, opportunity_id);

create index if not exists crm_opportunities_event_idx
  on crm_opportunities (tenant_id, event_id, status, created_at, opportunity_id)
  where event_id is not null;

create index if not exists crm_opportunities_status_idx
  on crm_opportunities (tenant_id, status, stage_key, updated_at desc, opportunity_id);

create table if not exists crm_activities (
  activity_id text primary key,
  activity_key text not null,
  tenant_id text not null,
  contact_id text not null,
  lead_id text,
  opportunity_id text,
  event_id text,
  activity_type text not null,
  direction text not null,
  channel text not null,
  summary text not null,
  correlation_id text not null,
  evidence jsonb not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null,
  unique (tenant_id, activity_key),
  unique (tenant_id, activity_id),
  foreign key (tenant_id, contact_id)
    references crm_contacts (tenant_id, contact_id) on delete restrict,
  foreign key (tenant_id, contact_id, lead_id)
    references crm_leads (tenant_id, contact_id, lead_id) on delete restrict,
  foreign key (tenant_id, contact_id, opportunity_id)
    references crm_opportunities (tenant_id, contact_id, opportunity_id) on delete restrict,
  foreign key (tenant_id, event_id)
    references event_records (tenant_id, event_id) on delete restrict,
  check (length(trim(activity_id)) > 0),
  check (length(trim(activity_key)) > 0),
  check (length(trim(activity_type)) > 0),
  check (direction in ('INBOUND', 'OUTBOUND', 'INTERNAL')),
  check (length(trim(channel)) > 0),
  check (length(trim(summary)) > 0),
  check (length(trim(correlation_id)) > 0),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists crm_activities_contact_idx
  on crm_activities (tenant_id, contact_id, occurred_at desc, activity_id);

create index if not exists crm_activities_opportunity_idx
  on crm_activities (tenant_id, opportunity_id, occurred_at desc, activity_id)
  where opportunity_id is not null;

create or replace function reject_crm_history_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'CRM_APPEND_ONLY_HISTORY_MUTATION_FORBIDDEN';
end;
$$;

drop trigger if exists crm_activities_append_only on crm_activities;
create trigger crm_activities_append_only
before update or delete on crm_activities
for each row execute function reject_crm_history_mutation();
