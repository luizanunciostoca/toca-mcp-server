alter table instagram_engagement_threads
  add column if not exists source_campaign_id text,
  add column if not exists source_ad_set_id text,
  add column if not exists source_ad_id text,
  add column if not exists source_creative_id text,
  add column if not exists attribution_verified boolean not null default false;

create table if not exists instagram_engagement_human_queue (
  queue_id text primary key,
  thread_id text not null references instagram_engagement_threads(thread_id) on delete cascade,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  priority text not null check (priority in ('P0','P1','P2','P3')),
  primary_intent text not null,
  reason_code text not null,
  owner text,
  state text not null default 'PENDING' check (state in ('PENDING','ACKNOWLEDGED','RESOLVED','CLOSED')),
  created_at timestamptz not null,
  sla_due_at timestamptz not null,
  acknowledged_at timestamptz,
  resolution text,
  resolution_at timestamptz,
  closed_at timestamptz,
  updated_at timestamptz not null
);

create unique index if not exists instagram_engagement_human_queue_open_thread_idx
  on instagram_engagement_human_queue (thread_id)
  where state in ('PENDING','ACKNOWLEDGED');

create index if not exists instagram_engagement_human_queue_sla_idx
  on instagram_engagement_human_queue (priority, sla_due_at, created_at)
  where state in ('PENDING','ACKNOWLEDGED');

create table if not exists instagram_engagement_follow_up_queue (
  follow_up_id text primary key,
  thread_id text not null references instagram_engagement_threads(thread_id) on delete cascade,
  reason_code text not null,
  due_at timestamptz not null,
  state text not null default 'PENDING' check (state in ('PENDING','COMPLETED','SKIPPED','CANCELLED')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 1 check (max_attempts between 1 and 2),
  context_authorized boolean not null default false,
  consent_required boolean not null default false,
  consent_verified boolean not null default false,
  last_attempt_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists instagram_engagement_follow_up_open_thread_idx
  on instagram_engagement_follow_up_queue (thread_id, reason_code)
  where state = 'PENDING';

create index if not exists instagram_engagement_follow_up_due_idx
  on instagram_engagement_follow_up_queue (due_at, thread_id)
  where state = 'PENDING';

create table if not exists instagram_engagement_faq_signals (
  normalized_question_sha256 text primary key,
  normalized_question_redacted text not null,
  primary_intent text not null,
  occurrence_count bigint not null default 1 check (occurrence_count > 0),
  kb_hit_count bigint not null default 0 check (kb_hit_count >= 0),
  kb_miss_count bigint not null default 0 check (kb_miss_count >= 0),
  resolved_count bigint not null default 0 check (resolved_count >= 0),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  review_state text not null default 'OBSERVE' check (review_state in ('OBSERVE','NEEDS_FAQ_REVIEW','REVIEWED','DISMISSED')),
  updated_at timestamptz not null
);

create index if not exists instagram_engagement_faq_signals_frequency_idx
  on instagram_engagement_faq_signals (occurrence_count desc, last_seen_at desc);

create table if not exists instagram_engagement_classification_feedback (
  feedback_id text primary key,
  event_sha256 text not null,
  predicted_intent text not null,
  expected_intent text not null,
  predicted_priority text check (predicted_priority is null or predicted_priority in ('P0','P1','P2','P3')),
  expected_priority text check (expected_priority is null or expected_priority in ('P0','P1','P2','P3')),
  predicted_autonomy text,
  expected_autonomy text,
  intent_mismatch boolean not null,
  priority_mismatch boolean not null,
  autonomy_mismatch boolean not null,
  review_state text not null default 'RECORDED' check (review_state in ('RECORDED','VALIDATED','REJECTED')),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists instagram_engagement_classification_feedback_matrix_idx
  on instagram_engagement_classification_feedback (predicted_intent, expected_intent, created_at desc);

create table if not exists instagram_engagement_response_qa (
  event_sha256 text primary key,
  factuality smallint not null check (factuality between 0 and 5),
  verbal_identity smallint not null check (verbal_identity between 0 and 5),
  clarity smallint not null check (clarity between 0 and 5),
  personalization smallint not null check (personalization between 0 and 5),
  safety smallint not null check (safety between 0 and 5),
  concision smallint not null check (concision between 0 and 5),
  cta_quality smallint not null check (cta_quality between 0 and 5),
  context_awareness smallint not null check (context_awareness between 0 and 5),
  duplicate_detected boolean not null default false,
  reviewer text not null,
  reviewed_at timestamptz not null
);

create index if not exists instagram_engagement_response_qa_reviewed_idx
  on instagram_engagement_response_qa (reviewed_at desc);

comment on table instagram_engagement_human_queue is
  'Human escalation queue. It intentionally stores operational metadata only, never raw Direct content.';
comment on table instagram_engagement_follow_up_queue is
  'Governed follow-up scheduling state. Queue membership does not authorize any provider write.';
comment on table instagram_engagement_faq_signals is
  'Aggregated recurring-question signals with PII-redacted normalized text; never promotes FAQ facts automatically.';
comment on table instagram_engagement_classification_feedback is
  'Human-reviewed confusion-matrix evidence. Records do not promote classifier changes automatically.';
comment on table instagram_engagement_response_qa is
  'Sanitized quality scores for responses; raw Direct content is excluded.';
