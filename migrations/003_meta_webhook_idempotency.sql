create table if not exists meta_webhook_events (
  event_id text primary key,
  channel text not null check (channel in ('COMMENT','DIRECT')),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);

create index if not exists meta_webhook_events_received_idx
  on meta_webhook_events (received_at desc);
