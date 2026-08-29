create table if not exists instagram_engagement_actions (
  event_id text primary key references meta_webhook_events(event_id) on delete cascade,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  channel text not null check (channel in ('COMMENT','DIRECT')),
  intent text not null,
  risk text not null check (risk in ('LOW','MEDIUM','HIGH','CRITICAL')),
  autonomy text not null check (autonomy in ('READ_ONLY','SUGGEST_ONLY','AUTO_REPLY_ALLOWED','HUMAN_REVIEW_REQUIRED')),
  policy_reason text not null,
  faq_id text,
  knowledge_source text,
  knowledge_confidence double precision,
  reply_sha256 text,
  status text not null check (status in ('CLASSIFIED','SUGGESTED','HUMAN_REVIEW','READY_TO_SEND','SENT','SEND_FAILED','SEND_AMBIGUOUS')),
  provider_reply_id text,
  failure_code text,
  execution_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists instagram_engagement_actions_status_idx
  on instagram_engagement_actions (status, updated_at asc);

create index if not exists instagram_engagement_actions_scope_idx
  on instagram_engagement_actions (tenant_id, workspace_id, organization_id, created_at desc);

create index if not exists instagram_engagement_actions_intent_idx
  on instagram_engagement_actions (intent, risk, created_at desc);

comment on table instagram_engagement_actions is
  'Governed state for Instagram comment/direct classification and reply execution. Raw inbound text and sender scoped identifiers are intentionally not stored here.';
