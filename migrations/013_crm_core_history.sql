create table if not exists crm_record_revisions (
  record_type text not null,
  record_id text not null,
  tenant_id text not null,
  revision integer not null,
  change_type text not null,
  snapshot jsonb not null,
  evidence jsonb not null,
  correlation_id text not null,
  created_at timestamptz not null,
  primary key (record_type, record_id, revision),
  check (record_type in ('CONTACT', 'LEAD', 'OPPORTUNITY')),
  check (length(trim(record_id)) > 0),
  check (length(trim(tenant_id)) > 0),
  check (revision >= 1),
  check (length(trim(change_type)) > 0),
  check (jsonb_typeof(snapshot) = 'object'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0),
  check (length(trim(correlation_id)) > 0)
);

create index if not exists crm_record_revisions_tenant_record_idx
  on crm_record_revisions (tenant_id, record_type, record_id, revision);

create index if not exists crm_record_revisions_correlation_idx
  on crm_record_revisions (correlation_id, created_at, record_type, record_id, revision);

create or replace function reject_crm_record_revision_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'CRM_RECORD_REVISION_MUTATION_FORBIDDEN';
end;
$$;

drop trigger if exists crm_record_revisions_append_only on crm_record_revisions;
create trigger crm_record_revisions_append_only
before update or delete on crm_record_revisions
for each row execute function reject_crm_record_revision_mutation();
