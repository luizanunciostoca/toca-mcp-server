create table if not exists audit_ledger_events (
  event_id text primary key,
  execution_id text not null,
  correlation_id text not null,
  sequence integer not null,
  previous_hash text not null,
  event_hash text not null,
  actor_id text not null,
  principal_type text,
  tenant_id text,
  workspace_id text,
  organization_id text,
  session_id text,
  authentication_method text,
  authorization_roles jsonb not null default '[]'::jsonb,
  tool_name text not null,
  risk_class text not null,
  status text not null,
  approval_id text,
  connected_account text,
  external_resource_id text,
  error_code text,
  evidence jsonb not null,
  canonical_payload jsonb not null,
  created_at timestamptz not null,
  unique (execution_id, sequence),
  unique (execution_id, event_hash),
  check (sequence >= 1),
  check (length(previous_hash) = 64),
  check (length(event_hash) = 64),
  check (length(trim(execution_id)) > 0),
  check (length(trim(correlation_id)) > 0),
  check (length(trim(actor_id)) > 0),
  check (length(trim(tool_name)) > 0),
  check (jsonb_typeof(authorization_roles) = 'array'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0),
  check (jsonb_typeof(canonical_payload) = 'object'),
  check (status in ('STARTED', 'SUCCEEDED', 'FAILED', 'DENIED'))
);

create index if not exists audit_ledger_events_correlation_idx
  on audit_ledger_events (correlation_id, created_at, sequence);

create index if not exists audit_ledger_events_tenant_idx
  on audit_ledger_events (tenant_id, created_at desc, execution_id, sequence);

create table if not exists audit_ledger_heads (
  execution_id text primary key,
  correlation_id text not null,
  tenant_id text,
  last_sequence integer not null,
  head_hash text not null,
  updated_at timestamptz not null,
  check (last_sequence >= 1),
  check (length(head_hash) = 64),
  check (length(trim(correlation_id)) > 0)
);

create index if not exists audit_ledger_heads_correlation_idx
  on audit_ledger_heads (correlation_id, updated_at desc, execution_id);

create table if not exists operational_signals (
  signal_id text primary key,
  audit_event_id text references audit_ledger_events (event_id) on delete restrict,
  execution_id text,
  correlation_id text,
  tenant_id text,
  signal_type text not null,
  name text not null,
  value double precision not null,
  attributes jsonb not null default '{}'::jsonb,
  evidence jsonb not null,
  occurred_at timestamptz not null,
  check (signal_type in ('COUNTER', 'OBSERVATION', 'STATE')),
  check (length(trim(name)) > 0),
  check (jsonb_typeof(attributes) = 'object'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists operational_signals_correlation_idx
  on operational_signals (correlation_id, occurred_at, signal_id);

create index if not exists operational_signals_execution_idx
  on operational_signals (execution_id, occurred_at, signal_id);

create index if not exists operational_signals_name_idx
  on operational_signals (name, occurred_at desc, signal_id);

create or replace function reject_append_only_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'APPEND_ONLY_LEDGER_MUTATION_FORBIDDEN';
end;
$$;

drop trigger if exists audit_ledger_events_append_only on audit_ledger_events;
create trigger audit_ledger_events_append_only
before update or delete on audit_ledger_events
for each row execute function reject_append_only_mutation();

drop trigger if exists operational_signals_append_only on operational_signals;
create trigger operational_signals_append_only
before update or delete on operational_signals
for each row execute function reject_append_only_mutation();

drop trigger if exists audit_ledger_heads_no_delete on audit_ledger_heads;
create trigger audit_ledger_heads_no_delete
before delete on audit_ledger_heads
for each row execute function reject_append_only_mutation();
