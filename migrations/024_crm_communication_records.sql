create table if not exists crm_conversations (
  conversation_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  contact_id text not null,
  channel text not null,
  provider text not null,
  provider_account_ref text not null,
  status text not null default 'OPEN',
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  human_handoff_at timestamptz,
  human_handoff_reason text,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, contact_id, channel, provider, provider_account_ref),
  unique (tenant_id, workspace_id, organization_id, conversation_id),
  foreign key (tenant_id, workspace_id, organization_id, contact_id)
    references crm_contacts (tenant_id, workspace_id, organization_id, contact_id) on delete restrict,
  check (channel in ('WHATSAPP', 'EMAIL', 'INSTAGRAM', 'OTHER')),
  check (status in ('OPEN', 'HUMAN_HANDOFF', 'CLOSED')),
  check (length(trim(provider)) > 0),
  check (length(trim(provider_account_ref)) > 0),
  check ((human_handoff_at is null) = (human_handoff_reason is null)),
  check (version >= 1)
);

create index if not exists crm_conversations_contact_idx
  on crm_conversations (tenant_id, workspace_id, organization_id, contact_id, updated_at desc);

create table if not exists crm_messages (
  message_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  conversation_id text not null,
  contact_id text not null,
  channel text not null,
  provider text not null,
  direction text not null,
  content_type text not null,
  status text not null,
  provider_message_id text,
  reply_to_provider_message_id text,
  template_key text,
  template_locale text,
  purpose_id text,
  body_text text,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  attempt_count integer not null default 0,
  next_retry_at timestamptz,
  last_error_code text,
  occurred_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, message_id),
  unique (tenant_id, workspace_id, organization_id, provider, direction, idempotency_key),
  foreign key (tenant_id, workspace_id, organization_id, conversation_id)
    references crm_conversations (tenant_id, workspace_id, organization_id, conversation_id) on delete restrict,
  foreign key (tenant_id, workspace_id, organization_id, contact_id)
    references crm_contacts (tenant_id, workspace_id, organization_id, contact_id) on delete restrict,
  check (channel in ('WHATSAPP', 'EMAIL', 'INSTAGRAM', 'OTHER')),
  check (direction in ('INBOUND', 'OUTBOUND')),
  check (content_type in ('TEXT','IMAGE','AUDIO','VIDEO','DOCUMENT','STICKER','LOCATION','CONTACT','INTERACTIVE','TEMPLATE','UNKNOWN')),
  check (status in ('RECEIVED','PREPARED','SUBMITTED','SENT','DELIVERED','READ','FAILED_RETRYABLE','FAILED','DEAD_LETTER')),
  check ((template_key is null) = (template_locale is null)),
  check (body_text is null or length(body_text) <= 16384),
  check (jsonb_typeof(payload) = 'object'),
  check (attempt_count >= 0)
);

create unique index if not exists crm_messages_provider_message_idx
  on crm_messages (tenant_id, workspace_id, organization_id, provider, provider_message_id)
  where provider_message_id is not null;
create index if not exists crm_messages_conversation_idx
  on crm_messages (tenant_id, workspace_id, organization_id, conversation_id, occurred_at, message_id);
create index if not exists crm_messages_retry_idx
  on crm_messages (next_retry_at, message_id)
  where status = 'FAILED_RETRYABLE' and next_retry_at is not null;

create table if not exists crm_message_attachments (
  attachment_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  message_id text not null,
  provider_media_id text,
  media_url text,
  mime_type text,
  file_name text,
  sha256 text,
  size_bytes bigint,
  evidence jsonb not null,
  created_at timestamptz not null,
  foreign key (tenant_id, workspace_id, organization_id, message_id)
    references crm_messages (tenant_id, workspace_id, organization_id, message_id) on delete restrict,
  check (provider_media_id is not null or media_url is not null),
  check (sha256 is null or sha256 ~ '^[A-Fa-f0-9]{64}$'),
  check (size_bytes is null or size_bytes >= 0),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists crm_message_attachments_message_idx
  on crm_message_attachments (tenant_id, workspace_id, organization_id, message_id, attachment_id);

create table if not exists crm_message_delivery_events (
  delivery_event_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  message_id text not null,
  provider_message_id text not null,
  provider_event_id text not null,
  status text not null,
  error_code text,
  error_title text,
  observed_at timestamptz not null,
  evidence jsonb not null,
  created_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, provider_event_id),
  foreign key (tenant_id, workspace_id, organization_id, message_id)
    references crm_messages (tenant_id, workspace_id, organization_id, message_id) on delete restrict,
  check (status in ('SENT','DELIVERED','READ','FAILED')),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists crm_message_delivery_provider_idx
  on crm_message_delivery_events (tenant_id, workspace_id, organization_id, provider_message_id, observed_at);

create table if not exists crm_communication_throttle_buckets (
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  contact_id text not null,
  channel text not null,
  provider text not null,
  window_started_at timestamptz not null,
  sent_count integer not null default 0,
  updated_at timestamptz not null,
  primary key (tenant_id, workspace_id, organization_id, contact_id, channel, provider),
  foreign key (tenant_id, workspace_id, organization_id, contact_id)
    references crm_contacts (tenant_id, workspace_id, organization_id, contact_id) on delete restrict,
  check (channel in ('WHATSAPP', 'EMAIL', 'INSTAGRAM', 'OTHER')),
  check (sent_count >= 0)
);

create or replace function reject_crm_communication_history_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'CRM_COMMUNICATION_HISTORY_MUTATION_FORBIDDEN';
end;
$$;

drop trigger if exists crm_message_delivery_events_append_only on crm_message_delivery_events;
create trigger crm_message_delivery_events_append_only before update or delete on crm_message_delivery_events
for each row execute function reject_crm_communication_history_mutation();

drop trigger if exists crm_message_attachments_append_only on crm_message_attachments;
create trigger crm_message_attachments_append_only before update or delete on crm_message_attachments
for each row execute function reject_crm_communication_history_mutation();
