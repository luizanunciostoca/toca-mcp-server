create table if not exists event_outbox (
  event_id text primary key,
  event_type text not null,
  schema_version text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  aggregate_version integer not null,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  correlation_id text not null,
  causation_id text,
  occurred_at timestamptz not null,
  payload jsonb not null,
  evidence jsonb not null,
  status text not null default 'PENDING',
  available_at timestamptz not null,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  claimed_by text,
  claim_execution_id text,
  claimed_at timestamptz,
  delivered_at timestamptz,
  last_error_code text,
  version integer not null default 1,
  check (length(trim(event_id)) > 0),
  check (length(trim(event_type)) > 0),
  check (length(trim(schema_version)) > 0),
  check (length(trim(aggregate_type)) > 0),
  check (length(trim(aggregate_id)) > 0),
  check (aggregate_version >= 1),
  check (length(trim(tenant_id)) > 0),
  check (length(trim(workspace_id)) > 0),
  check (length(trim(organization_id)) > 0),
  check (length(trim(correlation_id)) > 0),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0),
  check (status in ('PENDING', 'CLAIMED', 'FAILED_RETRYABLE', 'DELIVERED', 'DEAD_LETTER')),
  check (attempts >= 0 and max_attempts >= 1 and attempts <= max_attempts),
  check (version >= 1),
  check (
    status <> 'CLAIMED'
    or (claimed_by is not null and claim_execution_id is not null and claimed_at is not null)
  ),
  check (status <> 'DELIVERED' or delivered_at is not null),
  check (status <> 'DEAD_LETTER' or last_error_code is not null)
);

create index if not exists event_outbox_available_idx
  on event_outbox (available_at, occurred_at, event_id)
  where status in ('PENDING', 'FAILED_RETRYABLE');

create index if not exists event_outbox_claimed_idx
  on event_outbox (claimed_at, event_id)
  where status = 'CLAIMED';

create index if not exists event_outbox_aggregate_idx
  on event_outbox (tenant_id, aggregate_type, aggregate_id, aggregate_version, occurred_at);

create index if not exists event_outbox_correlation_idx
  on event_outbox (correlation_id, occurred_at, event_id);

create table if not exists event_outbox_delivery_attempts (
  execution_id text primary key,
  event_id text not null references event_outbox (event_id) on delete restrict,
  worker_id text not null,
  attempt_number integer not null,
  status text not null,
  claimed_at timestamptz not null,
  completed_at timestamptz,
  error_code text,
  evidence jsonb not null default '[]'::jsonb,
  unique (event_id, attempt_number),
  check (length(trim(execution_id)) > 0),
  check (length(trim(worker_id)) > 0),
  check (attempt_number >= 1),
  check (status in ('CLAIMED', 'DELIVERED', 'FAILED_RETRYABLE', 'DEAD_LETTER')),
  check (jsonb_typeof(evidence) = 'array'),
  check (status = 'CLAIMED' or completed_at is not null),
  check (status not in ('FAILED_RETRYABLE', 'DEAD_LETTER') or error_code is not null)
);

create index if not exists event_outbox_delivery_attempts_event_idx
  on event_outbox_delivery_attempts (event_id, attempt_number desc);

create table if not exists event_consumer_receipts (
  consumer_id text not null,
  event_id text not null references event_outbox (event_id) on delete restrict,
  execution_id text not null,
  status text not null,
  claimed_at timestamptz not null,
  processed_at timestamptz,
  evidence jsonb not null,
  version integer not null default 1,
  primary key (consumer_id, event_id),
  unique (execution_id),
  check (length(trim(consumer_id)) > 0),
  check (length(trim(execution_id)) > 0),
  check (status in ('PROCESSING', 'PROCESSED')),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0),
  check (version >= 1),
  check (status <> 'PROCESSED' or processed_at is not null)
);

create index if not exists event_consumer_receipts_event_idx
  on event_consumer_receipts (event_id, consumer_id);
