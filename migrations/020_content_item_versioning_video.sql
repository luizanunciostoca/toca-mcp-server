create table if not exists content_items (
  content_item_id text primary key,
  content_key text not null,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  assigned_route_id text not null,
  product_ref text,
  slot_ref text,
  channel text not null,
  format text not null,
  language text not null,
  state text not null,
  current_content_version integer not null,
  current_version_id text not null,
  event_id text references event_records (event_id) on delete restrict,
  experiment_id text,
  record_version integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, content_key),
  check (length(trim(content_item_id)) > 0),
  check (length(trim(content_key)) > 0),
  check (length(trim(tenant_id)) > 0),
  check (length(trim(workspace_id)) > 0),
  check (length(trim(organization_id)) > 0),
  check (assigned_route_id = 'R29'),
  check (length(trim(channel)) > 0),
  check (format in ('SINGLE_IMAGE', 'CAROUSEL', 'STORY', 'REEL', 'AD_CREATIVE', 'VIDEO')),
  check (length(trim(language)) > 0),
  check (
    state in (
      'PLANNED', 'BRIEFED', 'IN_PRODUCTION', 'REVIEW', 'APPROVED',
      'READY_FOR_SCHEDULING', 'SCHEDULED', 'PUBLISHED', 'MEASURED',
      'ARCHIVED', 'CANCELED'
    )
  ),
  check (current_content_version >= 1),
  check (record_version >= 1)
);

create index if not exists content_items_event_idx
  on content_items (tenant_id, event_id, created_at, content_item_id)
  where event_id is not null;

create index if not exists content_items_experiment_idx
  on content_items (tenant_id, experiment_id, created_at, content_item_id)
  where experiment_id is not null;

create table if not exists content_item_versions (
  version_id text primary key,
  content_item_id text not null references content_items (content_item_id) on delete restrict,
  version_number integer not null,
  idempotency_key text not null,
  derivation_type text not null,
  parent_version_id text,
  source_version_id text,
  lineage_root_version_id text not null,
  variant_key text,
  channel text not null,
  format text not null,
  language text not null,
  source_asset_ids jsonb not null,
  derived_asset_ids jsonb not null,
  payload jsonb not null,
  source_refs jsonb not null,
  evidence jsonb not null,
  created_at timestamptz not null,
  unique (content_item_id, version_number),
  unique (content_item_id, idempotency_key),
  check (version_number >= 1),
  check (derivation_type in ('ORIGINAL', 'VERSION', 'VARIANT', 'CHANNEL_ADAPTATION', 'LOCALIZATION', 'REPURPOSE')),
  check (format in ('SINGLE_IMAGE', 'CAROUSEL', 'STORY', 'REEL', 'AD_CREATIVE', 'VIDEO')),
  check (length(trim(lineage_root_version_id)) > 0),
  check (jsonb_typeof(source_asset_ids) = 'array'),
  check (jsonb_typeof(derived_asset_ids) = 'array'),
  check (jsonb_typeof(source_refs) = 'array'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists content_item_versions_lineage_idx
  on content_item_versions (content_item_id, lineage_root_version_id, version_number, version_id);

create table if not exists content_item_validations (
  validation_id text primary key,
  content_item_id text not null references content_items (content_item_id) on delete restrict,
  version_id text not null references content_item_versions (version_id) on delete restrict,
  validation_type text not null,
  status text not null,
  issues jsonb not null,
  evidence jsonb not null,
  details jsonb not null,
  correlation_id text not null,
  created_at timestamptz not null,
  check (validation_type in ('FACT', 'RIGHTS', 'ACCESSIBILITY', 'QUALITY', 'SAFE_AREA', 'DURATION', 'MUSIC_RIGHTS')),
  check (status in ('PASS', 'FAIL', 'REVIEW_REQUIRED')),
  check (jsonb_typeof(issues) = 'array'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0),
  check (length(trim(correlation_id)) > 0)
);

create index if not exists content_item_validations_lookup_idx
  on content_item_validations (content_item_id, version_id, validation_type, created_at, validation_id);

create table if not exists content_item_history (
  content_item_id text not null references content_items (content_item_id) on delete restrict,
  record_version integer not null,
  change_type text not null,
  snapshot jsonb not null,
  evidence jsonb not null,
  correlation_id text not null,
  created_at timestamptz not null,
  primary key (content_item_id, record_version),
  check (record_version >= 1),
  check (change_type in ('CREATED', 'VERSION_CREATED', 'STATE_CHANGED', 'EVENT_LINKED', 'EXPERIMENT_LINKED')),
  check (jsonb_typeof(snapshot) = 'object'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0),
  check (length(trim(correlation_id)) > 0)
);

create or replace function reject_content_item_history_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'CONTENT_ITEM_HISTORY_MUTATION_FORBIDDEN';
end;
$$;

drop trigger if exists content_item_versions_append_only on content_item_versions;
create trigger content_item_versions_append_only
before update or delete on content_item_versions
for each row execute function reject_content_item_history_mutation();

drop trigger if exists content_item_validations_append_only on content_item_validations;
create trigger content_item_validations_append_only
before update or delete on content_item_validations
for each row execute function reject_content_item_history_mutation();

drop trigger if exists content_item_history_append_only on content_item_history;
create trigger content_item_history_append_only
before update or delete on content_item_history
for each row execute function reject_content_item_history_mutation();
