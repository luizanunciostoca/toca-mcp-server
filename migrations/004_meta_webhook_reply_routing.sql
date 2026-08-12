alter table meta_webhook_events
  add column if not exists sender_scoped_id text,
  add column if not exists provider_message_id text,
  add column if not exists text_sha256 text;

create index if not exists meta_webhook_events_direct_text_hash_idx
  on meta_webhook_events (channel, text_sha256, received_at desc)
  where channel = 'DIRECT' and text_sha256 is not null;
