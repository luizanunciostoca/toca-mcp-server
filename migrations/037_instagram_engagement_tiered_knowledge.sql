create table if not exists instagram_engagement_knowledge_documents (
  document_id text primary key,
  source_id text not null unique,
  title text not null,
  drive_id text not null,
  scope text not null,
  precedence text not null,
  source_kind text not null check (source_kind in ('OPERATIONS','MENU_STRUCTURED','LOCATION','POLICY','OTHER')),
  source_status text not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_modified_at timestamptz,
  active boolean not null default true,
  synced_at timestamptz not null default now()
);

create table if not exists instagram_engagement_knowledge_chunks (
  chunk_id text primary key,
  document_id text not null references instagram_engagement_knowledge_documents(document_id) on delete cascade,
  sequence integer not null check (sequence >= 0),
  heading text not null default '',
  content text not null,
  search_text text not null,
  intent_hints text[] not null default '{}',
  risk text not null check (risk in ('LOW','MEDIUM','HIGH','CRITICAL')),
  autonomy text not null check (autonomy in ('READ_ONLY','SUGGEST_ONLY','AUTO_REPLY_ALLOWED','HUMAN_REVIEW_REQUIRED')),
  source_reference text not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  active boolean not null default true,
  synced_at timestamptz not null default now(),
  unique (document_id, sequence)
);

alter table instagram_engagement_knowledge_chunks
  add column if not exists search_vector tsvector
  generated always as (to_tsvector('simple', search_text)) stored;

create index if not exists instagram_engagement_kb_chunks_search_idx
  on instagram_engagement_knowledge_chunks using gin (search_vector);

create index if not exists instagram_engagement_kb_chunks_active_intent_idx
  on instagram_engagement_knowledge_chunks (active, autonomy, risk, document_id);

alter table instagram_engagement_actions
  add column if not exists knowledge_tier text,
  add column if not exists knowledge_chunk_id text;

comment on table instagram_engagement_knowledge_documents is
  'Operational mirror of allowlisted TOCA OS canonical sources used by Instagram engagement retrieval. Drive remains canonical.';
comment on table instagram_engagement_knowledge_chunks is
  'Sanitized, bounded retrieval chunks derived from allowlisted canonical sources. AUTO_REPLY_ALLOWED is reserved for explicitly safe low-risk chunks.';
comment on column instagram_engagement_actions.knowledge_tier is
  'Knowledge layer used for the decision: FAQ or KNOWLEDGE_BASE.';
comment on column instagram_engagement_actions.knowledge_chunk_id is
  'Optional sanitized chunk identifier for provenance when the knowledge-base tier is used.';
