create table if not exists whatsapp_conversation_bindings (
  binding_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  conversation_id text not null,
  contact_id text not null,
  meta_app_id text not null,
  waba_id text not null,
  phone_number_id text not null,
  recipient_sha256 text not null,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  human_handoff_at timestamptz,
  human_handoff_reason text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, conversation_id),
  unique (tenant_id, workspace_id, organization_id, phone_number_id, recipient_sha256),
  foreign key (tenant_id, workspace_id, organization_id, conversation_id)
    references crm_conversations (tenant_id, workspace_id, organization_id, conversation_id) on delete restrict,
  foreign key (tenant_id, workspace_id, organization_id, contact_id)
    references crm_contacts (tenant_id, workspace_id, organization_id, contact_id) on delete restrict,
  check (length(trim(meta_app_id)) > 0),
  check (length(trim(waba_id)) > 0),
  check (length(trim(phone_number_id)) > 0),
  check (recipient_sha256 ~ '^[0-9a-f]{64}$'),
  check ((human_handoff_at is null) = (human_handoff_reason is null))
);

create index if not exists whatsapp_conversation_bindings_contact_idx
  on whatsapp_conversation_bindings (
    tenant_id, workspace_id, organization_id, contact_id, updated_at desc, binding_id
  );

create table if not exists whatsapp_dispatches (
  dispatch_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  message_id text not null,
  conversation_id text not null,
  contact_id text not null,
  provider text not null,
  prepared_payload_ref text not null,
  purpose_id text not null,
  idempotency_key text not null,
  provider_message_ref text,
  state text not null,
  attempt_count integer not null default 0,
  next_retry_at timestamptz,
  last_error_code text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, provider, idempotency_key),
  unique (tenant_id, workspace_id, organization_id, dispatch_id),
  foreign key (tenant_id, workspace_id, organization_id, message_id)
    references crm_messages (tenant_id, workspace_id, organization_id, message_id) on delete restrict,
  foreign key (tenant_id, workspace_id, organization_id, conversation_id)
    references crm_conversations (tenant_id, workspace_id, organization_id, conversation_id) on delete restrict,
  foreign key (tenant_id, workspace_id, organization_id, contact_id)
    references crm_contacts (tenant_id, workspace_id, organization_id, contact_id) on delete restrict,
  check (provider = 'META_WHATSAPP_CLOUD'),
  check (state in ('PREPARED','SUBMITTED','SENT','DELIVERED','READ','FAILED_RETRYABLE','FAILED','DEAD_LETTER')),
  check (attempt_count >= 0),
  check ((state = 'FAILED_RETRYABLE' and next_retry_at is not null) or state <> 'FAILED_RETRYABLE')
);

create unique index if not exists whatsapp_dispatches_provider_message_idx
  on whatsapp_dispatches (tenant_id, workspace_id, organization_id, provider, provider_message_ref)
  where provider_message_ref is not null;
create index if not exists whatsapp_dispatches_retry_idx
  on whatsapp_dispatches (next_retry_at, dispatch_id)
  where state = 'FAILED_RETRYABLE' and next_retry_at is not null;

create table if not exists whatsapp_provider_events (
  event_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  message_id text not null,
  provider_message_ref text not null,
  provider_event_ref text not null,
  status text not null,
  error_code text,
  error_title text,
  observed_at timestamptz not null,
  evidence jsonb not null,
  created_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, provider_event_ref),
  foreign key (tenant_id, workspace_id, organization_id, message_id)
    references crm_messages (tenant_id, workspace_id, organization_id, message_id) on delete restrict,
  check (status in ('SENT','DELIVERED','READ','FAILED')),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists whatsapp_provider_events_message_idx
  on whatsapp_provider_events (
    tenant_id, workspace_id, organization_id, message_id, observed_at, event_id
  );

create table if not exists whatsapp_message_media (
  media_record_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  message_id text not null,
  direction text not null,
  provider_media_id text not null,
  mime_type text,
  file_name text,
  sha256 text,
  size_bytes bigint,
  storage_ref text,
  evidence jsonb not null,
  created_at timestamptz not null,
  foreign key (tenant_id, workspace_id, organization_id, message_id)
    references crm_messages (tenant_id, workspace_id, organization_id, message_id) on delete restrict,
  check (direction in ('INBOUND','OUTBOUND')),
  check (length(trim(provider_media_id)) > 0),
  check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  check (size_bytes is null or size_bytes >= 0),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists whatsapp_message_media_message_idx
  on whatsapp_message_media (
    tenant_id, workspace_id, organization_id, message_id, media_record_id
  );

create table if not exists whatsapp_throttle_buckets (
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  contact_id text not null,
  provider text not null,
  window_started_at timestamptz not null,
  sent_count integer not null default 0,
  updated_at timestamptz not null,
  primary key (tenant_id, workspace_id, organization_id, contact_id, provider),
  foreign key (tenant_id, workspace_id, organization_id, contact_id)
    references crm_contacts (tenant_id, workspace_id, organization_id, contact_id) on delete restrict,
  check (provider = 'META_WHATSAPP_CLOUD'),
  check (sent_count >= 0)
);

create or replace function reject_whatsapp_history_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'WHATSAPP_HISTORY_MUTATION_FORBIDDEN';
end;
$$;

drop trigger if exists whatsapp_provider_events_append_only on whatsapp_provider_events;
create trigger whatsapp_provider_events_append_only
before update or delete on whatsapp_provider_events
for each row execute function reject_whatsapp_history_mutation();

drop trigger if exists whatsapp_message_media_append_only on whatsapp_message_media;
create trigger whatsapp_message_media_append_only
before update or delete on whatsapp_message_media
for each row execute function reject_whatsapp_history_mutation();
