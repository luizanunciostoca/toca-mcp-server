create table if not exists event_records (
  event_id text primary key,
  event_key text not null,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  series_key text,
  name text not null,
  event_type text not null,
  status text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null,
  venue_name text,
  attributes jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, event_key),
  check (length(trim(event_id)) > 0),
  check (length(trim(event_key)) > 0),
  check (length(trim(tenant_id)) > 0),
  check (length(trim(workspace_id)) > 0),
  check (length(trim(organization_id)) > 0),
  check (series_key is null or length(trim(series_key)) > 0),
  check (length(trim(name)) > 0),
  check (length(trim(event_type)) > 0),
  check (
    status in (
      'DRAFT', 'PLANNED', 'CONFIRMED', 'ON_SALE', 'SOLD_OUT',
      'IN_PROGRESS', 'COMPLETED', 'CANCELED', 'ARCHIVED'
    )
  ),
  check (ends_at > starts_at),
  check (length(trim(timezone)) > 0),
  check (venue_name is null or length(trim(venue_name)) > 0),
  check (jsonb_typeof(attributes) = 'object'),
  check (version >= 1)
);

create index if not exists event_records_series_idx
  on event_records (tenant_id, series_key, starts_at, event_id)
  where series_key is not null;

create index if not exists event_records_schedule_idx
  on event_records (tenant_id, starts_at, ends_at, event_id);

create index if not exists event_records_status_idx
  on event_records (tenant_id, status, starts_at, event_id);

create table if not exists event_record_revisions (
  event_id text not null references event_records (event_id) on delete restrict,
  revision integer not null,
  change_type text not null,
  snapshot jsonb not null,
  evidence jsonb not null,
  correlation_id text not null,
  created_at timestamptz not null,
  primary key (event_id, revision),
  check (revision >= 1),
  check (change_type in ('CREATED', 'DETAILS_UPDATED', 'STATUS_CHANGED')),
  check (jsonb_typeof(snapshot) = 'object'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0),
  check (length(trim(correlation_id)) > 0)
);

create index if not exists event_record_revisions_correlation_idx
  on event_record_revisions (correlation_id, created_at, event_id, revision);

create table if not exists event_record_external_refs (
  ref_id text primary key,
  event_id text not null references event_records (event_id) on delete restrict,
  provider text not null,
  reference_type text not null,
  external_id text not null,
  canonical_url text,
  evidence jsonb not null,
  created_at timestamptz not null,
  unique (event_id, provider, reference_type, external_id),
  unique (provider, reference_type, external_id),
  check (length(trim(ref_id)) > 0),
  check (length(trim(provider)) > 0),
  check (length(trim(reference_type)) > 0),
  check (length(trim(external_id)) > 0),
  check (canonical_url is null or length(trim(canonical_url)) > 0),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists event_record_external_refs_event_idx
  on event_record_external_refs (event_id, provider, reference_type, ref_id);

create or replace function reject_event_record_history_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'EVENT_RECORD_HISTORY_MUTATION_FORBIDDEN';
end;
$$;

drop trigger if exists event_record_revisions_append_only on event_record_revisions;
create trigger event_record_revisions_append_only
before update or delete on event_record_revisions
for each row execute function reject_event_record_history_mutation();

drop trigger if exists event_record_external_refs_append_only on event_record_external_refs;
create trigger event_record_external_refs_append_only
before update or delete on event_record_external_refs
for each row execute function reject_event_record_history_mutation();
