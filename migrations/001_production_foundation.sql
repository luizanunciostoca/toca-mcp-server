create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists scheduled_jobs (
  id text primary key,
  tool_name text not null,
  payload jsonb not null,
  run_at timestamptz not null,
  timezone text not null,
  idempotency_key text not null unique,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED','RUNNING','SUCCEEDED','FAILED','CANCELED')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scheduled_jobs_due_idx on scheduled_jobs (status, run_at);

create table if not exists provider_publications (
  correlation_id text primary key,
  provider text not null,
  account_id text not null,
  external_resource_id text,
  state text not null,
  idempotency_key text not null unique,
  payload jsonb not null,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_events (
  id bigserial primary key,
  correlation_id text not null,
  actor_id text,
  tool_name text not null,
  risk_class text not null,
  decision text not null,
  normalized_payload jsonb,
  provider_result jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_correlation_idx on audit_events (correlation_id, created_at);
