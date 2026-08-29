create table if not exists instagram_engagement_knowledge (
  faq_id text primary key,
  canonical_question text not null,
  variants text[] not null default '{}',
  intent text not null,
  risk text not null check (risk in ('LOW','MEDIUM','HIGH','CRITICAL')),
  autonomy text not null check (autonomy in ('READ_ONLY','SUGGEST_ONLY','AUTO_REPLY_ALLOWED','HUMAN_REVIEW_REQUIRED')),
  answer text not null,
  source text not null,
  facts_to_validate text not null default '',
  source_updated_on date not null,
  status text not null,
  operational_validity text not null,
  source_spreadsheet_id text not null,
  source_snapshot_sha256 text not null check (source_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  active boolean not null default true,
  synced_at timestamptz not null default now()
);

create index if not exists instagram_engagement_knowledge_active_intent_idx
  on instagram_engagement_knowledge (active, intent, faq_id);

comment on table instagram_engagement_knowledge is
  'Sanitized runtime snapshot of approved Instagram FAQ knowledge. Google Drive/Sheets remains canonical; production reads this table to avoid broad Google Workspace IAM.';
