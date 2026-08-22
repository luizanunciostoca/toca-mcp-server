-- Provider-neutral immutable prepared-content authority for controlled Omnichannel outbound.
-- Serialized after 032. The historical 027 gap remains intentionally untouched.

create table if not exists omnichannel_prepared_content (
  prepared_content_ref text primary key,
  tenant_id text not null references tenants (tenant_id) on delete restrict,
  workspace_id text not null,
  organization_id text not null,
  content_kind text not null check (content_kind in ('EMAIL_CAMPAIGN', 'WHATSAPP_MESSAGE')),
  schema_version integer not null check (schema_version >= 1),
  payload jsonb not null,
  content_sha256 char(64) not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  check (length(trim(prepared_content_ref)) > 0),
  check (length(trim(workspace_id)) > 0),
  check (length(trim(organization_id)) > 0),
  check (jsonb_typeof(payload) = 'object'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0),
  unique (tenant_id, workspace_id, organization_id, content_kind, content_sha256)
);

create index if not exists omnichannel_prepared_content_scope_created_idx
  on omnichannel_prepared_content (
    tenant_id,
    workspace_id,
    organization_id,
    content_kind,
    created_at desc
  );

comment on table omnichannel_prepared_content is
  'Append-only provider-neutral prepared content. Runtime APIs intentionally expose no update/delete path.';

-- Internal-acceptance hardening: scheduler/DLQ ownership must be a first-class tenant boundary.
-- This remains inside migration 033 so the intentional 027 gap and migration ceiling stay unchanged.
alter table scheduled_jobs
  alter column tenant_id drop default;

alter table scheduled_jobs
  drop constraint if exists scheduled_jobs_idempotency_key_key;

create unique index if not exists scheduled_jobs_tenant_idempotency_uq
  on scheduled_jobs (tenant_id, idempotency_key);

create unique index if not exists scheduled_jobs_tenant_id_uq
  on scheduled_jobs (tenant_id, id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'scheduled_jobs_tenant_fk'
  ) then
    alter table scheduled_jobs
      add constraint scheduled_jobs_tenant_fk
      foreign key (tenant_id) references tenants (tenant_id) on delete restrict;
  end if;
end;
$$;

alter table dead_letter_jobs
  add column if not exists tenant_id text;

update dead_letter_jobs as dead_letter
set tenant_id = source.tenant_id
from scheduled_jobs as source
where dead_letter.tenant_id is null
  and source.id = dead_letter.original_job_id;

alter table dead_letter_jobs
  alter column tenant_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'dead_letter_jobs_tenant_source_fk'
  ) then
    alter table dead_letter_jobs
      add constraint dead_letter_jobs_tenant_source_fk
      foreign key (tenant_id, original_job_id)
      references scheduled_jobs (tenant_id, id)
      on delete restrict;
  end if;
end;
$$;

create index if not exists dead_letter_jobs_tenant_source_idx
  on dead_letter_jobs (tenant_id, original_job_id, failed_at desc);
