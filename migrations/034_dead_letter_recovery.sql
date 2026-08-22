-- Durable DLQ recovery metadata and lifecycle.
-- This migration intentionally extends the existing worker DLQ authority instead of
-- creating a parallel queue or a new route.

alter table dead_letter_jobs
  add column if not exists tenant_id text,
  add column if not exists workspace_id text,
  add column if not exists organization_id text,
  add column if not exists correlation_id text,
  add column if not exists idempotency_key text,
  add column if not exists status text not null default 'OPEN',
  add column if not exists replay_count integer not null default 0,
  add column if not exists replay_execution_id text,
  add column if not exists replay_started_at timestamptz,
  add column if not exists last_replay_error text,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution text,
  add column if not exists evidence jsonb not null default '[]'::jsonb;

-- Preserve all information that can be recovered from legacy payloads. Values that
-- never existed on the historical row receive explicit legacy identities instead of
-- pretending that the original metadata is known.
update dead_letter_jobs
set tenant_id = coalesce(
      nullif(payload ->> 'tenantId', ''),
      nullif(payload ->> 'tenant_id', ''),
      'toca'
    ),
    workspace_id = coalesce(
      nullif(payload ->> 'workspaceId', ''),
      nullif(payload ->> 'workspace_id', ''),
      workspace_id
    ),
    organization_id = coalesce(
      nullif(payload ->> 'organizationId', ''),
      nullif(payload ->> 'organization_id', ''),
      organization_id
    ),
    correlation_id = coalesce(
      nullif(payload ->> 'correlationId', ''),
      nullif(payload ->> 'correlation_id', ''),
      correlation_id,
      'legacy-dead-letter:' || id
    ),
    idempotency_key = coalesce(
      nullif(payload ->> 'idempotencyKey', ''),
      nullif(payload ->> 'idempotency_key', ''),
      idempotency_key,
      'legacy-dead-letter:' || original_job_id
    ),
    evidence = case
      when jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0 then evidence
      else jsonb_build_array('migration:034:legacy-dead-letter-backfill')
    end
where tenant_id is null
   or correlation_id is null
   or idempotency_key is null
   or jsonb_array_length(evidence) = 0;

-- Compatibility boundary: historical code/tests may still insert the original
-- seven-column DLQ shape. Normalize those writes inside the canonical table before
-- NOT NULL/check constraints run, rather than weakening the new metadata contract.
create or replace function normalize_dead_letter_recovery_metadata()
returns trigger
language plpgsql
as $$
begin
  new.tenant_id := coalesce(
    nullif(new.tenant_id, ''),
    nullif(new.payload ->> 'tenantId', ''),
    nullif(new.payload ->> 'tenant_id', ''),
    'toca'
  );
  new.workspace_id := coalesce(
    nullif(new.workspace_id, ''),
    nullif(new.payload ->> 'workspaceId', ''),
    nullif(new.payload ->> 'workspace_id', '')
  );
  new.organization_id := coalesce(
    nullif(new.organization_id, ''),
    nullif(new.payload ->> 'organizationId', ''),
    nullif(new.payload ->> 'organization_id', '')
  );
  new.correlation_id := coalesce(
    nullif(new.correlation_id, ''),
    nullif(new.payload ->> 'correlationId', ''),
    nullif(new.payload ->> 'correlation_id', ''),
    'legacy-dead-letter:' || new.id
  );
  new.idempotency_key := coalesce(
    nullif(new.idempotency_key, ''),
    nullif(new.payload ->> 'idempotencyKey', ''),
    nullif(new.payload ->> 'idempotency_key', ''),
    'legacy-dead-letter:' || new.original_job_id
  );
  if new.evidence is null
     or jsonb_typeof(new.evidence) <> 'array'
     or jsonb_array_length(new.evidence) = 0 then
    new.evidence := jsonb_build_array('migration:034:legacy-dead-letter-insert');
  end if;
  return new;
end;
$$;

drop trigger if exists dead_letter_recovery_metadata_before_insert on dead_letter_jobs;
create trigger dead_letter_recovery_metadata_before_insert
before insert on dead_letter_jobs
for each row
execute function normalize_dead_letter_recovery_metadata();

alter table dead_letter_jobs
  alter column tenant_id set not null,
  alter column correlation_id set not null,
  alter column idempotency_key set not null;

alter table dead_letter_jobs
  drop constraint if exists dead_letter_jobs_status_check,
  add constraint dead_letter_jobs_status_check
    check (status in ('OPEN', 'REPLAYING', 'RESOLVED')),
  drop constraint if exists dead_letter_jobs_replay_count_check,
  add constraint dead_letter_jobs_replay_count_check check (replay_count >= 0),
  drop constraint if exists dead_letter_jobs_evidence_check,
  add constraint dead_letter_jobs_evidence_check
    check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0),
  drop constraint if exists dead_letter_jobs_replaying_state_check,
  add constraint dead_letter_jobs_replaying_state_check check (
    status <> 'REPLAYING'
    or (replay_execution_id is not null and replay_started_at is not null)
  ),
  drop constraint if exists dead_letter_jobs_resolved_state_check,
  add constraint dead_letter_jobs_resolved_state_check check (
    status <> 'RESOLVED'
    or (resolved_at is not null and resolution is not null)
  );

-- A source job has one logical DLQ identity. This closes the concurrent-finalize race
-- that application-level read-before-insert could not prevent by itself.
create unique index if not exists dead_letter_jobs_original_job_uq
  on dead_letter_jobs (original_job_id);
create unique index if not exists dead_letter_jobs_replay_execution_uq
  on dead_letter_jobs (replay_execution_id)
  where replay_execution_id is not null;
create index if not exists dead_letter_jobs_tenant_status_idx
  on dead_letter_jobs (tenant_id, status, failed_at desc, id);
create index if not exists dead_letter_jobs_correlation_idx
  on dead_letter_jobs (correlation_id, failed_at desc, id);
