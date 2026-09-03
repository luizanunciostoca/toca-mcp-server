alter table instagram_engagement_faq_signals
  add column if not exists tenant_id text,
  add column if not exists workspace_id text,
  add column if not exists organization_id text;

update instagram_engagement_faq_signals
   set tenant_id = coalesce(tenant_id, 'toca'),
       workspace_id = coalesce(workspace_id, 'toca'),
       organization_id = coalesce(organization_id, 'toca')
 where tenant_id is null or workspace_id is null or organization_id is null;

alter table instagram_engagement_faq_signals
  alter column tenant_id set not null,
  alter column workspace_id set not null,
  alter column organization_id set not null;

alter table instagram_engagement_faq_signals
  drop constraint if exists instagram_engagement_faq_signals_pkey;

alter table instagram_engagement_faq_signals
  add primary key (tenant_id, workspace_id, organization_id, normalized_question_sha256);

create index if not exists instagram_engagement_faq_signals_scope_frequency_idx
  on instagram_engagement_faq_signals (
    tenant_id,
    workspace_id,
    organization_id,
    occurrence_count desc,
    last_seen_at desc
  );

alter table instagram_engagement_classification_feedback
  add column if not exists tenant_id text,
  add column if not exists workspace_id text,
  add column if not exists organization_id text;

update instagram_engagement_classification_feedback
   set tenant_id = coalesce(tenant_id, 'toca'),
       workspace_id = coalesce(workspace_id, 'toca'),
       organization_id = coalesce(organization_id, 'toca')
 where tenant_id is null or workspace_id is null or organization_id is null;

alter table instagram_engagement_classification_feedback
  alter column tenant_id set not null,
  alter column workspace_id set not null,
  alter column organization_id set not null;

create index if not exists instagram_engagement_classification_feedback_scope_matrix_idx
  on instagram_engagement_classification_feedback (
    tenant_id,
    workspace_id,
    organization_id,
    predicted_intent,
    expected_intent,
    created_at desc
  );

alter table instagram_engagement_response_qa
  add column if not exists tenant_id text,
  add column if not exists workspace_id text,
  add column if not exists organization_id text;

update instagram_engagement_response_qa
   set tenant_id = coalesce(tenant_id, 'toca'),
       workspace_id = coalesce(workspace_id, 'toca'),
       organization_id = coalesce(organization_id, 'toca')
 where tenant_id is null or workspace_id is null or organization_id is null;

alter table instagram_engagement_response_qa
  alter column tenant_id set not null,
  alter column workspace_id set not null,
  alter column organization_id set not null;

create index if not exists instagram_engagement_response_qa_scope_reviewed_idx
  on instagram_engagement_response_qa (
    tenant_id,
    workspace_id,
    organization_id,
    reviewed_at desc
  );

comment on table instagram_engagement_faq_signals is
  'Tenant/workspace/organization-scoped recurring-question signals with PII-redacted normalized text; never promotes FAQ facts automatically.';
comment on table instagram_engagement_classification_feedback is
  'Tenant/workspace/organization-scoped human-reviewed confusion-matrix evidence; never promotes classifier changes automatically.';
comment on table instagram_engagement_response_qa is
  'Tenant/workspace/organization-scoped sanitized quality scores; raw Direct content is excluded.';
