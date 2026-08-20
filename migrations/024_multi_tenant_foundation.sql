-- TOCA OS multi-tenant foundation.
-- This migration is additive. The legacy V1 runtime remains the single tenant `toca`
-- until the multi-tenant boundary is wired into the MCP runtime in a later integration commit.

create table if not exists tenants (
  tenant_id text primary key,
  status text not null check (status in ('ACTIVE', 'SUSPENDED')),
  display_name text not null,
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(tenant_id)) > 0),
  check (length(trim(display_name)) > 0),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

insert into tenants (tenant_id, status, display_name, evidence)
values ('toca', 'ACTIVE', 'Toca do Morcego', '["migration:024:legacy-v1-tenant"]'::jsonb)
on conflict (tenant_id) do nothing;

create table if not exists tenant_configurations (
  tenant_id text primary key references tenants (tenant_id) on delete restrict,
  workspace_id text not null,
  organization_id text not null,
  config_version integer not null,
  allowed_capability_ids jsonb,
  denied_capability_ids jsonb not null default '[]'::jsonb,
  brand_resource_id text not null,
  creative_truth_registry_resource_id text not null,
  asset_registry_resource_id text not null,
  analytics_namespace text not null,
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(workspace_id)) > 0),
  check (length(trim(organization_id)) > 0),
  check (config_version >= 1),
  check (allowed_capability_ids is null or jsonb_typeof(allowed_capability_ids) = 'array'),
  check (jsonb_typeof(denied_capability_ids) = 'array'),
  check (length(trim(brand_resource_id)) > 0),
  check (length(trim(creative_truth_registry_resource_id)) > 0),
  check (length(trim(asset_registry_resource_id)) > 0),
  check (length(trim(analytics_namespace)) > 0),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create table if not exists tenant_provider_bindings (
  tenant_id text not null references tenants (tenant_id) on delete restrict,
  provider_id text not null,
  connected_account_id text not null,
  credential_binding_id text not null,
  enabled boolean not null default false,
  allowed_capability_ids jsonb,
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, provider_id, connected_account_id),
  unique (tenant_id, credential_binding_id),
  check (length(trim(provider_id)) > 0),
  check (length(trim(connected_account_id)) > 0),
  check (length(trim(credential_binding_id)) > 0),
  check (allowed_capability_ids is null or jsonb_typeof(allowed_capability_ids) = 'array'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create table if not exists tenant_credential_bindings (
  tenant_id text not null references tenants (tenant_id) on delete restrict,
  credential_binding_id text not null,
  provider_id text not null,
  secret_provider text not null,
  secret_key_reference text not null,
  enabled boolean not null default false,
  allowed_capability_ids jsonb,
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, credential_binding_id),
  check (length(trim(provider_id)) > 0),
  check (length(trim(secret_provider)) > 0),
  check (length(trim(secret_key_reference)) > 0),
  check (allowed_capability_ids is null or jsonb_typeof(allowed_capability_ids) = 'array'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

alter table tenant_provider_bindings
  drop constraint if exists tenant_provider_bindings_credential_fk;
alter table tenant_provider_bindings
  add constraint tenant_provider_bindings_credential_fk
  foreign key (tenant_id, credential_binding_id)
  references tenant_credential_bindings (tenant_id, credential_binding_id)
  on delete restrict
  deferrable initially deferred;

create table if not exists tenant_budget_envelopes (
  tenant_id text not null references tenants (tenant_id) on delete restrict,
  budget_id text not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  max_single_operation_minor bigint not null check (max_single_operation_minor >= 0),
  allowed_capability_ids jsonb,
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, budget_id),
  check (allowed_capability_ids is null or jsonb_typeof(allowed_capability_ids) = 'array'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create table if not exists tenant_policy_bindings (
  tenant_id text not null references tenants (tenant_id) on delete restrict,
  policy_id text not null,
  policy_resource_id text not null,
  allowed_risk_classes jsonb,
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, policy_id),
  check (length(trim(policy_resource_id)) > 0),
  check (allowed_risk_classes is null or jsonb_typeof(allowed_risk_classes) = 'array'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create table if not exists tenant_approval_chain_bindings (
  tenant_id text not null references tenants (tenant_id) on delete restrict,
  approval_chain_id text not null,
  approval_resource_id text not null,
  route_ids jsonb,
  capability_ids jsonb,
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, approval_chain_id),
  check (length(trim(approval_resource_id)) > 0),
  check (route_ids is null or jsonb_typeof(route_ids) = 'array'),
  check (capability_ids is null or jsonb_typeof(capability_ids) = 'array'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create table if not exists tenant_rbac_grants (
  tenant_id text not null references tenants (tenant_id) on delete restrict,
  grant_id text not null,
  principal_id text not null,
  role text not null check (
    role in (
      'READER', 'OPERATOR', 'EXTERNAL_WRITER', 'FINANCIAL_OPERATOR',
      'DESTRUCTIVE_OPERATOR', 'APPROVER', 'ADMIN'
    )
  ),
  allowed_route_ids jsonb,
  allowed_capability_ids jsonb,
  allowed_target_accounts jsonb,
  enabled boolean not null default true,
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, grant_id),
  check (length(trim(principal_id)) > 0),
  check (allowed_route_ids is null or jsonb_typeof(allowed_route_ids) = 'array'),
  check (allowed_capability_ids is null or jsonb_typeof(allowed_capability_ids) = 'array'),
  check (allowed_target_accounts is null or jsonb_typeof(allowed_target_accounts) = 'array'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists tenant_rbac_grants_principal_idx
  on tenant_rbac_grants (tenant_id, principal_id, enabled);

create table if not exists tenant_asset_registry_bindings (
  tenant_id text not null references tenants (tenant_id) on delete restrict,
  asset_registry_resource_id text not null,
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, asset_registry_resource_id),
  check (length(trim(asset_registry_resource_id)) > 0),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create table if not exists tenant_analytics_namespaces (
  tenant_id text not null references tenants (tenant_id) on delete restrict,
  analytics_namespace text not null,
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, analytics_namespace),
  check (length(trim(analytics_namespace)) > 0),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create table if not exists tenant_quotas (
  tenant_id text not null references tenants (tenant_id) on delete restrict,
  quota_id text not null,
  capability_id text not null,
  quota_limit bigint not null check (quota_limit >= 0),
  quota_interval text not null check (quota_interval in ('HOUR', 'DAY', 'MONTH')),
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, quota_id),
  check (length(trim(capability_id)) > 0),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create table if not exists tenant_campaign_scopes (
  tenant_id text not null references tenants (tenant_id) on delete restrict,
  provider_id text not null,
  connected_account_id text not null,
  campaign_id text not null,
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, provider_id, connected_account_id, campaign_id),
  unique (provider_id, connected_account_id, campaign_id),
  check (length(trim(provider_id)) > 0),
  check (length(trim(connected_account_id)) > 0),
  check (length(trim(campaign_id)) > 0),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

-- Legacy V1 side-effect records become explicitly tenant-scoped without changing behavior.
alter table scheduled_jobs
  add column if not exists tenant_id text not null default 'toca',
  add column if not exists workspace_id text not null default 'toca',
  add column if not exists organization_id text not null default 'toca';
create index if not exists scheduled_jobs_tenant_due_idx
  on scheduled_jobs (tenant_id, status, run_at);

alter table provider_publications
  add column if not exists tenant_id text not null default 'toca',
  add column if not exists workspace_id text not null default 'toca',
  add column if not exists organization_id text not null default 'toca';
create index if not exists provider_publications_tenant_account_idx
  on provider_publications (tenant_id, provider, account_id, created_at desc);

alter table audit_events
  add column if not exists tenant_id text not null default 'toca',
  add column if not exists workspace_id text not null default 'toca',
  add column if not exists organization_id text not null default 'toca';
create index if not exists audit_events_tenant_correlation_idx
  on audit_events (tenant_id, correlation_id, created_at);

alter table approval_records
  add column if not exists tenant_id text not null default 'toca',
  add column if not exists workspace_id text not null default 'toca',
  add column if not exists organization_id text not null default 'toca';
create index if not exists approval_records_tenant_status_idx
  on approval_records (tenant_id, status, expires_at);

-- Append-only audit history is never rewritten. NOT VALID preserves signed historical rows
-- while PostgreSQL enforces tenant_id for every new or modified row from this migration onward.
alter table audit_ledger_events alter column tenant_id set default 'toca';
alter table audit_ledger_events
  drop constraint if exists audit_ledger_events_tenant_required_new;
alter table audit_ledger_events
  add constraint audit_ledger_events_tenant_required_new check (tenant_id is not null) not valid;

alter table audit_ledger_heads alter column tenant_id set default 'toca';
alter table audit_ledger_heads
  drop constraint if exists audit_ledger_heads_tenant_required_new;
alter table audit_ledger_heads
  add constraint audit_ledger_heads_tenant_required_new check (tenant_id is not null) not valid;

alter table operational_signals alter column tenant_id set default 'toca';
alter table operational_signals
  drop constraint if exists operational_signals_tenant_required_new;
alter table operational_signals
  add constraint operational_signals_tenant_required_new check (tenant_id is not null) not valid;
create index if not exists operational_signals_tenant_name_idx
  on operational_signals (tenant_id, name, occurred_at desc, signal_id);

-- PR #21 owns Conversation/Message. If it has landed before this migration, strengthen
-- the existing relationship so a Message cannot point at another tenant's Conversation.
do $$
begin
  if to_regclass('public.ag01_conversations') is not null
     and to_regclass('public.ag01_message_records') is not null then
    if not exists (
      select 1 from pg_constraint where conname = 'ag01_conversations_tenant_conversation_key'
    ) then
      execute 'alter table ag01_conversations add constraint ag01_conversations_tenant_conversation_key unique (tenant_id, conversation_id)';
    end if;
    if not exists (
      select 1 from pg_constraint where conname = 'ag01_messages_tenant_conversation_fk'
    ) then
      execute 'alter table ag01_message_records add constraint ag01_messages_tenant_conversation_fk foreign key (tenant_id, conversation_id) references ag01_conversations (tenant_id, conversation_id) on delete restrict';
    end if;
  end if;
end;
$$;

-- PR #18 owns Asset Intelligence. If present, tenant-bind self lineage so a tenant cannot
-- resolve source/master assets belonging to another tenant.
do $$
begin
  if to_regclass('public.asset_intelligence_assets') is not null then
    if not exists (
      select 1 from pg_constraint where conname = 'asset_intelligence_tenant_asset_key'
    ) then
      execute 'alter table asset_intelligence_assets add constraint asset_intelligence_tenant_asset_key unique (tenant_id, asset_id)';
    end if;
    if not exists (
      select 1 from pg_constraint where conname = 'asset_intelligence_source_same_tenant_fk'
    ) then
      execute 'alter table asset_intelligence_assets add constraint asset_intelligence_source_same_tenant_fk foreign key (tenant_id, source_asset_id) references asset_intelligence_assets (tenant_id, asset_id) on delete restrict';
    end if;
    if not exists (
      select 1 from pg_constraint where conname = 'asset_intelligence_master_same_tenant_fk'
    ) then
      execute 'alter table asset_intelligence_assets add constraint asset_intelligence_master_same_tenant_fk foreign key (tenant_id, master_asset_id) references asset_intelligence_assets (tenant_id, asset_id) on delete restrict';
    end if;
  end if;
end;
$$;
