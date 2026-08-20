# TOCA OS Next — CRM Sales Engine Advanced checkpoint

Status: IMPLEMENTED (promotion requires exact-HEAD CI evidence)
Date: 2026-08-20
Route: R10 / Comercial e Parcerias

## Scope

This change expands the canonical TOCA OS CRM. It does not create a second CRM, MCP server, scheduler, Approval Engine, Policy Engine, persistence plane, idempotency mechanism, outbox, or audit ledger.

Canonical lineage remains:

`ContactRecord -> Lead -> Opportunity`

The advanced sales layer adds provider-neutral conversation/message history, sales activities, next actions, qualification decisions, deterministic score observations, attribution touchpoints, ownership/assignment history, pipeline stage history, SLA state, and controlled contact merge history.

## Pipeline

The governed minimum pipeline is:

`NEW -> CONTACTED -> QUALIFIED -> OPPORTUNITY -> WON | LOST | NURTURE`

Invalid direct jumps are rejected. Lost opportunities require a reason. Qualification and stage decisions are append-only history records.

## Decision authority

Deterministic scoring is the primary automated authority. AI may be supplied only as a complementary signal and contributes at most 15% to the effective score. A high AI score cannot qualify a lead whose deterministic score does not meet the qualification threshold.

Human overrides require an authenticated APPROVER or ADMIN role and are retained as HYBRID decision history.

## Governance

R10 capabilities are reused rather than adding a parallel public MCP surface:

- `sales.lead.enrich`: contact/entity resolution (READ)
- `sales.lead.create`: governed lead creation
- `sales.lead.qualify`: governed qualification
- `sales.pipeline.update`: opportunity/pipeline mutation
- `sales.followup.create`: append sales activity
- `sales.followup.schedule`: create next action/task
- `sales.report.generate`: pipeline query (READ)

The canonical capability catalog and runtime registry resolve these same R10 IDs with matching lifecycle, risk, side-effect, idempotency, and execution-surface contracts. A dedicated catalog↔runtime contract test is part of the branch Quality evidence rather than a second registry.

Mutation scope and actor identity are derived from the authenticated Core `ExecutionIdentity`, never trusted from payload fields. Mutations reuse canonical authorization/policy handling, `crm_idempotency_keys`, PostgreSQL transaction boundaries, Transactional Outbox, Internal Audit Ledger, and persistence readback.

The capability lifecycle remains `IMPLEMENTED` until formal promotion. Because side-effect bindings are not marked production validated, the existing Core Policy Engine fails closed for external writes until promotion evidence exists.

## Strict typing boundary

The runtime and persistence contracts remain compatible with the repository's strict TypeScript settings, including `exactOptionalPropertyTypes`. Optional provider, routing, and human-override fields are omitted rather than emitted as explicit `undefined`, and normalized mutation metadata does not make the optional caller timestamp part of the required audit identity contract.

No `any`, `eslint-disable`, TypeScript suppression, policy bypass, or relaxed Quality rule is permitted as a compatibility mechanism.

## Persistence

Migration `023_crm_sales_engine.sql` adds the advanced CRM tables and foreign-keys them to the existing CRM core tables. Append-only triggers protect message/activity/decision/score/attribution/assignment/stage/merge history from UPDATE/DELETE mutation.

No WhatsApp or Email provider is implemented by this PR. `MessageRecord` keeps provider-neutral references/digests so Omnichannel can integrate later without bypassing the CRM/Core boundary.

## Required evidence before promotion

- Format
- Architecture
- Lint
- Typecheck
- Unit tests
- Build
- PostgreSQL migrations/E2E
- restart/retry/idempotency
- lead -> opportunity -> WON
- lead -> opportunity -> LOST
- lead -> NURTURE
- audit/outbox/readback
- exact-HEAD evidence in PR

External provider verification is out of scope for this PR and must not be inferred from PostgreSQL readback.
