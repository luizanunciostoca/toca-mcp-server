create table if not exists r31_learning_records (
  record_id text primary key,
  record_type text not null check (record_type in ('OBSERVATION', 'EXPERIMENT', 'OUTCOME', 'DECISION', 'RECOMMENDATION')),
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  experiment_id text,
  idempotency_key text not null,
  payload jsonb not null,
  created_at timestamptz not null,
  unique (workspace_id, record_type, idempotency_key)
);

create index if not exists r31_learning_records_experiment_idx
  on r31_learning_records (workspace_id, experiment_id, created_at, record_id)
  where experiment_id is not null;

create index if not exists r31_learning_records_type_idx
  on r31_learning_records (workspace_id, record_type, created_at, record_id);
