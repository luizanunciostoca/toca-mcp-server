create table if not exists workflow_instances (
  workflow_id text primary key,
  route_id text not null,
  definition_id text not null,
  definition_version text not null,
  idempotency_key text not null,
  correlation_id text not null,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  requester_principal_id text not null,
  status text not null,
  input jsonb not null default 'null'::jsonb,
  output jsonb,
  error_code text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  version integer not null default 1,
  unique (tenant_id, idempotency_key),
  check (route_id ~ '^R(0[1-9]|[12][0-9]|3[0-2])$'),
  check (length(trim(definition_id)) > 0),
  check (length(trim(definition_version)) > 0),
  check (length(trim(correlation_id)) > 0),
  check (length(trim(tenant_id)) > 0),
  check (length(trim(workspace_id)) > 0),
  check (length(trim(organization_id)) > 0),
  check (length(trim(requester_principal_id)) > 0),
  check (status in ('RUNNING', 'WAITING', 'BLOCKED', 'SUCCEEDED', 'FAILED', 'CANCELED')),
  check (version >= 1),
  check (
    status not in ('SUCCEEDED', 'FAILED', 'CANCELED')
    or completed_at is not null
  )
);

create index if not exists workflow_instances_status_idx
  on workflow_instances (status, updated_at, workflow_id);

create index if not exists workflow_instances_correlation_idx
  on workflow_instances (correlation_id, created_at desc);

create table if not exists workflow_steps (
  workflow_id text not null references workflow_instances (workflow_id) on delete restrict,
  step_id text not null,
  name text not null,
  capability_id text,
  status text not null,
  input jsonb not null default 'null'::jsonb,
  output jsonb,
  attempts integer not null default 0,
  max_attempts integer not null default 1,
  claimed_by text,
  claim_execution_id text,
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  evidence jsonb not null default '[]'::jsonb,
  version integer not null default 1,
  primary key (workflow_id, step_id),
  check (length(trim(step_id)) > 0),
  check (length(trim(name)) > 0),
  check (
    status in (
      'PENDING',
      'READY',
      'RUNNING',
      'WAITING_HUMAN',
      'WAITING_TIMER',
      'SUCCEEDED',
      'FAILED',
      'SKIPPED',
      'BLOCKED',
      'CANCELED'
    )
  ),
  check (attempts >= 0 and max_attempts >= 1 and attempts <= max_attempts),
  check (jsonb_typeof(evidence) = 'array'),
  check (version >= 1),
  check (
    status <> 'RUNNING'
    or (
      claimed_by is not null
      and claim_execution_id is not null
      and claimed_at is not null
      and started_at is not null
    )
  ),
  check (
    status not in ('SUCCEEDED', 'FAILED', 'CANCELED')
    or completed_at is not null
  )
);

create unique index if not exists workflow_steps_claim_execution_uidx
  on workflow_steps (claim_execution_id)
  where claim_execution_id is not null;

create index if not exists workflow_steps_ready_idx
  on workflow_steps (workflow_id, step_id)
  where status = 'READY';

create index if not exists workflow_steps_waiting_idx
  on workflow_steps (status, workflow_id, step_id)
  where status in ('WAITING_HUMAN', 'WAITING_TIMER');

create table if not exists workflow_dependencies (
  workflow_id text not null,
  step_id text not null,
  depends_on_step_id text not null,
  primary key (workflow_id, step_id, depends_on_step_id),
  foreign key (workflow_id, step_id)
    references workflow_steps (workflow_id, step_id) on delete restrict,
  foreign key (workflow_id, depends_on_step_id)
    references workflow_steps (workflow_id, step_id) on delete restrict,
  check (step_id <> depends_on_step_id)
);

create index if not exists workflow_dependencies_parent_idx
  on workflow_dependencies (workflow_id, depends_on_step_id, step_id);

create table if not exists workflow_events (
  event_id text primary key,
  workflow_id text not null references workflow_instances (workflow_id) on delete restrict,
  step_id text,
  event_type text not null,
  correlation_id text not null,
  payload jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  occurred_at timestamptz not null,
  check (length(trim(event_id)) > 0),
  check (length(trim(correlation_id)) > 0),
  check (
    event_type in (
      'WORKFLOW_CREATED',
      'WORKFLOW_STATUS_CHANGED',
      'STEP_READY',
      'STEP_CLAIMED',
      'STEP_SUCCEEDED',
      'STEP_FAILED',
      'STEP_RETRIED',
      'HUMAN_TASK_OPENED',
      'HUMAN_TASK_CLAIMED',
      'HUMAN_TASK_COMPLETED',
      'TIMER_SCHEDULED',
      'TIMER_FIRED',
      'COMPENSATION_REGISTERED',
      'COMPENSATION_READY',
      'COMPENSATION_CLAIMED',
      'COMPENSATION_SUCCEEDED',
      'COMPENSATION_FAILED'
    )
  ),
  check (jsonb_typeof(evidence) = 'array'),
  foreign key (workflow_id, step_id)
    references workflow_steps (workflow_id, step_id) on delete restrict
);

create index if not exists workflow_events_workflow_idx
  on workflow_events (workflow_id, occurred_at, event_id);

create table if not exists workflow_human_tasks (
  task_id text primary key,
  workflow_id text not null,
  step_id text not null,
  status text not null,
  required_role text,
  assigned_principal_id text,
  payload jsonb not null default 'null'::jsonb,
  due_at timestamptz,
  claimed_at timestamptz,
  completed_at timestamptz,
  completion jsonb,
  evidence jsonb not null default '[]'::jsonb,
  version integer not null default 1,
  foreign key (workflow_id, step_id)
    references workflow_steps (workflow_id, step_id) on delete restrict,
  check (status in ('OPEN', 'CLAIMED', 'COMPLETED', 'CANCELED')),
  check (jsonb_typeof(evidence) = 'array'),
  check (version >= 1),
  check (
    status <> 'CLAIMED'
    or (assigned_principal_id is not null and claimed_at is not null)
  ),
  check (
    status <> 'COMPLETED'
    or (assigned_principal_id is not null and completed_at is not null)
  )
);

create index if not exists workflow_human_tasks_open_idx
  on workflow_human_tasks (status, due_at, task_id)
  where status in ('OPEN', 'CLAIMED');

create table if not exists workflow_timers (
  timer_id text primary key,
  workflow_id text not null,
  step_id text not null,
  status text not null,
  fire_at timestamptz not null,
  fired_at timestamptz,
  payload jsonb not null default 'null'::jsonb,
  version integer not null default 1,
  foreign key (workflow_id, step_id)
    references workflow_steps (workflow_id, step_id) on delete restrict,
  check (status in ('SCHEDULED', 'FIRED', 'CANCELED')),
  check (version >= 1),
  check (status <> 'FIRED' or fired_at is not null)
);

create index if not exists workflow_timers_due_idx
  on workflow_timers (fire_at, timer_id)
  where status = 'SCHEDULED';

create table if not exists workflow_compensations (
  compensation_id text primary key,
  workflow_id text not null,
  step_id text not null,
  order_index integer not null,
  capability_id text,
  status text not null,
  input jsonb not null default 'null'::jsonb,
  output jsonb,
  claimed_by text,
  claim_execution_id text,
  claimed_at timestamptz,
  completed_at timestamptz,
  error_code text,
  evidence jsonb not null default '[]'::jsonb,
  version integer not null default 1,
  unique (workflow_id, order_index),
  unique (workflow_id, compensation_id),
  foreign key (workflow_id, step_id)
    references workflow_steps (workflow_id, step_id) on delete restrict,
  check (order_index >= 0),
  check (status in ('PENDING', 'READY', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED')),
  check (jsonb_typeof(evidence) = 'array'),
  check (version >= 1),
  check (
    status <> 'RUNNING'
    or (
      claimed_by is not null
      and claim_execution_id is not null
      and claimed_at is not null
    )
  ),
  check (
    status not in ('SUCCEEDED', 'FAILED')
    or completed_at is not null
  )
);

create unique index if not exists workflow_compensations_claim_execution_uidx
  on workflow_compensations (claim_execution_id)
  where claim_execution_id is not null;

create index if not exists workflow_compensations_ready_idx
  on workflow_compensations (workflow_id, order_index desc, compensation_id)
  where status = 'READY';
