-- AG-01 owns orchestration state only. Canonical CRM/omnichannel ConversationRecord and
-- MessageRecord ownership remains with the existing CRM domain; source IDs are reused for lineage.
create table if not exists ag01_conversations (
  conversation_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  user_principal_id text not null,
  correlation_id text not null,
  status text not null,
  human_reason text null,
  route_id text null,
  primary_agent text null,
  sop_id text null,
  template_id text null,
  context_summary text not null default '',
  summarized_message_count integer not null default 0,
  checkpoint jsonb null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  version integer not null default 1,
  unique (tenant_id, conversation_id),
  check (length(trim(conversation_id)) > 0),
  check (length(trim(tenant_id)) > 0),
  check (length(trim(workspace_id)) > 0),
  check (length(trim(organization_id)) > 0),
  check (length(trim(user_principal_id)) > 0),
  check (length(trim(correlation_id)) > 0),
  check (status in ('ACTIVE', 'WAITING_APPROVAL', 'HUMAN_REQUIRED', 'SUCCEEDED', 'DEAD_LETTERED')),
  check (route_id is null or route_id ~ '^R(0[1-9]|[12][0-9]|3[0-2])$'),
  check (summarized_message_count >= 0),
  check (checkpoint is null or jsonb_typeof(checkpoint) = 'object'),
  check (version > 0)
);

create index if not exists ag01_conversations_tenant_updated_idx
  on ag01_conversations (tenant_id, updated_at desc, conversation_id);

create table if not exists ag01_message_records (
  message_id text primary key,
  conversation_id text not null,
  tenant_id text not null,
  user_principal_id text not null,
  role text not null,
  content text not null,
  source_content_sha256 text not null,
  correlation_id text not null,
  causation_id text null,
  idempotency_key text not null,
  prompt_injection_detected boolean not null default false,
  redaction_count integer not null default 0,
  created_at timestamptz not null,
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, conversation_id)
    references ag01_conversations (tenant_id, conversation_id)
    on delete restrict,
  check (length(trim(message_id)) > 0),
  check (length(trim(conversation_id)) > 0),
  check (length(trim(tenant_id)) > 0),
  check (length(trim(user_principal_id)) > 0),
  check (role in ('USER', 'ASSISTANT', 'SYSTEM')),
  check (length(content) > 0),
  check (source_content_sha256 ~ '^[0-9a-f]{64}$'),
  check (length(trim(correlation_id)) > 0),
  check (length(trim(idempotency_key)) > 0),
  check (redaction_count >= 0)
);

create index if not exists ag01_message_records_conversation_idx
  on ag01_message_records (tenant_id, conversation_id, created_at, message_id);

create table if not exists ag01_runtime_circuits (
  tenant_id text not null,
  capability_id text not null,
  failure_count integer not null default 0,
  opened_until timestamptz null,
  last_failure_code text null,
  updated_at timestamptz not null,
  primary key (tenant_id, capability_id),
  check (length(trim(tenant_id)) > 0),
  check (length(trim(capability_id)) > 0),
  check (failure_count >= 0)
);

create or replace function reject_ag01_message_record_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'AG01_MESSAGE_RECORD_MUTATION_FORBIDDEN';
end;
$$;

drop trigger if exists ag01_message_records_append_only on ag01_message_records;
create trigger ag01_message_records_append_only
before update or delete on ag01_message_records
for each row execute function reject_ag01_message_record_mutation();
