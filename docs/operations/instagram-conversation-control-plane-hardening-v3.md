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
- Commercial intent keeps conservative precedence over lower-risk event/operational signals while secondary intents remain available for context.
- Safety/legal/harassment/refund/complaint/support remain higher precedence than commercial/event intents.
- Follow-up queue membership is not execution authority.
- FAQ and classifier evidence never self-promote facts or model changes.

## Multitenancy

Migration 040 scopes recurring FAQ signals, classification feedback and response QA by tenant, workspace and organization. Existing V3 rows are backfilled to the canonical TOCA scope before NOT NULL constraints are applied. Runtime methods that write these analytics surfaces must carry the same scope before the PR may be merged into production main.

## Release gate

Do not merge this PR before the current exact-SHA Controlled Direct Canary proof is completed or intentionally superseded. Merging advances `main` and therefore requires a fresh immutable engagement runtime digest and authorization lineage.
