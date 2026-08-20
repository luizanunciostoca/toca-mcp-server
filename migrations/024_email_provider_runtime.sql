create table if not exists email_templates (
  template_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  template_key text not null,
  version integer not null,
  subject_template text not null,
  html_content_ref text,
  text_content_ref text,
  required_variables jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, template_key, version),
  check (version >= 1),
  check (length(trim(template_key)) > 0),
  check (length(trim(subject_template)) > 0),
  check (html_content_ref is not null or text_content_ref is not null),
  check (jsonb_typeof(required_variables) = 'array')
);

create index if not exists email_templates_active_idx
  on email_templates (tenant_id, workspace_id, organization_id, template_key, version desc)
  where active = true;

-- Provider thread metadata only. Conversation identity remains canonical in
-- crm_conversations; no email-specific Conversation abstraction is created.
create table if not exists email_thread_bindings (
  binding_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  conversation_id text not null,
  contact_id text not null,
  provider text not null,
  provider_message_ref text,
  internet_message_id text not null,
  in_reply_to text,
  reference_message_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, provider, internet_message_id),
  foreign key (tenant_id, workspace_id, organization_id, conversation_id)
    references crm_conversations (tenant_id, workspace_id, organization_id, conversation_id) on delete restrict,
  foreign key (tenant_id, workspace_id, organization_id, contact_id)
    references crm_contacts (tenant_id, workspace_id, organization_id, contact_id) on delete restrict,
  check (length(trim(provider)) > 0),
  check (length(trim(internet_message_id)) > 0),
  check (jsonb_typeof(reference_message_ids) = 'array')
);

create unique index if not exists email_thread_bindings_provider_message_idx
  on email_thread_bindings (tenant_id, workspace_id, organization_id, provider, provider_message_ref)
  where provider_message_ref is not null;
create index if not exists email_thread_bindings_conversation_idx
  on email_thread_bindings (tenant_id, workspace_id, organization_id, conversation_id, created_at desc);

-- Dispatch state references the canonical crm_messages row. This table is an
-- external-provider execution ledger, not an email MessageRecord replacement.
create table if not exists email_dispatches (
  dispatch_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  message_id text not null,
  idempotency_key text not null,
  provider text not null,
  provider_message_ref text,
  state text not null,
  attempt_count integer not null default 0,
  next_retry_at timestamptz,
  last_error text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, idempotency_key),
  foreign key (tenant_id, workspace_id, organization_id, message_id)
    references crm_messages (tenant_id, workspace_id, organization_id, message_id) on delete restrict,
  check (state in ('PREPARED','SUBMITTED','ACCEPTED','PROCESSED','DELIVERED','DEFERRED','BOUNCED','COMPLAINT','UNSUBSCRIBED','DROPPED','FAILED','UNKNOWN')),
  check (attempt_count >= 0),
  check (length(trim(idempotency_key)) > 0),
  check (length(trim(provider)) > 0)
);

create unique index if not exists email_dispatches_provider_message_idx
  on email_dispatches (tenant_id, workspace_id, organization_id, provider, provider_message_ref)
  where provider_message_ref is not null;
create index if not exists email_dispatches_retry_idx
  on email_dispatches (tenant_id, workspace_id, organization_id, next_retry_at, dispatch_id)
  where next_retry_at is not null and state in ('PREPARED','SUBMITTED','ACCEPTED','DEFERRED','UNKNOWN');

-- Immutable provider evidence. Bounce/complaint/unsubscribe signals are
-- reconciled into canonical Privacy; this is not a competing suppression list.
create table if not exists email_provider_events (
  event_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  provider_event_id text not null,
  provider text not null,
  provider_message_ref text not null,
  message_id text,
  event_type text not null,
  delivery_state text,
  occurred_at timestamptz not null,
  payload_sha256 text not null,
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, workspace_id, organization_id, provider, provider_event_id),
  foreign key (tenant_id, workspace_id, organization_id, message_id)
    references crm_messages (tenant_id, workspace_id, organization_id, message_id) on delete restrict,
  check (delivery_state is null or delivery_state in ('PREPARED','SUBMITTED','ACCEPTED','PROCESSED','DELIVERED','DEFERRED','BOUNCED','COMPLAINT','UNSUBSCRIBED','DROPPED','FAILED','UNKNOWN')),
  check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists email_provider_events_message_idx
  on email_provider_events (tenant_id, workspace_id, organization_id, message_id, occurred_at, event_id)
  where message_id is not null;
create index if not exists email_provider_events_provider_message_idx
  on email_provider_events (tenant_id, workspace_id, organization_id, provider, provider_message_ref, occurred_at, event_id);

create table if not exists email_attachments (
  attachment_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  message_id text not null,
  file_name text not null,
  content_type text not null,
  size_bytes bigint not null,
  content_sha256 text not null,
  content_ref text not null,
  disposition text not null,
  content_id text,
  created_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, message_id, attachment_id),
  foreign key (tenant_id, workspace_id, organization_id, message_id)
    references crm_messages (tenant_id, workspace_id, organization_id, message_id) on delete restrict,
  check (size_bytes >= 0),
  check (content_sha256 ~ '^[0-9a-f]{64}$'),
  check (disposition in ('attachment','inline')),
  check (length(trim(file_name)) > 0),
  check (length(trim(content_type)) > 0),
  check (length(trim(content_ref)) > 0)
);

create index if not exists email_attachments_message_idx
  on email_attachments (tenant_id, workspace_id, organization_id, message_id, attachment_id);

-- Durable token-bucket/window accounting. Provider 429 Retry-After remains an
-- additional runtime constraint and never bypasses this local safety boundary.
create table if not exists email_rate_limit_buckets (
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  provider text not null,
  bucket_key text not null,
  window_started_at timestamptz not null,
  window_seconds integer not null,
  capacity integer not null,
  consumed integer not null default 0,
  updated_at timestamptz not null,
  primary key (tenant_id, workspace_id, organization_id, provider, bucket_key),
  check (window_seconds >= 1),
  check (capacity >= 1),
  check (consumed >= 0 and consumed <= capacity)
);
