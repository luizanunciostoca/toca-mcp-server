# Instagram Conversation Control Plane Hardening V3

Status: PR candidate. No provider-write authority is introduced by this hardening.

## Scope

- explicit canonical intent projection with primary/secondary intent preservation;
- human escalation queue and configurable SLA policy;
- governed follow-up queue without provider send executor;
- recurring FAQ signal aggregation with PII-redacted normalized text;
- classification feedback/confusion evidence without automatic classifier promotion;
- response QA evidence;
- verified-only campaign/ad/ad-set/creative attribution metadata;
- sanitized status dashboard for unanswered, escalated, failed, ambiguous and dead-letter states.

## Safety boundaries

- No persistent Instagram engagement write flag is enabled.
- No provider send path is added.
- Higher-risk safety/legal/harassment/refund/complaint/support signals retain precedence over lower-risk event/operational context.
- Commercial-lead projection is only added when the underlying classifier produces the qualifying commercial signal; event, product and operational signals remain available as primary/secondary context according to the deterministic precedence table.
- Follow-up queue membership is not execution authority.
- FAQ and classifier evidence never self-promote facts or model changes.

## Multitenancy

Migration 040 introduces isolated scoped analytics surfaces rather than mutating the keys of the V3 legacy tables:

- `instagram_engagement_faq_signals_scoped`;
- `instagram_engagement_classification_feedback_scoped`;
- `instagram_engagement_response_qa_scoped`.

Each scoped surface requires `tenant_id`, `workspace_id` and `organization_id` in its primary key or write path. `PostgresInstagramConversationAnalyticsScoped` validates the complete scope before persistence, writes only to the scoped surfaces, validates hashed event/question identifiers and reads FAQ misses only inside the configured scope. This rollout intentionally leaves the legacy analytics tables unchanged so existing V3 code cannot be broken by an in-place primary-key migration.

`PostgresInstagramConversationStatusDashboardScoped` is the canonical multitenant dashboard path. It scopes thread, human-queue, action, `event_outbox` dead-letter and FAQ-miss counters by tenant, workspace and organization. The legacy `getStatusDashboard` method in `PostgresInstagramConversationControlPlane` is retained only for compatibility and must not be wired into a multitenant production runtime.

The legacy unscoped analytics methods in `PostgresInstagramConversationControlPlane` are not the canonical multitenant analytics path and must not be wired into a multitenant production runtime. The scoped analytics runtime is the governed target for FAQ aggregation, classification feedback, response QA and operational dashboard reads.

## Release gate

Do not merge this PR before the current Controlled Direct Canary readiness blocker is diagnosed and a fresh exact-SHA Direct canary either passes or is intentionally superseded. Merging advances `main` and therefore requires a fresh immutable engagement runtime digest and authorization lineage.
