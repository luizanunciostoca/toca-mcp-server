create table if not exists privacy_ledger_events (
  event_id uuid primary key,
  tenant_id text not null,
  subject_ref text not null,
  request_id uuid null,
  purpose_id text null,
  channel text null,
  policy_ref text null,
  approval_id uuid null,
  capability_id text not null,
  event_type text not null,
  requester text not null,
  execution_id text not null,
  correlation_id text not null,
  occurred_at timestamptz not null,
  evidence jsonb not null,
  payload jsonb not null,
  constraint privacy_ledger_tenant_event_unique unique (tenant_id, event_id),
  constraint privacy_ledger_capability_check check (capability_id like 'privacy.%'),
  constraint privacy_ledger_evidence_array_check check (jsonb_typeof(evidence) = 'array'),
  constraint privacy_ledger_payload_object_check check (jsonb_typeof(payload) = 'object')
);

create index if not exists privacy_ledger_subject_idx
  on privacy_ledger_events (tenant_id, subject_ref, occurred_at, event_id);

create index if not exists privacy_ledger_request_idx
  on privacy_ledger_events (tenant_id, request_id, occurred_at, event_id)
  where request_id is not null;

create index if not exists privacy_ledger_purpose_channel_idx
  on privacy_ledger_events (tenant_id, subject_ref, purpose_id, channel, occurred_at, event_id)
  where purpose_id is not null;

create or replace function reject_privacy_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'PRIVACY_LEDGER_APPEND_ONLY';
end;
$$;

drop trigger if exists privacy_ledger_no_update on privacy_ledger_events;
create trigger privacy_ledger_no_update
before update on privacy_ledger_events
for each row execute function reject_privacy_ledger_mutation();

drop trigger if exists privacy_ledger_no_delete on privacy_ledger_events;
create trigger privacy_ledger_no_delete
before delete on privacy_ledger_events
for each row execute function reject_privacy_ledger_mutation();

comment on table privacy_ledger_events is
  'Append-only, tenant-scoped LGPD/privacy evidence ledger. Raw personal data must not be stored in payload/evidence; use opaque refs and governed artifacts.';
