create table if not exists instagram_engagement_faq_signals_scoped (
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  normalized_question_sha256 text not null,
  normalized_question_redacted text not null,
  primary_intent text not null,
  occurrence_count bigint not null default 1 check (occurrence_count > 0),
  kb_hit_count bigint not null default 0 check (kb_hit_count >= 0),
  kb_miss_count bigint not null default 0 check (kb_miss_count >= 0),
  resolved_count bigint not null default 0 check (resolved_count >= 0),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  review_state text not null default 'OBSERVE'
    check (review_state in ('OBSERVE','NEEDS_FAQ_REVIEW','REVIEWED','DISMISSED')),
  updated_at timestamptz not null,
  primary key (tenant_id, workspace_id, organization_id, normalized_question_sha256)
);

create index if not exists instagram_engagement_faq_signals_scoped_frequency_idx
  on instagram_engagement_faq_signals_scoped (
    tenant_id,
    workspace_id,
    organization_id,
    occurrence_count desc,
    last_seen_at desc
  );

create table if not exists instagram_engagement_classification_feedback_scoped (
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  feedback_id text not null,
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
  review_state text not null default 'RECORDED'
    check (review_state in ('RECORDED','VALIDATED','REJECTED')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, workspace_id, organization_id, feedback_id)
);

create index if not exists instagram_engagement_classification_feedback_scoped_matrix_idx
  on instagram_engagement_classification_feedback_scoped (
    tenant_id,
    workspace_id,
    organization_id,
    predicted_intent,
    expected_intent,
    created_at desc
  );

create table if not exists instagram_engagement_response_qa_scoped (
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  event_sha256 text not null,
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
  reviewed_at timestamptz not null,
  primary key (tenant_id, workspace_id, organization_id, event_sha256)
);

create index if not exists instagram_engagement_response_qa_scoped_reviewed_idx
  on instagram_engagement_response_qa_scoped (
    tenant_id,
    workspace_id,
    organization_id,
    reviewed_at desc
  );

comment on table instagram_engagement_faq_signals_scoped is
  'Tenant/workspace/organization-scoped recurring-question analytics. PII-redacted text only; never promotes FAQ facts automatically.';
comment on table instagram_engagement_classification_feedback_scoped is
  'Tenant/workspace/organization-scoped classifier confusion evidence. No automatic classifier promotion.';
comment on table instagram_engagement_response_qa_scoped is
  'Tenant/workspace/organization-scoped sanitized response-quality evidence. Raw Direct content is prohibited.';
