create table if not exists workflow_execution_claims (
  execution_id text primary key,
  workflow_id text not null references workflow_instances (workflow_id) on delete restrict,
  step_id text,
  compensation_id text references workflow_compensations (compensation_id) on delete restrict,
  worker_id text not null,
  claimed_at timestamptz not null,
  check (length(trim(execution_id)) > 0),
  check (length(trim(worker_id)) > 0),
  check ((step_id is not null) <> (compensation_id is not null)),
  foreign key (workflow_id, step_id)
    references workflow_steps (workflow_id, step_id) on delete restrict
);

create index if not exists workflow_execution_claims_workflow_idx
  on workflow_execution_claims (workflow_id, claimed_at desc, execution_id);
