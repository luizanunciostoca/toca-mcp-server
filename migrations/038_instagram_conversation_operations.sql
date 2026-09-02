create table if not exists instagram_engagement_threads (
  thread_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  channel text not null check (channel in ('COMMENT','DIRECT')),
  state text not null check (state in (
    'NEW','CLASSIFIED','RESPONDABLE','AWAITING_APPROVAL','RESPONDED',
    'AWAITING_CUSTOMER','FOLLOW_UP_REQUIRED','ESCALATED','RESOLVED','CLOSED'
  )),
  primary_intent text,
  secondary_intents text[] not null default '{}',
  priority text not null default 'P2' check (priority in ('P0','P1','P2','P3')),
  classification_confidence text not null default 'LOW' check (classification_confidence in ('HIGH','MEDIUM','LOW')),
  commercial_intent text not null default 'NONE' check (commercial_intent in ('NONE','LOW','MEDIUM','HIGH')),
  sentiment text not null default 'NEUTRAL' check (sentiment in ('POSITIVE','NEUTRAL','NEGATIVE')),
  sla_state text not null default 'UNCONFIGURED' check (sla_state in ('UNCONFIGURED','GREEN','YELLOW','RED')),
  follow_up_required boolean not null default false,
  last_group_sha256 text,
  last_inbound_event_id text,
  last_provider_reply_id text,
  grouped_message_count integer not null default 0 check (grouped_message_count >= 0),
  first_inbound_at timestamptz,
  last_inbound_at timestamptz,
  first_response_at timestamptz,
  last_response_at timestamptz,
  awaiting_since timestamptz,
  follow_up_due_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  version integer not null default 1 check (version > 0)
);

create index if not exists instagram_engagement_threads_scope_state_idx
  on instagram_engagement_threads (tenant_id, workspace_id, organization_id, state, priority, updated_at desc);
create index if not exists instagram_engagement_threads_sla_idx
  on instagram_engagement_threads (sla_state, awaiting_since)
  where state not in ('RESOLVED','CLOSED');
create index if not exists instagram_engagement_threads_follow_up_idx
  on instagram_engagement_threads (follow_up_due_at)
  where follow_up_required = true and state = 'FOLLOW_UP_REQUIRED';

create table if not exists instagram_engagement_message_groups (
  group_sha256 text primary key,
  thread_id text not null references instagram_engagement_threads(thread_id) on delete cascade,
  claimed_event_id text not null,
  event_ids text[] not null,
  message_count integer not null check (message_count > 0),
  text_sha256 text not null,
  occurred_from timestamptz not null,
  occurred_to timestamptz not null,
  status text not null check (status in ('CLAIMED','CLASSIFIED','SUGGESTED','HUMAN_REVIEW','READY_TO_SEND','RESPONDED','NO_ACTION','FAILED')),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists instagram_engagement_message_groups_thread_idx
  on instagram_engagement_message_groups (thread_id, occurred_to desc);

alter table instagram_engagement_actions
  add column if not exists thread_id text,
  add column if not exists message_group_sha256 text,
  add column if not exists classification_confidence text,
  add column if not exists priority text,
  add column if not exists secondary_intents text[] not null default '{}';

alter table instagram_engagement_actions
  drop constraint if exists instagram_engagement_actions_classification_confidence_check;
alter table instagram_engagement_actions
  add constraint instagram_engagement_actions_classification_confidence_check
  check (classification_confidence is null or classification_confidence in ('HIGH','MEDIUM','LOW'));

alter table instagram_engagement_actions
  drop constraint if exists instagram_engagement_actions_priority_check;
alter table instagram_engagement_actions
  add constraint instagram_engagement_actions_priority_check
  check (priority is null or priority in ('P0','P1','P2','P3'));

create index if not exists instagram_engagement_actions_thread_idx
  on instagram_engagement_actions (thread_id, updated_at desc)
  where thread_id is not null;
