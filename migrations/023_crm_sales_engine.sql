create table if not exists crm_conversations (
  conversation_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  contact_id text not null,
  lead_id text,
  channel text not null,
  language text not null default 'und',
  status text not null default 'OPEN',
  started_at timestamptz not null,
  last_message_at timestamptz,
  closed_at timestamptz,
  attributes jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, conversation_id),
  foreign key (tenant_id, workspace_id, organization_id, contact_id)
    references crm_contacts (tenant_id, workspace_id, organization_id, contact_id) on delete restrict,
  foreign key (tenant_id, workspace_id, organization_id, lead_id)
    references crm_leads (tenant_id, workspace_id, organization_id, lead_id) on delete restrict,
  check (channel in ('WHATSAPP','EMAIL','INSTAGRAM','PHONE','WEB','IN_PERSON','OTHER')),
  check (status in ('OPEN','WAITING_CUSTOMER','WAITING_HUMAN','ABANDONED','HANDED_OFF','CLOSED')),
  check (length(trim(language)) > 0),
  check (closed_at is null or status in ('ABANDONED','HANDED_OFF','CLOSED')),
  check (jsonb_typeof(attributes) = 'object'),
  check (version >= 1)
);

create index if not exists crm_conversations_contact_idx
  on crm_conversations (tenant_id, workspace_id, organization_id, contact_id, updated_at desc, conversation_id);
create index if not exists crm_conversations_lead_idx
  on crm_conversations (tenant_id, workspace_id, organization_id, lead_id, updated_at desc, conversation_id)
  where lead_id is not null;

create table if not exists crm_messages (
  message_id text primary key,
  conversation_id text not null,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  contact_id text not null,
  lead_id text,
  direction text not null,
  channel text not null,
  language text not null default 'und',
  content_ref text,
  content_sha256 text not null,
  provider_message_ref text,
  intent text,
  urgency text,
  occurred_at timestamptz not null,
  evidence jsonb not null,
  created_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, message_id),
  foreign key (tenant_id, workspace_id, organization_id, conversation_id)
    references crm_conversations (tenant_id, workspace_id, organization_id, conversation_id) on delete restrict,
  foreign key (tenant_id, workspace_id, organization_id, contact_id)
    references crm_contacts (tenant_id, workspace_id, organization_id, contact_id) on delete restrict,
  foreign key (tenant_id, workspace_id, organization_id, lead_id)
    references crm_leads (tenant_id, workspace_id, organization_id, lead_id) on delete restrict,
  check (direction in ('INBOUND','OUTBOUND','INTERNAL')),
  check (channel in ('WHATSAPP','EMAIL','INSTAGRAM','PHONE','WEB','IN_PERSON','OTHER')),
  check (length(content_sha256) = 64),
  check (content_sha256 ~ '^[0-9a-f]{64}$'),
  check (urgency is null or urgency in ('LOW','MEDIUM','HIGH','IMMEDIATE')),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists crm_messages_conversation_idx
  on crm_messages (tenant_id, workspace_id, organization_id, conversation_id, occurred_at, message_id);

create table if not exists crm_sales_activities (
  activity_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  contact_id text not null,
  lead_id text,
  opportunity_id text,
  conversation_id text,
  activity_type text not null,
  channel text,
  summary text not null,
  outcome text,
  actor_principal_id text not null,
  occurred_at timestamptz not null,
  evidence jsonb not null,
  created_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, activity_id),
  foreign key (tenant_id, workspace_id, organization_id, contact_id)
    references crm_contacts (tenant_id, workspace_id, organization_id, contact_id) on delete restrict,
  foreign key (tenant_id, workspace_id, organization_id, lead_id)
    references crm_leads (tenant_id, workspace_id, organization_id, lead_id) on delete restrict,
  foreign key (tenant_id, workspace_id, organization_id, opportunity_id)
    references crm_opportunities (tenant_id, workspace_id, organization_id, opportunity_id) on delete restrict,
  foreign key (tenant_id, workspace_id, organization_id, conversation_id)
    references crm_conversations (tenant_id, workspace_id, organization_id, conversation_id) on delete restrict,
  check (activity_type in ('CONTACT_ATTEMPT','RESPONSE','QUALIFICATION','NOTE','CALL','MEETING','PROPOSAL','FOLLOW_UP','HUMAN_HANDOFF','ESCALATION','REACTIVATION','POST_SALE')),
  check (channel is null or channel in ('WHATSAPP','EMAIL','INSTAGRAM','PHONE','WEB','IN_PERSON','OTHER')),
  check (length(trim(summary)) > 0),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists crm_sales_activities_lead_idx
  on crm_sales_activities (tenant_id, workspace_id, organization_id, lead_id, occurred_at desc, activity_id)
  where lead_id is not null;
create index if not exists crm_sales_activities_opportunity_idx
  on crm_sales_activities (tenant_id, workspace_id, organization_id, opportunity_id, occurred_at desc, activity_id)
  where opportunity_id is not null;

create table if not exists crm_next_actions (
  next_action_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  contact_id text not null,
  lead_id text,
  opportunity_id text,
  action_type text not null,
  title text not null,
  rationale text not null,
  priority text not null,
  status text not null default 'PENDING',
  owner_principal_id text,
  playbook_key text,
  due_at timestamptz,
  completed_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, next_action_id),
  foreign key (tenant_id, workspace_id, organization_id, contact_id)
    references crm_contacts (tenant_id, workspace_id, organization_id, contact_id) on delete restrict,
  foreign key (tenant_id, workspace_id, organization_id, lead_id)
    references crm_leads (tenant_id, workspace_id, organization_id, lead_id) on delete restrict,
  foreign key (tenant_id, workspace_id, organization_id, opportunity_id)
    references crm_opportunities (tenant_id, workspace_id, organization_id, opportunity_id) on delete restrict,
  check (action_type in ('CONTACT','FOLLOW_UP','QUALIFY','CREATE_OPPORTUNITY','PROPOSAL','REACTIVATE','HUMAN_HANDOFF','ESCALATE','POST_SALE','CLOSE_LOST')),
  check (priority in ('LOW','MEDIUM','HIGH','URGENT')),
  check (status in ('PENDING','IN_PROGRESS','COMPLETED','CANCELED')),
  check (completed_at is null or status = 'COMPLETED'),
  check (version >= 1)
);

create index if not exists crm_next_actions_due_idx
  on crm_next_actions (tenant_id, workspace_id, organization_id, status, due_at, priority, next_action_id)
  where status in ('PENDING','IN_PROGRESS');

create table if not exists crm_qualification_decisions (
  qualification_decision_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  lead_id text not null,
  decision text not null,
  authority text not null,
  rule_version text not null,
  deterministic_score double precision not null,
  ai_score double precision,
  rationale text not null,
  factors jsonb not null,
  evidence jsonb not null,
  decided_by_principal_id text not null,
  decided_at timestamptz not null,
  created_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, qualification_decision_id),
  foreign key (tenant_id, workspace_id, organization_id, lead_id)
    references crm_leads (tenant_id, workspace_id, organization_id, lead_id) on delete restrict,
  check (decision in ('QUALIFIED','NURTURE','DISQUALIFIED','REVIEW')),
  check (authority in ('DETERMINISTIC','HUMAN','HYBRID')),
  check (deterministic_score between 0 and 100),
  check (ai_score is null or ai_score between 0 and 100),
  check (length(trim(rule_version)) > 0),
  check (length(trim(rationale)) > 0),
  check (jsonb_typeof(factors) = 'object'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists crm_qualification_decisions_lead_idx
  on crm_qualification_decisions (tenant_id, workspace_id, organization_id, lead_id, decided_at desc, qualification_decision_id);

create table if not exists crm_lead_score_observations (
  lead_score_observation_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  lead_id text not null,
  rule_version text not null,
  deterministic_score double precision not null,
  ai_score double precision,
  effective_score double precision not null,
  temperature text not null,
  intent text,
  urgency text not null,
  propensity double precision not null,
  estimated_value_minor bigint,
  currency text,
  visit_event_at timestamptz,
  campaign_ref text,
  source_ref text,
  factors jsonb not null,
  observed_at timestamptz not null,
  evidence jsonb not null,
  created_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, lead_score_observation_id),
  foreign key (tenant_id, workspace_id, organization_id, lead_id)
    references crm_leads (tenant_id, workspace_id, organization_id, lead_id) on delete restrict,
  check (deterministic_score between 0 and 100),
  check (ai_score is null or ai_score between 0 and 100),
  check (effective_score between 0 and 100),
  check (temperature in ('COLD','COOL','WARM','HOT')),
  check (urgency in ('LOW','MEDIUM','HIGH','IMMEDIATE')),
  check (propensity between 0 and 1),
  check ((estimated_value_minor is null and currency is null) or
         (estimated_value_minor is not null and estimated_value_minor >= 0 and currency ~ '^[A-Z]{3}$')),
  check (jsonb_typeof(factors) = 'object'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists crm_lead_score_observations_lead_idx
  on crm_lead_score_observations (tenant_id, workspace_id, organization_id, lead_id, observed_at desc, lead_score_observation_id);

create table if not exists crm_attribution_touchpoints (
  attribution_touchpoint_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  contact_id text not null,
  lead_id text,
  opportunity_id text,
  source text not null,
  medium text,
  campaign_ref text,
  content_ref text,
  term_ref text,
  provider_ref text,
  touchpoint_type text not null,
  occurred_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  evidence jsonb not null,
  created_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, attribution_touchpoint_id),
  foreign key (tenant_id, workspace_id, organization_id, contact_id)
    references crm_contacts (tenant_id, workspace_id, organization_id, contact_id) on delete restrict,
  foreign key (tenant_id, workspace_id, organization_id, lead_id)
    references crm_leads (tenant_id, workspace_id, organization_id, lead_id) on delete restrict,
  foreign key (tenant_id, workspace_id, organization_id, opportunity_id)
    references crm_opportunities (tenant_id, workspace_id, organization_id, opportunity_id) on delete restrict,
  check (touchpoint_type in ('FIRST_TOUCH','ASSIST','LAST_TOUCH','CONVERSION','POST_SALE')),
  check (length(trim(source)) > 0),
  check (jsonb_typeof(metadata) = 'object'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists crm_attribution_touchpoints_lineage_idx
  on crm_attribution_touchpoints (tenant_id, workspace_id, organization_id, contact_id, occurred_at, attribution_touchpoint_id);

create table if not exists crm_assignment_history (
  assignment_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  lead_id text,
  opportunity_id text,
  owner_principal_id text not null,
  previous_owner_principal_id text,
  routing_rule text not null,
  reason text not null,
  assigned_by_principal_id text not null,
  assigned_at timestamptz not null,
  evidence jsonb not null,
  created_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, assignment_id),
  foreign key (tenant_id, workspace_id, organization_id, lead_id)
    references crm_leads (tenant_id, workspace_id, organization_id, lead_id) on delete restrict,
  foreign key (tenant_id, workspace_id, organization_id, opportunity_id)
    references crm_opportunities (tenant_id, workspace_id, organization_id, opportunity_id) on delete restrict,
  check (lead_id is not null or opportunity_id is not null),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists crm_assignment_history_lead_idx
  on crm_assignment_history (tenant_id, workspace_id, organization_id, lead_id, assigned_at desc, assignment_id)
  where lead_id is not null;

create table if not exists crm_pipeline_stage_history (
  stage_history_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  contact_id text not null,
  lead_id text,
  opportunity_id text,
  pipeline_key text not null,
  from_stage text,
  to_stage text not null,
  reason text not null,
  changed_by_principal_id text not null,
  changed_at timestamptz not null,
  evidence jsonb not null,
  created_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, stage_history_id),
  foreign key (tenant_id, workspace_id, organization_id, contact_id)
    references crm_contacts (tenant_id, workspace_id, organization_id, contact_id) on delete restrict,
  foreign key (tenant_id, workspace_id, organization_id, lead_id)
    references crm_leads (tenant_id, workspace_id, organization_id, lead_id) on delete restrict,
  foreign key (tenant_id, workspace_id, organization_id, opportunity_id)
    references crm_opportunities (tenant_id, workspace_id, organization_id, opportunity_id) on delete restrict,
  check (from_stage is null or from_stage in ('NEW','CONTACTED','QUALIFIED','OPPORTUNITY','WON','LOST','NURTURE')),
  check (to_stage in ('NEW','CONTACTED','QUALIFIED','OPPORTUNITY','WON','LOST','NURTURE')),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists crm_pipeline_stage_history_pipeline_idx
  on crm_pipeline_stage_history (tenant_id, workspace_id, organization_id, pipeline_key, changed_at desc, stage_history_id);

create table if not exists crm_sla_states (
  lead_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  first_response_due_at timestamptz not null,
  first_response_at timestamptz,
  follow_up_due_at timestamptz,
  last_follow_up_at timestamptz,
  no_response_count integer not null default 0,
  state text not null,
  breach_reason text,
  reactivation_due_at timestamptz,
  version integer not null default 1,
  updated_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, lead_id),
  foreign key (tenant_id, workspace_id, organization_id, lead_id)
    references crm_leads (tenant_id, workspace_id, organization_id, lead_id) on delete restrict,
  check (state in ('ON_TRACK','DUE','BREACHED','PAUSED','SATISFIED')),
  check (no_response_count >= 0),
  check (version >= 1)
);

create index if not exists crm_sla_states_due_idx
  on crm_sla_states (tenant_id, workspace_id, organization_id, state, first_response_due_at, follow_up_due_at, lead_id);

create table if not exists crm_contact_merge_history (
  merge_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  source_contact_id text not null,
  canonical_contact_id text not null,
  merge_rule text not null,
  confidence double precision not null,
  approved_by_principal_id text not null,
  merged_at timestamptz not null,
  evidence jsonb not null,
  created_at timestamptz not null,
  unique (tenant_id, workspace_id, organization_id, source_contact_id),
  foreign key (tenant_id, workspace_id, organization_id, source_contact_id)
    references crm_contacts (tenant_id, workspace_id, organization_id, contact_id) on delete restrict,
  foreign key (tenant_id, workspace_id, organization_id, canonical_contact_id)
    references crm_contacts (tenant_id, workspace_id, organization_id, contact_id) on delete restrict,
  check (source_contact_id <> canonical_contact_id),
  check (confidence between 0 and 1),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create index if not exists crm_contact_merge_history_canonical_idx
  on crm_contact_merge_history (tenant_id, workspace_id, organization_id, canonical_contact_id, merged_at desc, merge_id);

create or replace function reject_crm_sales_history_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'CRM_SALES_HISTORY_MUTATION_FORBIDDEN';
end;
$$;

do $$
declare
  history_table text;
begin
  foreach history_table in array array[
    'crm_messages',
    'crm_sales_activities',
    'crm_qualification_decisions',
    'crm_lead_score_observations',
    'crm_attribution_touchpoints',
    'crm_assignment_history',
    'crm_pipeline_stage_history',
    'crm_contact_merge_history'
  ] loop
    execute format('drop trigger if exists %I on %I', history_table || '_append_only', history_table);
    execute format(
      'create trigger %I before update or delete on %I for each row execute function reject_crm_sales_history_mutation()',
      history_table || '_append_only',
      history_table
    );
  end loop;
end;
$$;
