create table if not exists dead_letter_jobs (
  id text primary key,
  original_job_id text not null,
  tool_name text not null,
  payload jsonb not null,
  attempts integer not null check (attempts > 0),
  last_error text not null,
  failed_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists dead_letter_jobs_tool_failed_idx
  on dead_letter_jobs (tool_name, failed_at desc);
